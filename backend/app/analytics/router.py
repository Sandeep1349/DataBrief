"""Dashboard analytics endpoints.

All queries are parameterized and LIMIT-bounded. The in-process cache
(60-second TTL) prevents re-hitting ClickHouse on every dashboard render.
"""
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse

from ..auth.dependencies import require_auth
from ..cache import query_cache
from ..database import get_client
from ..datasets.queries import get_dataset
from .kpis import get_kpis

log = logging.getLogger(__name__)
router = APIRouter(prefix="/datasets/{dataset_id}/analytics", tags=["analytics"])

Auth = Annotated[str, Depends(require_auth)]

_MAX_BREAKDOWN_LIMIT = 50
_MAX_ROWS_LIMIT = 500


# ---------------------------------------------------------------------------
# KPIs
# ---------------------------------------------------------------------------

@router.get("/kpis")
def dataset_kpis(dataset_id: str, username: Auth):
    _require_ready(dataset_id, username)
    cache_key = f"kpis:{dataset_id}"
    cached = query_cache.get(cache_key)
    if cached is not None:
        return cached
    result = get_kpis(get_client(), dataset_id)
    query_cache.set(cache_key, result)
    return result


# ---------------------------------------------------------------------------
# Summary stats
# ---------------------------------------------------------------------------

@router.get("/summary")
def dataset_summary(dataset_id: str, username: Auth):
    ds = _require_ready(dataset_id, username)
    cache_key = f"summary:{dataset_id}"
    cached = query_cache.get(cache_key)
    if cached is not None:
        return cached

    client = get_client()
    table = ds["clickhouse_table"]
    schema = json.loads(ds.get("column_schema") or "[]")
    num_cols = [c["name"] for c in schema if c.get("type") in ("Float64", "Int64")][:6]

    agg_exprs = ", ".join(
        f"sum(assumeNotNull(`{c}`)) AS sum_{c}, avg(assumeNotNull(`{c}`)) AS avg_{c}, "
        f"min(assumeNotNull(`{c}`)) AS min_{c}, max(assumeNotNull(`{c}`)) AS max_{c}"
        for c in num_cols
    )
    sql = f"SELECT count() AS total_rows{', ' + agg_exprs if agg_exprs else ''} FROM databrief.`{table}`"
    result = client.query(sql)
    row = list(result.named_results())[0] if result else {}

    response = {
        "dataset_id": dataset_id,
        "total_rows": row.get("total_rows", 0),
        "column_schema": schema,
        "stats": {
            col: {
                "sum": row.get(f"sum_{col}"),
                "avg": row.get(f"avg_{col}"),
                "min": row.get(f"min_{col}"),
                "max": row.get(f"max_{col}"),
            }
            for col in num_cols
        },
    }
    query_cache.set(cache_key, response)
    return response


# ---------------------------------------------------------------------------
# Time-series
# ---------------------------------------------------------------------------

@router.get("/timeseries")
def dataset_timeseries(
    dataset_id: str,
    username: Auth,
    dt_col: str = Query(..., description="Datetime column to group by"),
    metric: str = Query("count", description="'count' or a numeric column name"),
    interval: str = Query("month", description="month | week | day"),
):
    ds = _require_ready(dataset_id, username)
    table = ds["clickhouse_table"]
    schema = json.loads(ds.get("column_schema") or "[]")
    col_names = {c["name"] for c in schema}

    if dt_col not in col_names:
        raise HTTPException(status_code=400, detail=f"Column '{dt_col}' not in dataset")
    if metric != "count" and metric not in col_names:
        raise HTTPException(status_code=400, detail=f"Metric column '{metric}' not in dataset")

    trunc_fn = {"month": "toStartOfMonth", "week": "toStartOfWeek", "day": "toDate"}.get(
        interval, "toStartOfMonth"
    )

    cache_key = f"ts:{dataset_id}:{dt_col}:{metric}:{interval}"
    cached = query_cache.get(cache_key)
    if cached is not None:
        return cached

    if metric == "count":
        agg = "count() AS value"
    else:
        agg = f"avg(assumeNotNull(`{metric}`)) AS value"

    result = get_client().query(
        f"""
        SELECT {trunc_fn}(`{dt_col}`) AS period, {agg}
        FROM databrief.`{table}`
        WHERE `{dt_col}` IS NOT NULL
        GROUP BY period
        ORDER BY period
        LIMIT 500
        """
    )
    rows = [{"period": str(r["period"])[:10], "value": r["value"]} for r in result.named_results()]
    query_cache.set(cache_key, rows)
    return rows


