"""Background task: stream → clean → batch-insert → update status.

Memory constraints enforced throughout:
- Files are read chunk-by-chunk / row-by-row, never fully loaded.
- Duplicate detection uses an in-memory set (fine for ≤20k rows; replace with
  a Bloom filter for millions).
- Inserts are batched at BATCH_SIZE rows.
- The temp file is always deleted in the finally block.
"""
import csv
import json
import logging
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

log = logging.getLogger(__name__)

TEMP_DIR = Path("/tmp/databrief_uploads")
BATCH_SIZE = 50_000


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run_processing_pipeline(
    *,
    dataset_id: str,
    temp_path: Path,
    file_type: str,
    table_name: str,
) -> None:
    from ..database import get_client
    from ..config import get_settings
    from .queries import update_dataset_status, insert_progress, get_dataset

    client = get_client()
    settings = get_settings()
    row_cap: int = settings.sample_row_cap

    try:
        update_dataset_status(client, dataset_id, "processing")
        insert_progress(client, dataset_id, "parsing", 0.0, "Starting pipeline")

        # --- Phase 1: sample for type inference ---
        insert_progress(client, dataset_id, "parsing", 5.0, "Inferring column types")
        sample: list[dict] = []
        for i, row in enumerate(_stream_rows(temp_path, file_type)):
            sample.append(row)
            if i >= 999:
                break

        if not sample:
            raise ValueError("File appears to be empty")

        raw_headers = list(sample[0].keys())
        headers = [_norm_header(h) for h in raw_headers]
        col_types = _infer_types(sample, raw_headers)

        insert_progress(client, dataset_id, "parsing", 10.0, f"Detected {len(headers)} columns")

        # --- Phase 2: create dataset table ---
        _create_table(client, table_name, headers, col_types)
        insert_progress(client, dataset_id, "inserting", 15.0, "Created dataset table")

        # --- Phase 3: stream + clean + batch insert ---
        batch: list[list] = []
        row_count = 0
        null_counts = {h: 0 for h in headers}
        seen_hashes: set[int] = set()
        dupes_dropped = 0
        nulls_imputed = 0

        running_sums: dict[str, float] = {
            h: 0.0 for h, t in zip(headers, col_types) if t == "Float64"
        }
        running_n: dict[str, int] = {h: 0 for h in running_sums}

        for raw_row in _stream_rows(temp_path, file_type):
            if row_count >= row_cap:
                break

            # Normalize keys to match inferred headers
            row = {_norm_header(k): v for k, v in raw_row.items()}

            # Whitespace trim on strings
            row = {k: (v.strip() if isinstance(v, str) else v) for k, v in row.items()}

            # Duplicate detection
            row_hash = hash(tuple(str(row.get(h, "")) for h in headers))
            if row_hash in seen_hashes:
                dupes_dropped += 1
                continue
            seen_hashes.add(row_hash)

            # Type coerce + null imputation
            cleaned: list = []
            for h, t in zip(headers, col_types):
                val = row.get(h)
                coerced = _coerce(val, t)
                if coerced is None:
                    null_counts[h] += 1
                    if t == "Float64":
                        coerced = running_sums[h] / running_n[h] if running_n[h] > 0 else 0.0
                        nulls_imputed += 1
                    elif t == "Int64":
                        coerced = 0
                    else:
                        coerced = ""
                else:
                    if t == "Float64":
                        running_sums[h] += float(coerced)
                        running_n[h] += 1
                cleaned.append(coerced)

            batch.append(cleaned)
            row_count += 1

            if len(batch) >= BATCH_SIZE:
                client.insert(
                    f"databrief.`{table_name}`", batch, column_names=headers
                )
                batch.clear()
                pct = min(90.0, 15.0 + 75.0 * (row_count / row_cap))
                insert_progress(client, dataset_id, "inserting", pct, f"Inserted {row_count:,} rows")

        if batch:
            client.insert(f"databrief.`{table_name}`", batch, column_names=headers)

        # --- Phase 4: drop high-null columns (>70%) ---
        high_null = [
            h for h, cnt in null_counts.items()
            if row_count > 0 and (cnt / row_count) > 0.70
        ]
        cleaning_log: list[str] = []
        if high_null:
            for col in high_null:
                try:
                    client.command(
                        f"ALTER TABLE databrief.`{table_name}` DROP COLUMN IF EXISTS `{col}`"
                    )
                except Exception:
                    pass
            cleaning_log.append(
                f"Dropped {len(high_null)} high-null columns (>70% null): {', '.join(high_null)}"
            )
            surviving = set(headers) - set(high_null)
            col_types = [t for h, t in zip(headers, col_types) if h in surviving]
            headers = [h for h in headers if h in surviving]

        if dupes_dropped:
            cleaning_log.append(f"Removed {dupes_dropped:,} duplicate rows")
        if nulls_imputed:
            cleaning_log.append(f"Imputed {nulls_imputed:,} null numeric values with column mean")
        cleaning_log.append(f"Normalized {len(headers)} headers to lowercase_underscore")
        cleaning_log.append("Trimmed whitespace on all string fields")
        cleaning_log.append(f"Final row count: {row_count:,}")

        # Quality score: penalise null rate and dupe rate
        total_nulls = sum(null_counts.values())
        total_cells = max(1, row_count * len(headers))
        null_rate = total_nulls / total_cells
        dupe_penalty = (dupes_dropped / max(row_count, 1)) * 20.0
        quality_score = max(0.0, min(100.0, (1.0 - null_rate) * 100.0 - dupe_penalty))

        column_schema = json.dumps([
            {"name": h, "type": t, "nullable": null_counts.get(h, 0) > 0}
            for h, t in zip(headers, col_types)
        ])

        insert_progress(client, dataset_id, "aggregating", 95.0, "Building aggregation views")
        try:
            from ..analytics.views import create_dataset_views
            create_dataset_views(client, table_name, column_schema)
        except Exception as e:
            log.warning("View creation failed (non-fatal): %s", e)

        insert_progress(client, dataset_id, "aggregating", 98.0, "Computing KPIs")
        try:
            from ..analytics.kpis import compute_and_store_kpis
            compute_and_store_kpis(client, dataset_id, table_name, column_schema)
        except Exception as e:
            log.warning("KPI computation failed (non-fatal): %s", e)

        insert_progress(client, dataset_id, "done", 100.0, f"Complete — {row_count:,} rows loaded")
        update_dataset_status(
            client, dataset_id, "ready",
            row_count=row_count,
            column_count=len(headers),
            cleaning_log=json.dumps(cleaning_log),
            column_schema=column_schema,
            quality_score=quality_score,
        )

    except Exception as exc:
        log.exception("Processing failed for dataset %s", dataset_id)
        try:
            update_dataset_status(client, dataset_id, "failed", error_message=str(exc)[:1000])
            insert_progress(client, dataset_id, "failed", 0.0, f"Error: {exc}"[:500])
        except Exception:
            pass
    finally:
        temp_path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Streaming readers
