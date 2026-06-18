import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { listDatasets } from "../api/datasets";
import type { Dataset } from "../types";

// ─── Animated background orbs ─────────────────────────────────────────────────

function BgOrbs() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      <div
        className="animate-orb absolute rounded-full"
        style={{
          width: 700, height: 700,
          top: "-250px", left: "-150px",
          background: "radial-gradient(circle, var(--c-orb-1) 0%, transparent 70%)",
        }}
      />
      <div
        className="animate-orb absolute rounded-full"
        style={{
          width: 600, height: 600,
          bottom: "-200px", right: "-150px",
          background: "radial-gradient(circle, var(--c-orb-2) 0%, transparent 70%)",
          animationDelay: "-4s",
        }}
      />
      <div
        className="animate-orb absolute rounded-full"
        style={{
          width: 400, height: 400,
          top: "40%", left: "50%",
          background: "radial-gradient(circle, var(--c-orb-3) 0%, transparent 70%)",
          animationDelay: "-8s",
        }}
      />
      {/* Grid overlay */}
      <div className="absolute inset-0 bg-grid opacity-60" />
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accentColor,
  icon,
  delay = 0,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accentColor: string;
  icon: React.ReactNode;
  delay?: number;
}) {
  return (
    <div
      className="neo-card rounded-2xl p-6 flex flex-col gap-3 group cursor-default animate-slide-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Top row */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</p>
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110"
          style={{
            background: `${accentColor}15`,
            border: `1px solid ${accentColor}25`,
            boxShadow: `0 0 15px ${accentColor}10`,
          }}
        >
          <span style={{ color: accentColor, filter: `drop-shadow(0 0 6px ${accentColor}80)` }}>
            {icon}
          </span>
        </div>
      </div>

      {/* Value */}
      <p
        className="text-4xl font-black tracking-tight animate-count-in"
        style={{
          color: accentColor,
          textShadow: `0 0 30px ${accentColor}50`,
          animationDelay: `${delay + 100}ms`,
        }}
      >
        {value}
      </p>

      {/* Sub */}
      {sub && (
        <p className="text-xs text-slate-600 font-medium leading-relaxed">{sub}</p>
      )}

      {/* Bottom accent line */}
      <div
        className="h-px mt-1 rounded-full transition-all duration-500 group-hover:opacity-100"
        style={{
          background: `linear-gradient(90deg, ${accentColor}60, transparent)`,
          opacity: 0.4,
        }}
      />
    </div>
  );
}

// ─── Quick action card ────────────────────────────────────────────────────────