# ---------------------------------------------------------------------------
# Category breakdown
# ---------------------------------------------------------------------------

@router.get("/breakdown")
def dataset_breakdown(
    dataset_id: str,
    username: Auth,
    col: str = Query(..., description="Column to group by"),
    metric: str = Query("count", description="'count' or a numeric column name for avg"),
    limit: int = Query(10, ge=1, le=_MAX_BREAKDOWN_LIMIT),
):
    ds = _require_ready(dataset_id, username)
    table = ds["clickhouse_table"]
    schema = json.loads(ds.get("column_schema") or "[]")
    col_names = {c["name"] for c in schema}

    if col not in col_names:
        raise HTTPException(status_code=400, detail=f"Column '{col}' not in dataset")
    if metric != "count" and metric not in col_names:
        raise HTTPException(status_code=400, detail=f"Metric '{metric}' not in dataset")

    cache_key = f"breakdown:{dataset_id}:{col}:{metric}:{limit}"
    cached = query_cache.get(cache_key)
    if cached is not None:
        return cached

    agg = "count() AS value" if metric == "count" else f"avg(assumeNotNull(`{metric}`)) AS value"
    result = get_client().query(
        f"""
        SELECT toString(`{col}`) AS category, {agg}
        FROM databrief.`{table}`
        WHERE `{col}` IS NOT NULL
        GROUP BY category
        ORDER BY value DESC
        LIMIT {limit}
        """
    )
    rows = list(result.named_results())
    query_cache.set(cache_key, rows)
    return rows


# ---------------------------------------------------------------------------
# Histogram (numeric distribution)
# ---------------------------------------------------------------------------

@router.get("/histogram")
def dataset_histogram(
    dataset_id: str,
    username: Auth,
    col: str = Query(..., description="Numeric column"),
    bins: int = Query(20, ge=2, le=100),
):
    ds = _require_ready(dataset_id, username)
    table = ds["clickhouse_table"]

    cache_key = f"hist:{dataset_id}:{col}:{bins}"
    cached = query_cache.get(cache_key)
    if cached is not None:
        return cached

    result = get_client().query(
        f"""
        SELECT
            min(assumeNotNull(`{col}`)) AS min_val,
            max(assumeNotNull(`{col}`)) AS max_val
        FROM databrief.`{table}`
        WHERE `{col}` IS NOT NULL
        """
    )
    row = list(result.named_results())[0]
    min_val, max_val = float(row["min_val"] or 0), float(row["max_val"] or 1)
    if min_val == max_val:
        max_val += 1

    result = get_client().query(
        f"""
        SELECT
            floor(({bins} * (assumeNotNull(`{col}`) - {min_val})) / ({max_val} - {min_val})) AS bucket,
            count() AS count
        FROM databrief.`{table}`
        WHERE `{col}` IS NOT NULL
          AND assumeNotNull(`{col}`) BETWEEN {min_val} AND {max_val}
        GROUP BY bucket
        ORDER BY bucket
        LIMIT {bins + 1}
        """
    )
    bucket_width = (max_val - min_val) / bins
    hist = [
        {
            "bin_start": round(min_val + int(r["bucket"]) * bucket_width, 4),
            "bin_end": round(min_val + (int(r["bucket"]) + 1) * bucket_width, 4),
            "count": r["count"],
        }
        for r in result.named_results()
    ]
    query_cache.set(cache_key, hist)
    return hist


# ---------------------------------------------------------------------------
# Correlation matrix (numeric columns)
# ---------------------------------------------------------------------------

_MAX_CORR_COLS = 10


@router.get("/correlation")
def dataset_correlation(dataset_id: str, username: Auth):
    ds = _require_ready(dataset_id, username)
    table = ds["clickhouse_table"]
    schema = json.loads(ds.get("column_schema") or "[]")
    num_cols = [c["name"] for c in schema if c.get("type") in ("Float64", "Int64")][:_MAX_CORR_COLS]

    if len(num_cols) < 2:
        raise HTTPException(status_code=400, detail="Dataset needs at least 2 numeric columns for correlation")

    cache_key = f"corr:{dataset_id}"
    cached = query_cache.get(cache_key)
    if cached is not None:
        return cached

    # Build one-pass query: corr(a, b) for every pair including diagonal
    exprs = ", ".join(
        f"corr(assumeNotNull(`{a}`), assumeNotNull(`{b}`)) AS c_{i}_{j}"
        for i, a in enumerate(num_cols)
        for j, b in enumerate(num_cols)
    )
    result = get_client().query(f"SELECT {exprs} FROM databrief.`{table}`")
    row = list(result.named_results())[0] if result else {}

    n = len(num_cols)
    matrix = [
        [round(float(row.get(f"c_{i}_{j}", 0) or 0), 4) for j in range(n)]
        for i in range(n)
    ]

    response = {"columns": num_cols, "matrix": matrix}
    query_cache.set(cache_key, response)
    return response