# ---------------------------------------------------------------------------

def _stream_rows(path: Path, file_type: str) -> Iterator[dict]:
    ft = file_type.lower().strip(".")
    if ft == "parquet":
        yield from _stream_parquet(path)
    elif ft in ("xlsx", "xls", "excel"):
        yield from _stream_excel(path)
    else:
        yield from _stream_csv(path)


def _stream_csv(path: Path) -> Iterator[dict]:
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            yield row


def _stream_excel(path: Path) -> Iterator[dict]:
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    headers: Optional[list[str]] = None
    for row_vals in ws.iter_rows(values_only=True):
        if headers is None:
            headers = [
                str(c) if c is not None else f"col_{i}"
                for i, c in enumerate(row_vals)
            ]
            continue
        yield dict(zip(headers, row_vals))
    wb.close()


def _stream_parquet(path: Path) -> Iterator[dict]:
    import pyarrow.parquet as pq
    pf = pq.ParquetFile(path)
    for batch in pf.iter_batches(batch_size=10_000):
        keys = batch.schema.names
        columns = {k: batch.column(k).to_pylist() for k in keys}
        for i in range(batch.num_rows):
            yield {k: columns[k][i] for k in keys}


# ---------------------------------------------------------------------------
# Type inference
# ---------------------------------------------------------------------------

