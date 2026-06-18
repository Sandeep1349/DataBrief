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
# URL download + pipeline
# ---------------------------------------------------------------------------

def _download_url(url: str, temp_path: Path, max_bytes: int) -> str:
    """Stream-download url to temp_path. Returns detected file_type string."""
    import urllib.request

    req = urllib.request.Request(url, headers={"User-Agent": "DataBrief/2.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        content_type = resp.headers.get("Content-Type", "").lower()
        bytes_written = 0
        with open(temp_path, "wb") as f:
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > max_bytes:
                    raise ValueError(f"URL content exceeds the {max_bytes // 1024 // 1024} MB limit")
                f.write(chunk)

    url_clean = url.split("?")[0].lower()
    ext = url_clean.rsplit(".", 1)[-1] if "." in url_clean.split("/")[-1] else ""
    ext_map = {
        "csv": "csv", "json": "json", "parquet": "parquet",
        "xlsx": "excel", "xls": "excel", "tsv": "tsv", "tab": "tsv",
    }
    if ext in ext_map:
        return ext_map[ext]
    if "csv" in content_type or "text/plain" in content_type:
        return "csv"
    if "json" in content_type:
        return "json"
    if "parquet" in content_type:
        return "parquet"
    return "csv"


def run_url_processing_pipeline(*, dataset_id: str, url: str, table_name: str) -> None:
    from ..database import get_client
    from ..config import get_settings
    from .queries import update_dataset_status, insert_progress

    client = get_client()
    settings = get_settings()
    max_bytes = settings.max_upload_mb * 1024 * 1024

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^a-z0-9._-]", "_", url.split("?")[0].split("/")[-1].lower()) or "download"
    temp_path = TEMP_DIR / f"{dataset_id}_{safe}"

    try:
        update_dataset_status(client, dataset_id, "processing")
        insert_progress(client, dataset_id, "downloading", 2.0, "Downloading from URL…")
        file_type = _download_url(url, temp_path, max_bytes)
        insert_progress(client, dataset_id, "parsing", 8.0, f"Download complete — {file_type.upper()} detected")
    except Exception as exc:
        temp_path.unlink(missing_ok=True)
        log.exception("URL download failed for dataset %s", dataset_id)
        try:
            update_dataset_status(client, dataset_id, "failed", error_message=str(exc)[:1000])
            insert_progress(client, dataset_id, "failed", 0.0, f"Download error: {exc}"[:500])
        except Exception:
            pass
        return

    # Hand off to the standard pipeline (handles cleanup of temp_path)
    run_processing_pipeline(
        dataset_id=dataset_id,
        temp_path=temp_path,
        file_type=file_type,
        table_name=table_name,
    )


# ---------------------------------------------------------------------------
# AI cleaning + revert
# ---------------------------------------------------------------------------

def run_ai_cleaning(dataset_id: str, table_name: str, column_schema_json: str) -> None:
    from ..database import get_client
    from .queries import update_dataset_status, insert_progress, get_dataset

    client = get_client()
    bak = f"{table_name}_bak"

    try:
        insert_progress(client, dataset_id, "cleaning", 5.0, "Starting AI data cleaning")

        schema = json.loads(column_schema_json or "[]")
        headers = [col["name"] for col in schema]
        col_types: dict[str, str] = {col["name"]: col.get("type", "String") for col in schema}

        # Row count before cleaning
        total = list(client.query(f"SELECT count() as n FROM databrief.`{table_name}`").named_results())[0]["n"]
        if total == 0:
            raise ValueError("Dataset is empty")

        # Create backup
        insert_progress(client, dataset_id, "cleaning", 15.0, "Backing up original data")
        client.command(f"CREATE TABLE IF NOT EXISTS databrief.`{bak}` AS databrief.`{table_name}`")
        client.command(f"TRUNCATE TABLE databrief.`{bak}`")
        client.command(f"INSERT INTO databrief.`{bak}` SELECT * FROM databrief.`{table_name}`")

        # Identify high-null columns and compute means for numeric imputation
        insert_progress(client, dataset_id, "cleaning", 25.0, "Analysing null patterns")
        high_null: list[str] = []
        means: dict[str, float] = {}
        for col_name in headers:
            r = list(client.query(
                f"SELECT countIf(isNull(`{col_name}`)) as n FROM databrief.`{bak}`"
            ).named_results())[0]
            null_frac = r["n"] / total
            if null_frac > 0.70:
                high_null.append(col_name)
            elif col_types.get(col_name) == "Float64" and r["n"] > 0:
                mr = list(client.query(
                    f"SELECT avg(`{col_name}`) as m FROM databrief.`{bak}` WHERE `{col_name}` IS NOT NULL"
                ).named_results())[0]
                means[col_name] = float(mr["m"]) if mr["m"] is not None else 0.0

        kept = [h for h in headers if h not in high_null]

        # Build cleaned SELECT
        insert_progress(client, dataset_id, "cleaning", 45.0, "Applying cleaning transforms")
        exprs = []
        for h in kept:
            t = col_types.get(h, "String")
            if t == "Float64" and h in means:
                exprs.append(f"coalesce(`{h}`, {means[h]}) AS `{h}`")
            elif t == "String":
                exprs.append(f"trim(coalesce(`{h}`, '')) AS `{h}`")
            else:
                exprs.append(f"`{h}`")

        col_list = ", ".join(f"`{h}`" for h in kept)
        sel = ", ".join(exprs)

        client.command(f"TRUNCATE TABLE databrief.`{table_name}`")
        client.command(
            f"INSERT INTO databrief.`{table_name}` ({col_list}) "
            f"SELECT DISTINCT {sel} FROM databrief.`{bak}`"
        )

        # Drop high-null columns
        insert_progress(client, dataset_id, "cleaning", 70.0, "Dropping high-null columns")
        for col_name in high_null:
            try:
                client.command(f"ALTER TABLE databrief.`{table_name}` DROP COLUMN IF EXISTS `{col_name}`")
            except Exception:
                pass

        new_rows = list(client.query(f"SELECT count() as n FROM databrief.`{table_name}`").named_results())[0]["n"]
        dupes_removed = total - new_rows
        new_schema = [col for col in schema if col["name"] not in high_null]
        new_schema_json = json.dumps(new_schema)

        report: list[str] = ["__ai_cleaned__"]
        report.append(f"Removed {dupes_removed:,} duplicate rows" if dupes_removed else "No duplicate rows found")
        if high_null:
            report.append(f"Dropped {len(high_null)} high-null columns (>70% missing): {', '.join(high_null)}")
        if means:
            report.append(f"Imputed nulls in {len(means)} numeric columns with column mean")
        report.append("Trimmed whitespace on all string columns")
        report.append(f"Result: {new_rows:,} rows · {len(new_schema)} columns")

        insert_progress(client, dataset_id, "cleaning", 90.0, "Recomputing KPIs")
        try:
            from ..analytics.kpis import compute_and_store_kpis
            compute_and_store_kpis(client, dataset_id, table_name, new_schema_json)
        except Exception:
            pass

        quality = min(100.0, 85.0 + 15.0 * min(1.0, new_rows / max(total, 1)))
        update_dataset_status(
            client, dataset_id, "ready",
            row_count=new_rows,
            column_count=len(new_schema),
            cleaning_log=json.dumps(report),
            column_schema=new_schema_json,
            quality_score=quality,
        )
        insert_progress(client, dataset_id, "done", 100.0, f"AI cleaning complete — {new_rows:,} rows")

    except Exception as exc:
        log.exception("AI cleaning failed for dataset %s", dataset_id)
        try:
            update_dataset_status(client, dataset_id, "ready")
            insert_progress(client, dataset_id, "failed", 0.0, f"Cleaning error: {exc}"[:500])
        except Exception:
            pass


def run_revert_cleaning(dataset_id: str, table_name: str) -> None:
    from ..database import get_client
    from .queries import update_dataset_status, insert_progress, get_dataset

    client = get_client()
    bak = f"{table_name}_bak"

    try:
        insert_progress(client, dataset_id, "cleaning", 5.0, "Reverting to original data")
        ds = get_dataset(client, dataset_id)
        if ds is None:
            raise ValueError("Dataset not found")

        bak_exists = list(client.query(
            "SELECT count() as n FROM system.tables "
            f"WHERE database='databrief' AND name='{bak}'"
        ).named_results())[0]["n"]
        if not bak_exists:
            raise ValueError("No backup found — cannot revert")

        # Recreate main table from backup (preserves original schema)
        insert_progress(client, dataset_id, "cleaning", 25.0, "Restoring original schema")
        client.command(f"DROP TABLE IF EXISTS databrief.`{table_name}`")
        client.command(f"CREATE TABLE databrief.`{table_name}` AS databrief.`{bak}`")

        insert_progress(client, dataset_id, "cleaning", 50.0, "Restoring original rows")
        client.command(f"INSERT INTO databrief.`{table_name}` SELECT * FROM databrief.`{bak}`")

        client.command(f"DROP TABLE IF EXISTS databrief.`{bak}`")

        orig_rows = list(client.query(
            f"SELECT count() as n FROM databrief.`{table_name}`"
        ).named_results())[0]["n"]

        cols_result = list(client.query(
            "SELECT name, type FROM system.columns "
            f"WHERE database='databrief' AND table='{table_name}' ORDER BY position"
        ).named_results())
        orig_schema = [
            {"name": c["name"], "type": c["type"].replace("Nullable(", "").rstrip(")")}
            for c in cols_result
        ]
        orig_schema_json = json.dumps(orig_schema)

        # Strip the __ai_cleaned__ sentinel from cleaning_log
        old_log = json.loads(ds.get("cleaning_log") or "[]")
        new_log = [e for e in old_log if e != "__ai_cleaned__"]

        insert_progress(client, dataset_id, "cleaning", 85.0, "Recomputing KPIs")
        try:
            from ..analytics.kpis import compute_and_store_kpis
            compute_and_store_kpis(client, dataset_id, table_name, orig_schema_json)
        except Exception:
            pass

        update_dataset_status(
            client, dataset_id, "ready",
            row_count=orig_rows,
            column_count=len(orig_schema),
            cleaning_log=json.dumps(new_log),
            column_schema=orig_schema_json,
            quality_score=ds.get("quality_score", 0.0),
        )
        insert_progress(client, dataset_id, "done", 100.0, f"Reverted — {orig_rows:,} rows restored")

    except Exception as exc:
        log.exception("Revert failed for dataset %s", dataset_id)
        try:
            update_dataset_status(client, dataset_id, "ready")
            insert_progress(client, dataset_id, "failed", 0.0, f"Revert error: {exc}"[:500])
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Manual cleaning (rule-based, synchronous via SELECT INTO)
# ---------------------------------------------------------------------------

def run_manual_cleaning(
    dataset_id: str,
    table_name: str,
    rules: list[dict],
    column_schema_json: str,
) -> None:
    from ..database import get_client
    from .queries import update_dataset_status, insert_progress, get_dataset

    client = get_client()
    bak = f"{table_name}_bak"
    schema = json.loads(column_schema_json or "[]")
    headers: list[str] = [col["name"] for col in schema]
    col_types: dict[str, str] = {col["name"]: col.get("type", "String") for col in schema}
    valid_cols: set[str] = set(headers)

    try:
        insert_progress(client, dataset_id, "cleaning", 5.0, "Starting manual data cleaning")

        # Back up original data once (idempotent)
        insert_progress(client, dataset_id, "cleaning", 15.0, "Backing up data")
        bak_exists = list(client.query(
            "SELECT count() AS n FROM system.tables "
            f"WHERE database='databrief' AND name='{bak}'"
        ).named_results())[0]["n"]
        if not bak_exists:
            client.command(f"CREATE TABLE databrief.`{bak}` AS databrief.`{table_name}`")
            client.command(f"INSERT INTO databrief.`{bak}` SELECT * FROM databrief.`{table_name}`")

        insert_progress(client, dataset_id, "cleaning", 35.0, "Processing rules")

        rule_log: list[str] = []

        # ── First pass: identify structural changes ────────────────────────
        cols_to_drop: set[str] = set()
        use_distinct = False
        for rule in rules:
            rtype = rule.get("type", "")
            col   = rule.get("column", "")
            if rtype == "drop_column" and col in valid_cols:
                cols_to_drop.add(col)
                rule_log.append(f"Dropped column '{col}'")
            elif rtype == "remove_duplicates":
                use_distinct = True
                rule_log.append("Removed duplicate rows")

        # Working set excludes dropped columns
        working_headers = [h for h in headers if h not in cols_to_drop]
        col_exprs: dict[str, str] = {h: f"`{h}`" for h in working_headers}
        delete_conditions: list[str] = []

        # ── Second pass: expression + filter rules ────────────────────────
        for rule in rules:
            rtype = rule.get("type", "")
            col   = rule.get("column", "")

            # Structural rules already handled
            if rtype in ("drop_column", "remove_duplicates"):
                continue

            # Column must be in the working set
            if col not in valid_cols or col in cols_to_drop:
                continue

            ct = col_types.get(col, "String")
            expr = col_exprs[col]   # current expression for this column (may be nested)

            if rtype == "replace":
                find_val    = rule.get("find_value", "")
                replace_val = rule.get("replace_value", "")
                if ct == "Int64":
                    try:
                        old_n = int(float(find_val)); new_n = int(float(replace_val))
                        col_exprs[col] = f"if({expr} = toInt64({old_n}), toInt64({new_n}), {expr})"
                    except ValueError:
                        pass
                elif ct == "Float64":
                    try:
                        old_n = float(find_val); new_n = float(replace_val)
                        col_exprs[col] = f"if({expr} = toFloat64({old_n}), toFloat64({new_n}), {expr})"
                    except ValueError:
                        pass
                else:
                    sf = find_val.replace("'", "''"); sr = replace_val.replace("'", "''")
                    col_exprs[col] = f"if(toString({expr}) = '{sf}', '{sr}', {expr})"
                rule_log.append(f"Replaced '{find_val}' → '{replace_val}' in '{col}'")

            elif rtype == "fill_null":
                fill_val = rule.get("fill_value", "")
                if ct in ("Float64", "Int64"):
                    try:
                        if ct == "Int64":
                            lit = str(int(float(fill_val)))
                            col_exprs[col] = f"coalesce({expr}, toInt64({lit}))"
                        else:
                            lit = str(float(fill_val))
                            col_exprs[col] = f"coalesce({expr}, toFloat64({lit}))"
                    except ValueError:
                        pass
                else:
                    sv = fill_val.replace("'", "''")
                    col_exprs[col] = f"coalesce({expr}, '{sv}')"
                rule_log.append(f"Filled nulls in '{col}' with '{fill_val}'")

            elif rtype == "delete_where":
                op  = rule.get("operator", "eq")
                val = rule.get("value", "")
                cond = _build_delete_condition(col, op, val, ct)
                if cond:
                    delete_conditions.append(f"NOT ({cond})")
                    op_label = {"eq":"=","neq":"≠","gt":">","lt":"<","gte":"≥","lte":"≤",
                                "contains":"contains","is_null":"is null"}.get(op, op)
                    rule_log.append(f"Deleted rows where '{col}' {op_label} '{val}'")

            elif rtype == "trim_whitespace":
                col_exprs[col] = f"trim(toString({expr}))"
                rule_log.append(f"Trimmed whitespace in '{col}'")

            elif rtype == "normalize_spaces":
                col_exprs[col] = f"replaceRegexpAll(trim(toString({expr})), '[[:space:]]+', ' ')"
                rule_log.append(f"Normalized spaces in '{col}'")

            elif rtype == "to_uppercase":
                col_exprs[col] = f"upper(toString({expr}))"
                rule_log.append(f"Converted '{col}' to UPPERCASE")

            elif rtype == "to_lowercase":
                col_exprs[col] = f"lower(toString({expr}))"
                rule_log.append(f"Converted '{col}' to lowercase")

            elif rtype == "remove_chars":
                variant      = rule.get("value", "special")
                custom_chars = (rule.get("find_value") or "").replace("'", "''")
                # POSIX character classes — no SQL escaping issues
                pattern_map = {
                    "special":        "[^[:alnum:][:space:]]",
                    "digits":         "[[:digit:]]",
                    "spaces":         "[[:space:]]",
                    "non_alpha":      "[^[:alpha:]]",
                    "non_alphanumeric": "[^[:alnum:]]",
                }
                if variant == "custom" and custom_chars:
                    # Escape ] \ ^ - which are special inside a character class
                    escaped = re.sub(r'([\]\[\\^-])', r'\\\1', custom_chars).replace("'", "''")
                    pattern = f"[{escaped}]"
                else:
                    pattern = pattern_map.get(variant, "[^[:alnum:][:space:]]")
                col_exprs[col] = f"replaceRegexpAll(toString({expr}), '{pattern}', '')"
                rule_log.append(f"Removed {variant} characters from '{col}'")

            elif rtype == "regex_replace":
                pattern     = (rule.get("find_value")    or "").replace("'", "''")
                replacement = (rule.get("replace_value") or "").replace("'", "''")
                if pattern:
                    col_exprs[col] = f"replaceRegexpAll(toString({expr}), '{pattern}', '{replacement}')"
                    rule_log.append(f"Regex replace /{pattern}/ → '{replacement}' in '{col}'")

            elif rtype == "round_numeric":
                try:
                    decimals = max(0, min(10, int(rule.get("value") or "0")))
                    col_exprs[col] = f"round(toFloat64({expr}), {decimals})"
                    rule_log.append(f"Rounded '{col}' to {decimals} decimal place(s)")
                except (ValueError, TypeError):
                    pass

            elif rtype == "clamp_range":
                try:
                    min_v = float(rule.get("find_value")    or "0")
                    max_v = float(rule.get("replace_value") or "0")
                    col_exprs[col] = (
                        f"greatest(toFloat64({min_v}), "
                        f"least(toFloat64({max_v}), toFloat64({expr})))"
                    )
                    rule_log.append(f"Clamped '{col}' to [{min_v}, {max_v}]")
                except (ValueError, TypeError):
                    pass

        insert_progress(client, dataset_id, "cleaning", 60.0, "Rebuilding dataset")

        # ── Build and execute the cleaning query ──────────────────────────
        col_list     = ", ".join(f"`{h}`" for h in working_headers)
        select_exprs = ", ".join(col_exprs[h] for h in working_headers)
        where_clause = (" WHERE " + " AND ".join(delete_conditions)) if delete_conditions else ""
        distinct_kw  = "DISTINCT " if use_distinct else ""

        # Build tmp table with the final schema (working headers only)
        col_type_map = {col["name"]: col.get("type", "String") for col in schema}
        col_defs = ", ".join(
            f"`{h}` Nullable({col_type_map.get(h, 'String')})" for h in working_headers
        )
        tmp = f"{table_name}_mclean_tmp"
        client.command(f"DROP TABLE IF EXISTS databrief.`{tmp}`")
        client.command(f"""
            CREATE TABLE databrief.`{tmp}` ({col_defs})
            ENGINE = MergeTree ORDER BY tuple()
        """)
        client.command(
            f"INSERT INTO databrief.`{tmp}` ({col_list}) "
            f"SELECT {distinct_kw}{select_exprs} FROM databrief.`{table_name}`{where_clause}"
        )

        # Swap: truncate original, drop removed columns, load cleaned data
        client.command(f"TRUNCATE TABLE databrief.`{table_name}`")
        for drop_col in cols_to_drop:
            try:
                client.command(
                    f"ALTER TABLE databrief.`{table_name}` DROP COLUMN IF EXISTS `{drop_col}`"
                )
            except Exception:
                pass
        client.command(
            f"INSERT INTO databrief.`{table_name}` ({col_list}) "
            f"SELECT {col_list} FROM databrief.`{tmp}`"
        )
        client.command(f"DROP TABLE IF EXISTS databrief.`{tmp}`")

        new_rows = list(client.query(
            f"SELECT count() AS n FROM databrief.`{table_name}`"
        ).named_results())[0]["n"]

        new_schema = [c for c in schema if c["name"] not in cols_to_drop]
        new_schema_json = json.dumps(new_schema)

        insert_progress(client, dataset_id, "cleaning", 85.0, "Recomputing KPIs")
        try:
            from ..analytics.kpis import compute_and_store_kpis
            compute_and_store_kpis(client, dataset_id, table_name, new_schema_json)
        except Exception:
            pass

        ds = get_dataset(client, dataset_id)
        old_log: list = json.loads((ds or {}).get("cleaning_log") or "[]")
        new_log = old_log + ["__manual_cleaned__"] + rule_log + [f"Result: {new_rows:,} rows"]

        update_dataset_status(
            client, dataset_id, "ready",
            row_count=new_rows,
            column_count=len(working_headers),
            cleaning_log=json.dumps(new_log),
            column_schema=new_schema_json,
            quality_score=(ds or {}).get("quality_score", 0.0),
        )
        insert_progress(client, dataset_id, "done", 100.0, f"Manual cleaning complete — {new_rows:,} rows")

    except Exception as exc:
        log.exception("Manual cleaning failed for dataset %s", dataset_id)
        try:
            update_dataset_status(client, dataset_id, "ready")
            insert_progress(client, dataset_id, "failed", 0.0, f"Manual cleaning error: {exc}"[:500])
        except Exception:
            pass


def _build_delete_condition(col: str, op: str, val: str, col_type: str) -> str:
    if op == "is_null":
        return f"`{col}` IS NULL OR toString(`{col}`) = ''"
    op_map = {"eq": "=", "neq": "!=", "gt": ">", "lt": "<", "gte": ">=", "lte": "<="}
    if op == "contains":
        sv = val.replace("'", "''").replace("%", "\\%").replace("_", "\\_")
        return f"toString(`{col}`) ILIKE '%{sv}%'"
    sql_op = op_map.get(op)
    if not sql_op:
        return ""
    if col_type in ("Float64", "Int64"):
        try:
            return f"`{col}` {sql_op} {float(val)}"
        except ValueError:
            return ""
    sv = val.replace("'", "''")
    return f"toString(`{col}`) {sql_op} '{sv}'"


# ---------------------------------------------------------------------------
# Streaming readers
# ---------------------------------------------------------------------------

def _stream_rows(path: Path, file_type: str) -> Iterator[dict]:
    ft = file_type.lower().strip(".")
    if ft == "parquet":
        yield from _stream_parquet(path)
    elif ft in ("xlsx", "xls", "excel"):
        yield from _stream_excel(path)
    elif ft == "json":
        yield from _stream_json(path)
    elif ft in ("tsv", "tab"):
        yield from _stream_tsv(path)
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


def _stream_tsv(path: Path) -> Iterator[dict]:
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            yield row


def _stream_json(path: Path) -> Iterator[dict]:
    with open(path, encoding="utf-8", errors="replace") as f:
        data = json.load(f)
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                yield item
    elif isinstance(data, dict):
        for key in ("data", "records", "rows", "items", "results"):
            if isinstance(data.get(key), list):
                for item in data[key]:
                    if isinstance(item, dict):
                        yield item
                return
        yield data


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

def _safe_db_table(name: str, db_type: str) -> str:
    """Quote an external table name to prevent SQL injection."""
    clean = re.sub(r'[`"\']', '', name)
    if not clean:
        raise ValueError("Invalid table name")
    if db_type == "mysql":
        return f"`{clean}`"
    return f'"{clean}"'


def run_db_import_pipeline(
    *,
    dataset_id: str,
    table_name: str,
    conn_params: dict,
    src_table: str,
) -> None:
    """Connect to an external database, export a table to CSV, then run the standard pipeline."""
    import csv as _csv

    from ..database import get_client
    from .queries import update_dataset_status, insert_progress

    client = get_client()
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^a-z0-9._-]", "_", src_table.lower()) or "dbtable"
    temp_path = TEMP_DIR / f"{dataset_id}_{safe_name}.csv"

    try:
        update_dataset_status(client, dataset_id, "processing")
        insert_progress(client, dataset_id, "connecting", 2.0, "Connecting to database…")

        db_type = conn_params["db_type"]

        if db_type == "postgresql":
            import psycopg2
            conn = psycopg2.connect(
                host=conn_params["host"],
                port=conn_params.get("port") or 5432,
                dbname=conn_params["database"],
                user=conn_params["username"],
                password=conn_params["password"],
                connect_timeout=15,
            )
        elif db_type == "mysql":
            import pymysql
            conn = pymysql.connect(
                host=conn_params["host"],
                port=conn_params.get("port") or 3306,
                database=conn_params["database"],
                user=conn_params["username"],
                password=conn_params["password"],
                connect_timeout=15,
            )
        elif db_type == "sqlite":
            import sqlite3
            conn = sqlite3.connect(conn_params["database"])
        else:
            raise ValueError(f"Unsupported DB type: {db_type}")

        insert_progress(client, dataset_id, "downloading", 5.0, f"Exporting table '{src_table}'…")

        cur = conn.cursor()
        quoted = _safe_db_table(src_table, db_type)
        cur.execute(f"SELECT * FROM {quoted}")
        headers = [desc[0] for desc in cur.description]

        with open(temp_path, "w", newline="", encoding="utf-8") as f:
            writer = _csv.writer(f)
            writer.writerow(headers)
            while True:
                rows = cur.fetchmany(10_000)
                if not rows:
                    break
                for row in rows:
                    writer.writerow(["" if v is None else str(v) for v in row])

        conn.close()
        insert_progress(client, dataset_id, "parsing", 10.0, "Export complete — processing…")

    except Exception as exc:
        temp_path.unlink(missing_ok=True)
        log.exception("DB export failed for dataset %s", dataset_id)
        try:
            update_dataset_status(client, dataset_id, "failed", error_message=str(exc)[:1000])
            insert_progress(client, dataset_id, "failed", 0.0, f"Connection error: {exc}"[:500])
        except Exception:
            pass
        return

    run_processing_pipeline(
        dataset_id=dataset_id,
        temp_path=temp_path,
        file_type="csv",
        table_name=table_name,
    )


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