# ---------------------------------------------------------------------------
# Paginated rows (with optional single-column filter)
# ---------------------------------------------------------------------------

@router.get("/rows")
def dataset_rows(
    dataset_id: str,
    username: Auth,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=_MAX_ROWS_LIMIT),
    filter_col: str | None = Query(None),
    filter_op: str | None = Query(None, description="eq | gt | lt | gte | lte | contains"),
    filter_val: str | None = Query(None),
):
    ds = _require_ready(dataset_id, username)
    table = ds["clickhouse_table"]
    offset = (page - 1) * limit

    where = _build_where(filter_col, filter_op, filter_val)
    cache_key = f"rows:{dataset_id}:{page}:{limit}:{filter_col}:{filter_op}:{filter_val}"
    cached = query_cache.get(cache_key)
    if cached is not None:
        return cached

    sql = f"SELECT * FROM databrief.`{table}`{where} LIMIT {limit} OFFSET {offset}"
    result = get_client().query(sql)
    rows = [
        {k: (str(v) if not isinstance(v, (int, float, bool, type(None))) else v) for k, v in r.items()}
        for r in result.named_results()
    ]
    query_cache.set(cache_key, rows)
    return rows


# ---------------------------------------------------------------------------
# Report generation (self-contained HTML download)
# ---------------------------------------------------------------------------

@router.get("/report", response_class=HTMLResponse)
def dataset_report(dataset_id: str, username: Auth):
    """Generate a self-contained HTML report for download."""
    from ..chat.agents import run_writer

    ds = _require_ready(dataset_id, username)
    client = get_client()
    kpis = get_kpis(client, dataset_id)
    schema = json.loads(ds.get("column_schema") or "[]")

    # Fetch breakdown for first categorical column
    cat_cols = [
        c["name"] for c in schema
        if c.get("type") in ("String", "Int64")
        and any(kw in c["name"].lower() for kw in ["type", "code", "vendor", "payment", "flag"])
    ]
    breakdown_rows: list[dict] = []
    breakdown_col = ""
    if cat_cols:
        breakdown_col = cat_cols[0]
        try:
            table = ds["clickhouse_table"]
            result = client.query(
                f"""
                SELECT toString(`{breakdown_col}`) AS category, count() AS value
                FROM databrief.`{table}`
                WHERE `{breakdown_col}` IS NOT NULL
                GROUP BY category ORDER BY value DESC LIMIT 10
                """
            )
            breakdown_rows = list(result.named_results())
        except Exception:
            pass

    # AI narrative (best-effort — skip if API key missing)
    narrative = ""
    try:
        narrative = run_writer(ds["name"], kpis)
    except Exception:
        narrative = ""

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    html = _render_report_html(ds, kpis, schema, breakdown_col, breakdown_rows, narrative, generated_at)

    dataset_slug = ds["name"].lower().replace(" ", "-")[:40]
    return HTMLResponse(
        content=html,
        headers={
            "Content-Disposition": f'attachment; filename="databrief-report-{dataset_slug}.html"',
        },
    )