def _infer_types(sample: list[dict], raw_headers: list[str]) -> list[str]:
    types: list[str] = []
    for h in raw_headers:
        values = [r.get(h) for r in sample]
        non_null = [v for v in values if v is not None and str(v).strip() not in ("", "None", "nan", "NaN")]
        if not non_null:
            types.append("String")
            continue
        first = non_null[0]
        # Prefer actual Python types (from Parquet)
        if isinstance(first, bool):
            types.append("String")
        elif isinstance(first, int):
            types.append("Int64")
        elif isinstance(first, float):
            types.append("Float64")
        elif isinstance(first, (datetime, date)):
            types.append("DateTime64(3)")
        elif _all_int(non_null):
            types.append("Int64")
        elif _all_float(non_null):
            types.append("Float64")
        elif _all_date(non_null):
            types.append("DateTime64(3)")
        else:
            types.append("String")
    return types


def _all_int(values: list) -> bool:
    try:
        for v in values:
            int(str(v).strip())
        return True
    except (ValueError, TypeError):
        return False


def _all_float(values: list) -> bool:
    try:
        for v in values:
            float(str(v).strip())
        return True
    except (ValueError, TypeError):
        return False


_DATE_FORMATS = [
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d",
    "%m/%d/%Y",
    "%d/%m/%Y",
]


def _all_date(values: list) -> bool:
    for v in values:
        parsed = False
        for fmt in _DATE_FORMATS:
            try:
                datetime.strptime(str(v).strip(), fmt)
                parsed = True
                break
            except (ValueError, TypeError):
                pass
        if not parsed:
            return False
    return True


# ---------------------------------------------------------------------------
# Type coercion
# ---------------------------------------------------------------------------

def _coerce(value: Any, col_type: str) -> Any:
    if value is None:
        return None
    # Already the right Python type (Parquet)
    if col_type == "Int64" and isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value)
    if col_type == "Float64" and isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if col_type == "DateTime64(3)":
        if isinstance(value, datetime):
            return value
        if isinstance(value, date):
            return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)

    s = str(value).strip()
    if s in ("", "None", "nan", "NaN", "NULL", "null", "N/A", "n/a"):
        return None
    try:
        if col_type == "Int64":
            return int(float(s))
        if col_type == "Float64":
            return float(s)
        if col_type == "DateTime64(3)":
            return _parse_date(s)
        return s  # String — already stripped above
    except (ValueError, TypeError):
        return None


def _parse_date(s: str) -> Optional[datetime]:
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    return None


# ---------------------------------------------------------------------------
# Header normalisation
# ---------------------------------------------------------------------------

def _norm_header(h: str) -> str:
    h = str(h).strip().lower()
    h = re.sub(r"[^a-z0-9]+", "_", h)
    h = h.strip("_")
    return h or "col"


# ---------------------------------------------------------------------------
# DDL
# ---------------------------------------------------------------------------

def _create_table(client, table_name: str, headers: list[str], col_types: list[str]) -> None:
    col_defs = ",\n    ".join(
        f"`{h}` Nullable({t})" for h, t in zip(headers, col_types)
    )
    client.command(f"""
        CREATE TABLE IF NOT EXISTS databrief.`{table_name}`
        (
            {col_defs}
        )
        ENGINE = MergeTree
        ORDER BY tuple()
    """)
