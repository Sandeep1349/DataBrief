"""Compute and cache per-dataset KPIs in the databrief.kpis table.

KPIs are computed once when a dataset becomes 'ready' and cached in ClickHouse
so the dashboard doesn't re-query the base table on every page load.
"""
import json
import logging
import uuid
from datetime import datetime, timezone

log = logging.getLogger(__name__)

_TREND_UP = "up"
_TREND_DOWN = "down"
_TREND_FLAT = "flat"


def compute_and_store_kpis(client, dataset_id: str, table_name: str, column_schema: str) -> None:
    try:
        schema: list[dict] = json.loads(column_schema)
    except (json.JSONDecodeError, TypeError):
        return

    # Prefer Float64 columns; exclude Int64 columns that look like category codes
    _cat_kw = frozenset(["id", "type", "code", "vendor", "flag", "zone", "location"])
    float_cols = [c["name"] for c in schema if c.get("type") == "Float64"]
    int_cols = [
        c["name"] for c in schema
        if c.get("type") == "Int64"
        and not any(kw in c["name"].lower() for kw in _cat_kw)
    ]
    num_cols = (float_cols + int_cols)
    dt_cols = [c["name"] for c in schema if "DateTime" in c.get("type", "")]

    kpis: list[dict] = []

    # Always: total row count
    result = client.query(f"SELECT count() FROM databrief.`{table_name}`")
    total_rows = result.first_row[0]
    kpis.append({
        "name": "Total Records",
        "value": f"{total_rows:,}",
        "raw_value": float(total_rows),
        "change_percent": 0.0,
        "trend": _TREND_FLAT,
        "category": "overview",
    })

    # Numeric column stats (sum + avg for first 4 numeric cols)
    for col in num_cols[:4]:
        try:
            res = client.query(
                f"SELECT sum(assumeNotNull(`{col}`)), avg(assumeNotNull(`{col}`)) "
                f"FROM databrief.`{table_name}` WHERE `{col}` IS NOT NULL"
            )
            total, avg = res.first_row
            if total is None:
                continue
            kpis.append({
                "name": f"Total {col.replace('_', ' ').title()}",
                "value": _fmt_number(total),
                "raw_value": float(total),
                "change_percent": 0.0,
                "trend": _TREND_FLAT,
                "category": "numeric",
            })
            kpis.append({
                "name": f"Avg {col.replace('_', ' ').title()}",
                "value": _fmt_number(avg),
                "raw_value": float(avg),
                "change_percent": 0.0,
                "trend": _TREND_FLAT,
                "category": "numeric",
            })
        except Exception as e:
            log.debug("KPI failed for %s.%s: %s", table_name, col, e)

    # Date range (if datetime column exists)
    if dt_cols:
        dt_col = dt_cols[0]
        try:
            res = client.query(
                f"SELECT min(`{dt_col}`), max(`{dt_col}`) FROM databrief.`{table_name}` "
                f"WHERE `{dt_col}` IS NOT NULL"
            )
            min_dt, max_dt = res.first_row
            if min_dt and max_dt:
                kpis.append({
                    "name": "Date Range",
                    "value": f"{_fmt_date(min_dt)} – {_fmt_date(max_dt)}",
                    "raw_value": 0.0,
                    "change_percent": 0.0,
                    "trend": _TREND_FLAT,
                    "category": "overview",
                })
        except Exception as e:
            log.debug("Date range KPI failed: %s", e)

    # Persist to kpis table
    now = datetime.now(timezone.utc)
    rows = [
        [
            str(uuid.uuid4()),
            dataset_id,
            k["name"],
            k["value"],
            k["raw_value"],
            k["change_percent"],
            k["trend"],
            k["category"],
            now,
        ]
        for k in kpis
    ]
    if rows:
        client.insert(
            "databrief.kpis",
            rows,
            column_names=[
                "kpi_id", "dataset_id", "name", "value", "raw_value",
                "change_percent", "trend", "category", "created_at",
            ],
        )
    log.info("Stored %d KPIs for dataset %s", len(kpis), dataset_id)


def get_kpis(client, dataset_id: str) -> list[dict]:
    result = client.query(
        """
        SELECT
            kpi_id, dataset_id, name, value, raw_value,
            change_percent, trend, category, created_at
        FROM databrief.kpis FINAL
        WHERE dataset_id = {dataset_id:String}
        ORDER BY category, name
        """,
        parameters={"dataset_id": dataset_id},
    )
    return list(result.named_results())


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def _fmt_number(n: float) -> str:
    if abs(n) >= 1_000_000:
        return f"{n/1_000_000:.2f}M"
    if abs(n) >= 1_000:
        return f"{n/1_000:.1f}K"
    return f"{n:.2f}"


def _fmt_date(dt) -> str:
    if hasattr(dt, "strftime"):
        return dt.strftime("%Y-%m-%d")
    return str(dt)[:10]
