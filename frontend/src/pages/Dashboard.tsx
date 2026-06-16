import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { getDataset } from "../api/datasets";
import { getKpis, getTimeSeries, getBreakdown, getRows, getInsights, downloadReport } from "../api/analytics";
import type { Dataset, Kpi, TimeSeriesPoint, BreakdownRow, DataRow, ColumnSchema } from "../types";

export default function Dashboard() {
  const { id } = useParams<{ id: string }>();
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [ts, setTs] = useState<TimeSeriesPoint[]>([]);
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([]);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [page, setPage] = useState(1);
  const [insights, setInsights] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tsCol, setTsCol] = useState("");
  const [breakdownCol, setBreakdownCol] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "data">("overview");
  const [reportDownloading, setReportDownloading] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const [ds, kpiList] = await Promise.all([
          getDataset(id),
          getKpis(id),
        ]);
        setDataset(ds);
        setKpis(kpiList);

        const schema: ColumnSchema[] = JSON.parse(ds.column_schema || "[]");
        const dtCols = schema.filter((c) => c.type.includes("DateTime")).map((c) => c.name);
        const catCols = schema
          .filter((c) => c.type === "Int64" || c.type === "String")
          .filter((c) => /type|code|vendor|payment|flag|zone/i.test(c.name))
          .map((c) => c.name);

        const firstDt = dtCols[0] ?? "";
        const firstCat = catCols[0] ?? (schema[0]?.name ?? "");

        setTsCol(firstDt);
        setBreakdownCol(firstCat);

        const promises: Promise<void>[] = [];
        if (firstDt) {
          promises.push(
            getTimeSeries(id, firstDt, "count", "day")
              .then(setTs)
              .catch(() => {})
          );
        }
        if (firstCat) {
          promises.push(
            getBreakdown(id, firstCat, "count", 8)
              .then(setBreakdown)
              .catch(() => {})
          );
        }
        promises.push(getRows(id, 1, 50).then(setRows).catch(() => {}));
        await Promise.all(promises);
      } finally {
        setLoading(false);
      }

      // Auto-load insights after the page data is ready
      setInsightsLoading(true);
      getInsights(id)
        .then((res) => setInsights(res.narrative))
        .catch(() => {})
        .finally(() => setInsightsLoading(false));
    })();
  }, [id]);

  async function loadMoreRows() {
    if (!id) return;
    const next = page + 1;
    const newRows = await getRows(id, next, 50);
    setRows((prev) => [...prev, ...newRows]);
    setPage(next);
  }

  async function updateTimeSeries(col: string) {
    if (!id) return;
    setTsCol(col);
    const data = await getTimeSeries(id, col, "count", "day");
    setTs(data);
  }

  async function updateBreakdown(col: string) {
    if (!id) return;
    setBreakdownCol(col);
    const data = await getBreakdown(id, col, "count", 8);
    setBreakdown(data);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading dashboard…
      </div>
    );
  }

  if (!dataset) {
    return <div className="text-center py-16 text-gray-500">Dataset not found</div>;
  }

  const schema: ColumnSchema[] = JSON.parse(dataset.column_schema || "[]");
  const dtCols = schema.filter((c) => c.type.includes("DateTime")).map((c) => c.name);
  const allCols = schema.map((c) => c.name);
  const overviewKpis = kpis.filter((k) => k.category === "overview");
  const numericKpis = kpis.filter((k) => k.category === "numeric");

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link to="/" className="text-brand-600 text-sm hover:underline">
            ← Datasets
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{dataset.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {dataset.row_count?.toLocaleString()} rows · {dataset.column_count} columns ·{" "}
            {dataset.file_type.toUpperCase()} · quality {dataset.quality_score}/100
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              if (!id) return;
              setReportDownloading(true);
              try { await downloadReport(id); } catch (e) { console.error(e); }
              finally { setReportDownloading(false); }
            }}
            disabled={reportDownloading}
            className="border border-gray-300 hover:border-gray-400 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition disabled:opacity-50"
          >
            {reportDownloading ? "Generating…" : "Download Report"}
          </button>
          <Link
            to={`/chat?dataset=${id}`}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            Chat about this data
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-gray-200 mb-6">
        {(["overview", "data"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-2 text-sm font-medium border-b-2 transition capitalize ${
              activeTab === tab
                ? "border-brand-500 text-brand-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Overview KPIs */}
          {overviewKpis.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {overviewKpis.map((k) => (
                <KpiCard key={k.kpi_id} kpi={k} />
              ))}
            </div>
          )}

          {/* Numeric KPIs */}
          {numericKpis.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {numericKpis.slice(0, 8).map((k) => (
                <KpiCard key={k.kpi_id} kpi={k} />
              ))}
            </div>
          )}

          {/* Time series chart */}
          {dtCols.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-800">Records over time</h2>
                <select
                  value={tsCol}
                  onChange={(e) => updateTimeSeries(e.target.value)}
                  className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  {dtCols.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              {ts.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={ts}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="period"
                      tick={{ fontSize: 11, fill: "#9ca3af" }}
                      tickFormatter={(v) => v.slice(0, 10)}
                    />
                    <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} width={45} />
                    <Tooltip
                      labelFormatter={(v) => String(v).slice(0, 10)}
                      formatter={(v) => [Number(v).toLocaleString(), "count"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#0ea5e9"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-gray-400 text-sm text-center py-8">No time-series data</p>
              )}
            </div>
          )}

          {/* Category breakdown */}
          {breakdown.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-800">Breakdown by category</h2>
                <select
                  value={breakdownCol}
                  onChange={(e) => updateBreakdown(e.target.value)}
                  className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  {allCols.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={breakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                  <YAxis
                    type="category"
                    dataKey="category"
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    width={80}
                  />
                  <Tooltip formatter={(v) => [Number(v).toLocaleString(), "count"]} />
                  <Bar dataKey="value" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Insights */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="font-semibold text-gray-800 mb-3">AI Insights</h2>
            {insightsLoading ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-3 bg-gray-200 rounded w-5/6" />
                <div className="h-3 bg-gray-200 rounded w-4/6" />
                <div className="h-3 bg-gray-200 rounded w-full mt-4" />
                <div className="h-3 bg-gray-200 rounded w-3/4" />
              </div>
            ) : insights ? (
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {insights}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">
                Set GROQ_API_KEY in .env to enable AI insights.
              </p>
            )}
          </div>
        </div>
      )}

      {activeTab === "data" && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {rows[0] &&
                    Object.keys(rows[0]).map((col) => (
                      <th
                        key={col}
                        className="text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {Object.values(row).map((val, j) => (
                      <td
                        key={j}
                        className="px-3 py-1.5 text-gray-700 whitespace-nowrap max-w-[180px] truncate"
                      >
                        {val === null || val === undefined ? (
                          <span className="text-gray-300">null</span>
                        ) : (
                          String(val)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-gray-100 text-center">
            <button
              onClick={loadMoreRows}
              className="text-sm text-brand-600 hover:text-brand-700 font-medium"
            >
              Load more rows
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const trendColor =
    kpi.trend === "up" ? "text-green-500" : kpi.trend === "down" ? "text-red-500" : "text-gray-400";
  const trendIcon = kpi.trend === "up" ? "↑" : kpi.trend === "down" ? "↓" : "—";

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <p className="text-xs text-gray-500 truncate">{kpi.name}</p>
      <p className="text-xl font-bold text-gray-900 mt-1 truncate">{kpi.value}</p>
      {kpi.change_percent !== 0 && (
        <p className={`text-xs mt-0.5 font-medium ${trendColor}`}>
          {trendIcon} {Math.abs(kpi.change_percent).toFixed(1)}%
        </p>
      )}
    </div>
  );
}
