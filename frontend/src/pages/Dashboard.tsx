import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { getDataset } from "../api/datasets";
import { getKpis, getTimeSeries, getBreakdown, getRows, getInsights, downloadReport } from "../api/analytics";
import type { Dataset, Kpi, TimeSeriesPoint, BreakdownRow, DataRow, ColumnSchema } from "../types";
import { useTheme } from "../ThemeContext";

export default function Dashboard() {
  const { id } = useParams<{ id: string }>();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const tok = {
    surface:    dark ? "#0d1235" : "#ffffff",
    surfaceAlt: dark ? "#07102a" : "#f8fafc",
    border:     dark ? "#1e2a4a" : "rgba(226,232,240,0.8)",
    borderSub:  dark ? "#1a2640" : "#f1f5f9",
    t1:         dark ? "#dde5ff" : "#1e293b",
    t2:         dark ? "#94a3b8" : "#475569",
    t3:         dark ? "#64748b" : "#94a3b8",
    tabBg:      dark ? "#080e28" : "#f1f5f9",
    tabActive:  dark ? "#131f45" : "#ffffff",
    skeleton:   dark ? "#1e2a4a" : "#f1f5f9",
    rowHover:   dark ? "rgba(255,255,255,0.025)" : "rgba(240,249,255,0.4)",
    cellText:   dark ? "#94a3b8" : "#475569",
    nullText:   dark ? "#334155" : "#cbd5e1",
    chart: {
      grid:    dark ? "#1a2640" : "#f1f5f9",
      tick:    dark ? "#64748b" : "#94a3b8",
      tooltip: dark
        ? { bg: "#0d1235", border: "#2d3a6a", text: "#dde5ff" }
        : { bg: "#ffffff", border: "#e2e8f0", text: "#334155" },
    },
    quality: {
      bg:  dark ? "rgba(16,185,129,0.1)" : "#ecfdf5",
      bdr: dark ? "rgba(16,185,129,0.2)" : "#d1fae5",
      txt: dark ? "#34d399" : "#059669",
      dot: dark ? "#34d399" : "#10b981",
    },
    reportBtn: {
      bg:  dark ? "rgba(255,255,255,0.04)" : "#ffffff",
      bdr: dark ? "#2d3a6a" : "#e2e8f0",
      txt: dark ? "#94a3b8" : "#475569",
    },
  };

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
        const [ds, kpiList] = await Promise.all([getDataset(id), getKpis(id)]);
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
        if (firstDt) promises.push(getTimeSeries(id, firstDt, "count", "day").then(setTs).catch(() => {}));
        if (firstCat) promises.push(getBreakdown(id, firstCat, "count", 8).then(setBreakdown).catch(() => {}));
        promises.push(getRows(id, 1, 50).then(setRows).catch(() => {}));
        await Promise.all(promises);
      } finally {
        setLoading(false);
      }

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
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 mx-auto mb-4 animate-pulse" />
          <p className="text-sm" style={{ color: tok.t3 }}>Loading dashboard…</p>
        </div>
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <p className="text-sm" style={{ color: tok.t3 }}>Dataset not found</p>
      </div>
    );
  }

  const schema: ColumnSchema[] = JSON.parse(dataset.column_schema || "[]");
  const dtCols = schema.filter((c) => c.type.includes("DateTime")).map((c) => c.name);
  const allCols = schema.map((c) => c.name);
  const overviewKpis = kpis.filter((k) => k.category === "overview");
  const numericKpis = kpis.filter((k) => k.category === "numeric");

  const selectStyle = {
    background: tok.surface,
    borderColor: tok.border,
    color: tok.t2,
    fontSize: "0.75rem",
    borderRadius: "0.5rem",
    padding: "0.375rem 0.625rem",
    outline: "none",
    border: `1px solid ${tok.border}`,
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs transition-colors mb-2 group"
            style={{ color: tok.t3 }}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 transition-transform group-hover:-translate-x-0.5">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            All Datasets
          </Link>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: tok.t1 }}>{dataset.name}</h1>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-sm" style={{ color: tok.t3 }}>
              {dataset.row_count?.toLocaleString()} rows · {dataset.column_count} columns · {dataset.file_type.toUpperCase()}
            </span>
            <span
              className="inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-0.5 font-semibold border"
              style={{ background: tok.quality.bg, color: tok.quality.txt, borderColor: tok.quality.bdr }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: tok.quality.dot }} />
              Quality {dataset.quality_score}/100
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={async () => {
              if (!id) return;
              setReportDownloading(true);
              try { await downloadReport(id); } catch (e) { console.error(e); }
              finally { setReportDownloading(false); }
            }}
            disabled={reportDownloading}
            className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl transition-all shadow-sm disabled:opacity-50"
            style={{ background: tok.reportBtn.bg, border: `1px solid ${tok.reportBtn.bdr}`, color: tok.reportBtn.txt }}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            {reportDownloading ? "Generating…" : "Report"}
          </button>
          <Link
            to={`/chat?dataset=${id}`}
            className="flex items-center gap-2 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all shadow-md hover:shadow-lg"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" clipRule="evenodd" />
            </svg>
            Chat about this
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 rounded-2xl p-1 mb-8 w-fit"
        style={{ background: tok.tabBg }}
      >
        {(["overview", "data"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-5 py-2 rounded-xl text-sm font-semibold transition-all capitalize"
            style={
              activeTab === tab
                ? { background: tok.tabActive, color: tok.t1, boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }
                : { background: "transparent", color: tok.t3 }
            }
          >
            {tab === "overview" ? "Overview" : "Raw Data"}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-6">
          {overviewKpis.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {overviewKpis.map((k) => (
                <KpiCard key={k.kpi_id} kpi={k} accent="sky" dark={dark} tok={tok} />
              ))}
            </div>
          )}

          {numericKpis.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {numericKpis.slice(0, 8).map((k, i) => (
                <KpiCard key={k.kpi_id} kpi={k} accent={["indigo", "violet", "fuchsia", "pink"][i % 4] as AccentColor} dark={dark} tok={tok} />
              ))}
            </div>
          )}

          {dtCols.length > 0 && (
            <ChartCard
              title="Records over time"
              dark={dark}
              tok={tok}
              control={
                <select
                  value={tsCol}
                  onChange={(e) => updateTimeSeries(e.target.value)}
                  style={selectStyle}
                >
                  {dtCols.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              }
            >
              {ts.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={ts}>
                    <defs>
                      <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#38bdf8" />
                        <stop offset="100%" stopColor="#818cf8" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={tok.chart.grid} />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: tok.chart.tick }} tickFormatter={(v) => v.slice(0, 10)} />
                    <YAxis tick={{ fontSize: 11, fill: tok.chart.tick }} width={45} />
                    <Tooltip
                      contentStyle={{ borderRadius: "12px", border: `1px solid ${tok.chart.tooltip.border}`, background: tok.chart.tooltip.bg, color: tok.chart.tooltip.text, boxShadow: "0 4px 16px rgba(0,0,0,0.2)" }}
                      labelStyle={{ color: tok.chart.tooltip.text }}
                      itemStyle={{ color: tok.chart.tooltip.text }}
                      labelFormatter={(v) => String(v).slice(0, 10)}
                      formatter={(v) => [Number(v).toLocaleString(), "count"]}
                    />
                    <Line type="monotone" dataKey="value" stroke="url(#lineGrad)" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-center py-12" style={{ color: tok.t3 }}>No time-series data available</p>
              )}
            </ChartCard>
          )}

          {breakdown.length > 0 && (
            <ChartCard
              title="Breakdown by category"
              dark={dark}
              tok={tok}
              control={
                <select
                  value={breakdownCol}
                  onChange={(e) => updateBreakdown(e.target.value)}
                  style={selectStyle}
                >
                  {allCols.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              }
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={breakdown} layout="vertical">
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#38bdf8" />
                      <stop offset="100%" stopColor="#818cf8" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={tok.chart.grid} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: tok.chart.tick }} />
                  <YAxis type="category" dataKey="category" tick={{ fontSize: 11, fill: tok.chart.tick }} width={80} />
                  <Tooltip
                    contentStyle={{ borderRadius: "12px", border: `1px solid ${tok.chart.tooltip.border}`, background: tok.chart.tooltip.bg, color: tok.chart.tooltip.text, boxShadow: "0 4px 16px rgba(0,0,0,0.2)" }}
                    labelStyle={{ color: tok.chart.tooltip.text }}
                    itemStyle={{ color: tok.chart.tooltip.text }}
                    formatter={(v) => [Number(v).toLocaleString(), "count"]}
                  />
                  <Bar dataKey="value" fill="url(#barGrad)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {/* AI Insights */}
          <div
            className="rounded-3xl shadow-sm overflow-hidden"
            style={{ background: tok.surface, border: `1px solid ${tok.border}` }}
          >
            <div
              className="px-6 py-4 flex items-center gap-3"
              style={{ borderBottom: `1px solid ${tok.borderSub}` }}
            >
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center shadow-sm">
                <svg viewBox="0 0 20 20" fill="white" className="w-4 h-4">
                  <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.997.295-1.956.804-2.75A4 4 0 108.196 11.25 4.992 4.992 0 008 14v1h4v-1z" />
                </svg>
              </div>
              <h2 className="font-semibold" style={{ color: tok.t2 }}>AI Insights</h2>
              {insightsLoading && (
                <span className="ml-1 flex gap-0.5">
                  <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
                </span>
              )}
            </div>
            <div className="p-6">
              {insightsLoading ? (
                <div className="space-y-2.5 animate-pulse">
                  {[1, 5/6, 4/6, 1, 3/4].map((w, i) => (
                    <div key={i} className="h-3 rounded-full" style={{ background: tok.skeleton, width: `${w * 100}%` }} />
                  ))}
                </div>
              ) : insights ? (
                <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: tok.cellText }}>{insights}</p>
              ) : (
                <p className="text-sm" style={{ color: tok.t3 }}>Set GROQ_API_KEY in .env to enable AI insights.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "data" && (
        <div
          className="rounded-3xl shadow-sm overflow-hidden"
          style={{ background: tok.surface, border: `1px solid ${tok.border}` }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: tok.surfaceAlt, borderBottom: `1px solid ${tok.borderSub}` }}>
                  {rows[0] &&
                    Object.keys(rows[0]).map((col) => (
                      <th
                        key={col}
                        className="text-left px-4 py-3 font-semibold whitespace-nowrap tracking-tight"
                        style={{ color: tok.t3 }}
                      >
                        {col}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    className="transition-colors"
                    style={{ borderBottom: `1px solid ${tok.borderSub}` }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = tok.rowHover; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    {Object.values(row).map((val, j) => (
                      <td key={j} className="px-4 py-2 whitespace-nowrap max-w-[200px] truncate" style={{ color: tok.cellText }}>
                        {val === null || val === undefined ? (
                          <span className="italic" style={{ color: tok.nullText }}>null</span>
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
          <div className="p-5 text-center" style={{ borderTop: `1px solid ${tok.borderSub}` }}>
            <button
              onClick={loadMoreRows}
              className="text-sm font-semibold transition-colors hover:underline"
              style={{ color: "#38bdf8" }}
            >
              Load more rows
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type AccentColor = "sky" | "indigo" | "violet" | "fuchsia" | "pink";

const ACCENT_BAR: Record<AccentColor, string> = {
  sky:     "from-sky-400 to-sky-500",
  indigo:  "from-indigo-400 to-indigo-500",
  violet:  "from-violet-400 to-violet-500",
  fuchsia: "from-fuchsia-400 to-fuchsia-500",
  pink:    "from-pink-400 to-pink-500",
};

const ACCENT_VALUE_DARK: Record<AccentColor, string> = {
  sky:     "#7dd3fc",
  indigo:  "#a5b4fc",
  violet:  "#c4b5fd",
  fuchsia: "#f0abfc",
  pink:    "#f9a8d4",
};

const ACCENT_VALUE_LIGHT: Record<AccentColor, string> = {
  sky:     "#0c4a6e",
  indigo:  "#312e81",
  violet:  "#4c1d95",
  fuchsia: "#701a75",
  pink:    "#831843",
};

type DashTok = {
  surface: string; surfaceAlt: string; border: string; borderSub: string;
  t1: string; t2: string; t3: string; tabBg: string; tabActive: string;
  skeleton: string; rowHover: string; cellText: string; nullText: string;
  chart: { grid: string; tick: string; tooltip: { bg: string; border: string; text: string } };
  quality: { bg: string; bdr: string; txt: string; dot: string };
  reportBtn: { bg: string; bdr: string; txt: string };
};

function KpiCard({
  kpi, accent = "sky", dark, tok,
}: {
  kpi: Kpi;
  accent?: AccentColor;
  dark: boolean;
  tok: DashTok;
}) {
  const valueColor = dark ? ACCENT_VALUE_DARK[accent] : ACCENT_VALUE_LIGHT[accent];
  const trendColor = kpi.trend === "up" ? "#10b981" : kpi.trend === "down" ? "#f43f5e" : tok.t3;
  const trendIcon  = kpi.trend === "up" ? "↑" : kpi.trend === "down" ? "↓" : "—";

  return (
    <div
      className="rounded-2xl shadow-sm overflow-hidden transition-all duration-200 hover:shadow-md"
      style={{ background: tok.surface, border: `1px solid ${tok.border}` }}
    >
      <div className={`h-1 bg-gradient-to-r ${ACCENT_BAR[accent]}`} />
      <div className="p-4">
        <p className="text-xs font-medium truncate uppercase tracking-wide" style={{ color: tok.t3 }}>{kpi.name}</p>
        <p className="text-2xl font-bold mt-1.5 truncate" style={{ color: valueColor }}>{kpi.value}</p>
        {kpi.change_percent !== 0 && (
          <p className="text-xs mt-1 font-semibold" style={{ color: trendColor }}>
            {trendIcon} {Math.abs(kpi.change_percent).toFixed(1)}%
          </p>
        )}
      </div>
    </div>
  );
}

function ChartCard({
  title, control, children, tok,
}: {
  title: string;
  control?: React.ReactNode;
  children: React.ReactNode;
  dark: boolean;
  tok: DashTok;
}) {
  return (
    <div
      className="rounded-3xl shadow-sm overflow-hidden"
      style={{ background: tok.surface, border: `1px solid ${tok.border}` }}
    >
      <div
        className="px-6 py-4 flex items-center justify-between"
        style={{ borderBottom: `1px solid ${tok.borderSub}` }}
      >
        <h2 className="font-semibold" style={{ color: tok.t2 }}>{title}</h2>
        {control}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}