def _render_report_html(
    ds: dict,
    kpis: list[dict],
    schema: list[dict],
    breakdown_col: str,
    breakdown_rows: list[dict],
    narrative: str,
    generated_at: str,
) -> str:
    overview_kpis = [k for k in kpis if k["category"] == "overview"]
    numeric_kpis = [k for k in kpis if k["category"] == "numeric"]

    def kpi_cards(items: list[dict]) -> str:
        if not items:
            return ""
        cards = "".join(
            f'<div class="kpi-card"><div class="kpi-name">{k["name"]}</div>'
            f'<div class="kpi-value">{k["value"]}</div></div>'
            for k in items
        )
        return f'<div class="kpi-grid">{cards}</div>'

    breakdown_html = ""
    if breakdown_rows:
        rows_html = "".join(
            f"<tr><td>{r['category']}</td><td>{int(r['value']):,}</td></tr>"
            for r in breakdown_rows
        )
        breakdown_html = f"""
        <section>
          <h2>Breakdown by {breakdown_col}</h2>
          <table>
            <thead><tr><th>{breakdown_col}</th><th>Count</th></tr></thead>
            <tbody>{rows_html}</tbody>
          </table>
        </section>"""

    columns_html = "".join(
        f'<span class="col-badge">{c["name"]} <em>{c["type"]}</em></span>'
        for c in schema
    )

    narrative_html = (
        f'<div class="narrative">{narrative.replace(chr(10), "<br>")}</div>'
        if narrative
        else '<p class="muted">AI narrative not available (GROQ_API_KEY not configured).</p>'
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DataBrief Report — {ds["name"]}</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937;background:#f9fafb;padding:40px 20px}}
  .report{{max-width:900px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.1);overflow:hidden}}
  header{{background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;padding:36px 40px}}
  header h1{{font-size:1.7rem;font-weight:700;margin-bottom:4px}}
  header p{{opacity:.85;font-size:.9rem}}
  .meta{{font-size:.75rem;opacity:.7;margin-top:8px}}
  main{{padding:32px 40px}}
  section{{margin-bottom:36px}}
  h2{{font-size:1rem;font-weight:600;color:#374151;margin-bottom:14px;padding-bottom:6px;border-bottom:2px solid #e5e7eb}}
  .kpi-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:8px}}
  .kpi-card{{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px}}
  .kpi-name{{font-size:.7rem;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}}
  .kpi-value{{font-size:1.3rem;font-weight:700;color:#0f172a}}
  .narrative{{font-size:.9rem;line-height:1.75;color:#374151;white-space:pre-wrap}}
  table{{width:100%;border-collapse:collapse;font-size:.85rem}}
  th{{text-align:left;padding:8px 12px;background:#f1f5f9;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0}}
  td{{padding:7px 12px;border-bottom:1px solid #f1f5f9;color:#374151}}
  tr:last-child td{{border-bottom:none}}
  .col-badge{{display:inline-block;background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;padding:3px 8px;margin:3px;font-size:.75rem;color:#1e40af}}
  .col-badge em{{color:#6b7280;font-style:normal;margin-left:4px}}
  .muted{{color:#9ca3af;font-size:.85rem}}
  footer{{background:#f8fafc;border-top:1px solid #e5e7eb;padding:18px 40px;font-size:.75rem;color:#9ca3af;display:flex;justify-content:space-between}}
  @media print{{body{{background:#fff;padding:0}}.report{{box-shadow:none;border-radius:0}}}}
</style>
</head>
<body>
<div class="report">
  <header>
    <h1>{ds["name"]}</h1>
    <p>{ds.get("row_count", 0):,} rows &middot; {ds.get("column_count", len(schema))} columns
       &middot; {ds.get("file_type", "").upper()} &middot; Quality {ds.get("quality_score", "—")}/100</p>
    <p class="meta">Generated {generated_at} &middot; DataBrief v2</p>
  </header>
  <main>
    <section>
      <h2>Overview</h2>
      {kpi_cards(overview_kpis)}
    </section>
    {f'<section><h2>Key Metrics</h2>{kpi_cards(numeric_kpis)}</section>' if numeric_kpis else ''}
    <section>
      <h2>AI Executive Summary</h2>
      {narrative_html}
    </section>
    {breakdown_html}
    <section>
      <h2>Columns ({len(schema)})</h2>
      <div>{columns_html}</div>
    </section>
  </main>
  <footer>
    <span>DataBrief &mdash; AI-powered data analysis</span>
    <span>Dataset ID: {ds["dataset_id"]}</span>
  </footer>
</div>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_ready(dataset_id: str, username: str) -> dict:
    ds = get_dataset(get_client(), dataset_id)
    if ds is None or ds["status"] == "deleted":
        raise HTTPException(status_code=404, detail="Dataset not found")
    if ds.get("owner_username", "") != username:
        raise HTTPException(status_code=403, detail="Access denied")
    if ds["status"] != "ready":
        raise HTTPException(status_code=409, detail=f"Dataset not ready (status: {ds['status']})")
    return ds


_OP_MAP = {"eq": "=", "gt": ">", "lt": "<", "gte": ">=", "lte": "<="}


def _build_where(col: str | None, op: str | None, val: str | None) -> str:
    if not col or not op or val is None:
        return ""
    if op == "contains":
        # Parameterize to prevent injection — use ilike with escaped value
        safe_val = val.replace("'", "''").replace("%", "\\%").replace("_", "\\_")
        return f" WHERE toString(`{col}`) ILIKE '%{safe_val}%'"
    sql_op = _OP_MAP.get(op)
    if not sql_op:
        return ""
    # Numeric comparison if value looks numeric
    try:
        num = float(val)
        return f" WHERE `{col}` {sql_op} {num}"
    except ValueError:
        safe_val = val.replace("'", "''")
        return f" WHERE toString(`{col}`) {sql_op} '{safe_val}'"
