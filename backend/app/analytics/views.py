"""Create pre-aggregated summary tables for each dataset after it reaches 'ready'.

These are plain MergeTree tables populated with INSERT ... SELECT once.
For the 20k-row Phase 1 dataset, ClickHouse can also answer live queries
quickly — these exist to make the dashboard feel instant at any scale.
"""
import json
import logging
from typing import Any

log = logging.getLogger(__name__)


def create_dataset_views(client, table_name: str, column_schema: str) -> None:
    try:
        schema: list[dict] = json.loads(column_schema)
    except (json.JSONDecodeError, TypeError):
        log.warning("Cannot parse column_schema for %s — skipping views", table_name)
        return

    dt_cols = [c["name"] for c in schema if "DateTime" in c.get("type", "")]
    num_cols = [
        c["name"] for c in schema
        if c.get("type") in ("Float64", "Int64") and not _looks_categorical(c["name"])
    ][:5]  # cap numeric cols used in aggregates
    cat_cols = [
        c["name"] for c in schema
        if _looks_categorical(c["name"]) and c.get("type") == "Int64"
    ][:3]

    # Monthly time-series view (requires at least one datetime column)
    if dt_cols:
        _create_monthly_view(client, table_name, dt_cols[0], num_cols)

    # Category breakdown views
    for col in cat_cols:
        _create_category_view(client, table_name, col, num_cols)

    log.info("Created aggregation tables for %s", table_name)


# ---------------------------------------------------------------------------
# Monthly aggregation
# ---------------------------------------------------------------------------

def _create_monthly_view(
    client, table_name: str, dt_col: str, num_cols: list[str]
) -> None:
    view_name = f"agg_monthly_{table_name}"
    client.command(f"DROP TABLE IF EXISTS databrief.`{view_name}`")

    num_col_defs = "".join(
        f"    sum_{c} Float64,\n    avg_{c} Float64,\n"
        for c in num_cols
    )
    num_agg_exprs = ", ".join(
        f"sum(assumeNotNull(`{c}`)) AS sum_{c}, avg(assumeNotNull(`{c}`)) AS avg_{c}"
        for c in num_cols
    )

    client.command(f"""
        CREATE TABLE IF NOT EXISTS databrief.`{view_name}`
        (
            month      Date,
            row_count  UInt64,
            {num_col_defs}
        )
        ENGINE = MergeTree
        ORDER BY month
    """)

    sel_exprs = f"count() AS row_count{', ' + num_agg_exprs if num_agg_exprs else ''}"
    client.command(f"""
        INSERT INTO databrief.`{view_name}`
        SELECT
            toStartOfMonth(`{dt_col}`) AS month,
            {sel_exprs}
        FROM databrief.`{table_name}`
        WHERE `{dt_col}` IS NOT NULL
        GROUP BY month
        ORDER BY month
    """)


# ---------------------------------------------------------------------------
# Category breakdown
# ---------------------------------------------------------------------------

def _create_category_view(
    client, table_name: str, cat_col: str, num_cols: list[str]
) -> None:
    view_name = f"agg_cat_{cat_col}_{table_name}"
    client.command(f"DROP TABLE IF EXISTS databrief.`{view_name}`")

    num_col_defs = "".join(
        f"    sum_{c} Float64,\n    avg_{c} Float64,\n"
        for c in num_cols
    )
    num_agg_exprs = ", ".join(
        f"sum(assumeNotNull(`{c}`)) AS sum_{c}, avg(assumeNotNull(`{c}`)) AS avg_{c}"
        for c in num_cols
    )

    client.command(f"""
        CREATE TABLE IF NOT EXISTS databrief.`{view_name}`
        (
            category_value Int64,
            row_count      UInt64,
            {num_col_defs}
        )
        ENGINE = MergeTree
        ORDER BY (category_value)
    """)

    sel_exprs = f"count() AS row_count{', ' + num_agg_exprs if num_agg_exprs else ''}"
    client.command(f"""
        INSERT INTO databrief.`{view_name}`
        SELECT
            assumeNotNull(`{cat_col}`) AS category_value,
            {sel_exprs}
        FROM databrief.`{table_name}`
        WHERE `{cat_col}` IS NOT NULL
        GROUP BY category_value
        ORDER BY row_count DESC
        LIMIT 20
    """)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CATEGORICAL_KEYWORDS = frozenset([
    "type", "code", "vendor", "status", "flag", "zone", "id",
    "category", "class", "mode", "kind", "tier",
])


def _looks_categorical(col_name: str) -> bool:
    lower = col_name.lower()
    return any(kw in lower for kw in _CATEGORICAL_KEYWORDS)