function QuickAction({
  to,
  icon,
  title,
  desc,
  gradient,
  glowColor,
  delay = 0,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  gradient: string;
  glowColor: string;
  delay?: number;
}) {
  return (
    <Link
      to={to}
      className="neo-card rounded-2xl p-5 flex items-start gap-4 group animate-slide-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300 group-hover:scale-110 group-hover:rotate-3"
        style={{
          background: gradient,
          boxShadow: `0 0 20px ${glowColor}30`,
        }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-200 text-sm group-hover:text-white transition-colors">{title}</p>
        <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{desc}</p>
      </div>
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-4 h-4 text-slate-700 group-hover:text-cyan-400 ml-auto shrink-0 mt-0.5 transition-all duration-200 group-hover:translate-x-1"
      >
        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
      </svg>
    </Link>
  );
}

// ─── HomeDashboard ────────────────────────────────────────────────────────────

export default function HomeDashboard() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listDatasets()
      .then((list) => setDatasets(list.filter((d) => d.status !== "deleted")))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const ready = datasets.filter((d) => d.status === "ready");
  const processing = datasets.filter((d) => d.status === "processing" || d.status === "queued");
  const totalRows = ready.reduce((acc, d) => acc + (d.row_count ?? 0), 0);
  const recent = [...ready].slice(0, 5);

  return (
    <div className="relative min-h-screen p-8" style={{ background: "var(--c-bg)" }}>
      <BgOrbs />

      {/* Content above orbs */}
      <div className="relative z-10 max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-10 animate-slide-up">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-2 h-8 rounded-full"
              style={{ background: "linear-gradient(180deg, #38bdf8, #c084fc)", boxShadow: "0 0 14px rgba(139,92,246,0.7)" }}
            />
            <h1 className="text-3xl font-black text-white tracking-tight">
              Mission{" "}
              <span className="text-gradient">Control</span>
            </h1>
          </div>
          <p className="text-slate-500 text-sm ml-5">
            Real-time overview of your data intelligence workspace
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard
            label="Total Databases"
            value={loading ? "—" : datasets.length}
            sub={ready.length > 0 ? `${ready.length} online · ready to query` : "No databases yet"}
            accentColor="#38bdf8"
            delay={0}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z" />
                <path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z" />
                <path d="M17 5c0 1.657-3.134 3-7 3S3 6.657 3 5s3.134-3 7-3 7 1.343 7 3z" />
              </svg>
            }
          />
          <StatCard
            label="Total Rows"
            value={
              loading
                ? "—"
                : totalRows >= 1_000_000
                ? `${(totalRows / 1_000_000).toFixed(1)}M`
                : totalRows >= 1_000
                ? `${(totalRows / 1_000).toFixed(1)}k`
                : totalRows
            }
            sub="indexed across all datasets"
            accentColor="#8b5cf6"
            delay={80}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
              </svg>
            }
          />
          <StatCard
            label="Processing"
            value={loading ? "—" : processing.length}
            sub={processing.length > 0 ? "active imports in queue" : "system idle · all clear"}
            accentColor={processing.length > 0 ? "#f59e0b" : "#10b981"}
            delay={160}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
            }
          />
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-3 gap-6">
          {/* Recent databases */}
          <div className="col-span-2 animate-slide-up" style={{ animationDelay: "200ms" }}>
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: "var(--c-surface)",
                border: "1px solid var(--c-border)",
              }}
            >
              <div
                className="px-6 py-4 flex items-center justify-between"
                style={{ borderBottom: "1px solid var(--c-border)" }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-1.5 h-4 rounded-full"
                    style={{ background: "linear-gradient(180deg, #38bdf8, #c084fc)", boxShadow: "0 0 10px rgba(139,92,246,0.65)" }}
                  />
                  <h2 className="font-bold text-slate-300 text-sm tracking-wide">Recent Databases</h2>
                </div>
                <Link
                  to="/databases"
                  className="text-xs text-violet-400 hover:text-violet-300 font-semibold transition-all hover:drop-shadow-[0_0_8px_rgba(192,132,252,0.6)] flex items-center gap-1"
                >
                  View all
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                </Link>
              </div>

              {loading ? (
                <div className="p-6 space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-14 rounded-xl animate-shimmer"
                      style={{ background: "var(--c-surface-hover)" }}
                    />
                  ))}
                </div>
              ) : recent.length === 0 ? (
                <div className="p-12 text-center">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-float"
                    style={{
                      background: "rgba(139,92,246,0.1)",
                      border: "1px solid rgba(139,92,246,0.2)",
                    }}
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8" style={{ color: "rgba(192,132,252,0.65)" }}>
                      <path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z" />
                      <path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z" />
                      <path d="M17 5c0 1.657-3.134 3-7 3S3 6.657 3 5s3.134-3 7-3 7 1.343 7 3z" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-slate-400">No data loaded yet</p>
                  <p className="text-xs text-slate-600 mt-1">Upload a file or connect a data source to begin</p>
                  <Link
                    to="/upload"
                    className="inline-flex mt-5 items-center gap-2 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all btn-neon"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                    Upload first dataset
                  </Link>
                </div>
              ) : (
                <div>
                  {recent.map((ds, idx) => (
                    <Link
                      key={ds.dataset_id}
                      to={`/datasets/${ds.dataset_id}`}
                      className="flex items-center gap-4 px-6 py-4 group transition-all duration-200 hover:bg-cyan-500/[0.03]"
                      style={{
                        borderBottom: idx < recent.length - 1 ? "1px solid var(--c-border)" : "none",
                      }}
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300 group-hover:scale-110"
                        style={{
                          background: "linear-gradient(135deg, rgba(99,102,241,0.18), rgba(168,85,247,0.18))",
                          border: "1px solid rgba(139,92,246,0.22)",
                        }}
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-violet-400">
                          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-300 truncate group-hover:text-white transition-colors">{ds.name}</p>
                        <p className="text-xs text-slate-600 mt-0.5">
                          {ds.row_count != null ? ds.row_count.toLocaleString() : "—"} rows · {ds.column_count ?? "—"} columns
                        </p>
                      </div>
                      <span
                        className="text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0"
                        style={{
                          background: "rgba(139,92,246,0.12)",
                          border: "1px solid rgba(139,92,246,0.25)",
                          color: "#c084fc",
                        }}
                      >
                        {ds.file_type.toUpperCase()}
                      </span>
                      <svg
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="w-4 h-4 text-slate-700 group-hover:text-cyan-400 shrink-0 transition-all duration-200 group-hover:translate-x-1"
                      >
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 px-1">
              <div
                className="w-1 h-4 rounded-full"
                style={{ background: "linear-gradient(180deg, #c084fc, #38bdf8)", boxShadow: "0 0 10px rgba(192,132,252,0.65)" }}
              />
              <h2 className="font-bold text-slate-400 text-xs uppercase tracking-widest">Quick Actions</h2>
            </div>
            <QuickAction
              to="/upload"
              gradient="linear-gradient(135deg, #38bdf8, #6366f1)"
              glowColor="#6366f1"
              delay={240}
              icon={
                <svg viewBox="0 0 20 20" fill="white" className="w-5 h-5">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              }
              title="Upload Data"
              desc="Import CSV, Excel, Parquet, JSON or TSV"
            />
            <QuickAction
              to="/connect"
              gradient="linear-gradient(135deg, #8b5cf6, #ec4899)"
              glowColor="#8b5cf6"
              delay={300}
              icon={
                <svg viewBox="0 0 20 20" fill="white" className="w-5 h-5">
                  <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
                </svg>
              }
              title="Connect Source"
              desc="Link databases, cloud storage or APIs"
            />
            <QuickAction
              to="/chat"
              gradient="linear-gradient(135deg, #10b981, #38bdf8)"
              glowColor="#10b981"
              delay={360}
              icon={
                <svg viewBox="0 0 20 20" fill="white" className="w-5 h-5">
                  <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                </svg>
              }
              title="AI Chat"
              desc="Query your data in plain English"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
