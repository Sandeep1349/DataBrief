import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  listDatasets,
  deleteDataset,
  createAndUploadUrl,
  getDataset,
} from "../api/datasets";
import type { Dataset } from "../types";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { dot: string; label: string; cls: string }> = {
  ready:      { dot: "#10b981", label: "Online",     cls: "status-ready" },
  processing: { dot: "#f59e0b", label: "Processing", cls: "status-processing" },
  cleaning:   { dot: "#8b5cf6", label: "Cleaning",   cls: "status-cleaning" },
  failed:     { dot: "#f43f5e", label: "Failed",     cls: "status-failed" },
  queued:     { dot: "#64748b", label: "Queued",     cls: "status-queued" },
  deleted:    { dot: "#334155", label: "Deleted",    cls: "status-queued" },
};

const LEFT_GLOW: Record<string, string> = {
  processing: "rgba(245,158,11,0.4)",
  cleaning:   "rgba(139,92,246,0.4)",
  failed:     "rgba(244,63,94,0.4)",
  queued:     "rgba(100,116,139,0.3)",
};

function getLeftColor(ds: Dataset): string {
  if (ds.status !== "ready") return LEFT_GLOW[ds.status] ?? "rgba(99,102,241,0.4)";
  try {
    const log: string[] = JSON.parse(ds.cleaning_log || "[]");
    if (log.includes("__ai_cleaned__"))     return "rgba(168,85,247,0.45)";
    if (log.includes("__manual_cleaned__")) return "rgba(99,102,241,0.45)";
  } catch { /* ignore */ }
  return "rgba(16,185,129,0.4)";
}

function getLeftSolid(ds: Dataset): string {
  if (ds.status !== "ready") {
    return ({ processing: "#f59e0b", cleaning: "#8b5cf6", failed: "#f43f5e", queued: "#64748b" })[ds.status] ?? "#818cf8";
  }
  try {
    const log: string[] = JSON.parse(ds.cleaning_log || "[]");
    if (log.includes("__ai_cleaned__"))     return "#8b5cf6";
    if (log.includes("__manual_cleaned__")) return "#818cf8";
  } catch { /* ignore */ }
  return "#10b981";
}

function isCleaned(ds: Dataset): boolean {
  try {
    const log: string[] = JSON.parse(ds.cleaning_log || "[]");
    return log.includes("__ai_cleaned__") || log.includes("__manual_cleaned__");
  } catch {
    return false;
  }
}

// ─── Close button ─────────────────────────────────────────────────────────────

function CloseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-8 h-8 flex items-center justify-center rounded-lg transition-all text-slate-500 hover:text-rose-400 hover:bg-rose-500/5"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
      </svg>
    </button>
  );
}

// ─── URL Import Modal ─────────────────────────────────────────────────────────

interface UrlImportModalProps {
  onClose: () => void;
  onComplete: (ds: Dataset) => void;
}

function detectFileType(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  return ({ csv: "csv", json: "json", parquet: "parquet", xlsx: "excel", xls: "excel", tsv: "tsv" })[ext] ?? "csv";
}

function UrlImportModal({ onClose, onComplete }: UrlImportModalProps) {
  const [url, setUrl]           = useState("");
  const [name, setName]         = useState("");
  const [loading, setLoading]   = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError]       = useState("");

  async function handleImport() {
    if (!url.trim()) { setError("Enter a URL."); return; }
    const dsName   = name.trim() || url.split("?")[0].split("/").pop() || "imported";
    const fileType = detectFileType(url);
    setLoading(true);
    setError("");
    try {
      const dataset_id = await createAndUploadUrl(url, dsName, fileType, (p) => {
        setProgress(`${p.message} (${Math.round(p.percent)}%)`);
      });
      const ds = await getDataset(dataset_id);
      onComplete(ds);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Import failed");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}>
      <div
        className="w-full max-w-md rounded-2xl animate-slide-up"
        style={{
          background: "var(--c-surface-modal)",
          border: "1px solid rgba(99,102,241,0.22)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.7), 0 0 40px rgba(99,102,241,0.09)",
        }}
      >
        <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div>
            <h2 className="font-bold text-slate-200 text-lg">Import from URL</h2>
            <p className="text-xs text-slate-500 mt-0.5">CSV · Excel · Parquet · JSON · TSV</p>
          </div>
          <CloseBtn onClick={onClose} />
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 block">Dataset URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleImport()}
              placeholder="https://example.com/data.csv"
              disabled={loading}
              className="input-neon disabled:opacity-40 font-mono placeholder:font-sans"
            />
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 block">
              Name <span className="text-slate-700 normal-case font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My dataset"
              disabled={loading}
              className="input-neon disabled:opacity-40"
            />
          </div>

          {loading && (
            <div
              className="rounded-xl px-4 py-3"
              style={{ background: "rgba(99,102,241,0.09)", border: "1px solid rgba(99,102,241,0.22)" }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-3 h-3 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin" />
                <span className="text-sm font-medium text-violet-400">Downloading…</span>
              </div>
              <p className="text-xs text-violet-500/70">{progress}</p>
            </div>
          )}
          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>

        <div className="px-6 py-4 flex justify-end gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-slate-500 hover:text-slate-300 hover:bg-white/5 rounded-xl transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={loading || !url.trim()}
            className="px-5 py-2 text-white text-sm font-bold rounded-xl transition-all disabled:opacity-40 flex items-center gap-2 btn-neon"
          >
            {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {loading ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Clean Choice Modal ───────────────────────────────────────────────────────

interface CleanChoiceModalProps {
  ds: Dataset;
  onClean: () => void;
  onSkip: () => void;
}

function CleanChoiceModal({ ds, onClean, onSkip }: CleanChoiceModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}>
      <div
        className="w-full max-w-sm rounded-2xl animate-slide-up"
        style={{
          background: "var(--c-surface-modal)",
          border: "1px solid rgba(16,185,129,0.15)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.7), 0 0 40px rgba(16,185,129,0.06)",
        }}
      >
        <div className="px-6 pt-7 pb-4 text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-float"
            style={{
              background: "rgba(16,185,129,0.1)",
              border: "1px solid rgba(16,185,129,0.2)",
              boxShadow: "0 0 20px rgba(16,185,129,0.1)",
            }}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6 text-emerald-400">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
          <h2 className="font-bold text-slate-200 text-xl">Dataset imported!</h2>
          <p className="text-sm text-slate-500 mt-1">
            <span className="font-semibold text-slate-300">{ds.name}</span>
            {" · "}{ds.row_count?.toLocaleString()} rows
          </p>
          <p className="text-sm text-slate-600 mt-4">Clean this data before analysis?</p>
        </div>
        <div className="px-6 pb-7 grid grid-cols-2 gap-3">
          <button
            onClick={onClean}
            className="flex flex-col items-center gap-2.5 p-4 rounded-xl transition-all group"
            style={{
              background: "rgba(99,102,241,0.08)",
              border: "1px solid rgba(99,102,241,0.22)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(99,102,241,0.14)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.35)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 0 20px rgba(99,102,241,0.12)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(99,102,241,0.08)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.22)";
              (e.currentTarget as HTMLElement).style.boxShadow = "none";
            }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(99,102,241,0.14)" }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-violet-400">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-slate-300">Data Cleaning</p>
              <p className="text-xs text-slate-600 mt-0.5">Manual or AI-assisted</p>
            </div>
          </button>
          <button
            onClick={onSkip}
            className="flex flex-col items-center gap-2.5 p-4 rounded-xl transition-all"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.12)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)";
            }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)" }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-slate-400">
                <path fillRule="evenodd" d="M10.293 15.707a1 1 0 010-1.414L14.586 10l-4.293-4.293a1 1 0 111.414-1.414l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0z" clipRule="evenodd" />
                <path fillRule="evenodd" d="M4.293 15.707a1 1 0 010-1.414L8.586 10 4.293 5.707a1 1 0 011.414-1.414l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-slate-400">Skip</p>
              <p className="text-xs text-slate-600 mt-0.5">Use data as-is</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DatasetList ──────────────────────────────────────────────────────────────

export default function DatasetList() {
  const nav = useNavigate();
  const [datasets, setDatasets]               = useState<Dataset[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [search, setSearch]                   = useState("");
  const [actionLoading, setActionLoading]     = useState<string | null>(null);
  const [urlImportOpen, setUrlImportOpen]     = useState(false);
  const [pendingCleanDs, setPendingCleanDs]   = useState<Dataset | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const hasTransient = datasets.some((d) => ["cleaning", "processing", "queued"].includes(d.status));
    if (hasTransient && !pollRef.current) {
      pollRef.current = setInterval(load, 2000);
    } else if (!hasTransient && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [datasets]);

  async function load() {
    try {
      const data = await listDatasets();
      setDatasets(data.filter((d) => d.status !== "deleted"));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this database? This cannot be undone.")) return;
    await deleteDataset(id);
    load();
  }

  const readyCount = datasets.filter((d) => d.status === "ready").length;
  const filtered   = datasets.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.file_type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <div className="relative min-h-screen p-8 page-bg">
        {/* Subtle bg grid */}
        <div className="fixed inset-0 bg-grid opacity-40 pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto">
          {/* Header */}
          <div className="mb-8 animate-slide-up">
            <div className="flex items-center gap-3 mb-1">
              <div
                className="w-2 h-8 rounded-full"
                style={{ background: "linear-gradient(180deg, #c084fc, #38bdf8)", boxShadow: "0 0 12px rgba(139,92,246,0.6)" }}
              />
              <h1 className="text-3xl font-black text-white tracking-tight">
                Data <span className="text-gradient">Vault</span>
              </h1>
            </div>
            <p className="text-slate-500 text-sm ml-5">
              {datasets.length === 0
                ? "No datasets loaded — upload data to initialise"
                : `${datasets.length} dataset${datasets.length !== 1 ? "s" : ""} · ${readyCount} online`}
            </p>
          </div>

          {/* Search */}
          <div className="relative mb-6 animate-slide-up" style={{ animationDelay: "50ms" }}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-600">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search datasets by name or format…"
              className="input-neon pl-11 pr-10"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-300 transition-colors"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>

          {/* List */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-20 rounded-2xl animate-shimmer"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 animate-slide-up">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-float"
                style={{
                  background: "rgba(139,92,246,0.06)",
                  border: "1px solid rgba(139,92,246,0.12)",
                }}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8" style={{ color: "rgba(139,92,246,0.4)" }}>
                  <path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z" />
                  <path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z" />
                  <path d="M17 5c0 1.657-3.134 3-7 3S3 6.657 3 5s3.134-3 7-3 7 1.343 7 3z" />
                </svg>
              </div>
              <p className="font-bold text-slate-400">{search ? "No results found" : "Vault is empty"}</p>
              <p className="text-sm text-slate-600 mt-1">
                {search ? `Nothing matches "${search}"` : "Upload data or import from URL to initialise"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((ds, idx) => {
                const cfg     = STATUS_CONFIG[ds.status] ?? STATUS_CONFIG.queued;
                const lc      = getLeftSolid(ds);
                const lglow   = getLeftColor(ds);
                const cleaned = isCleaned(ds);
                const isReady = ds.status === "ready";

                return (
                  <div
                    key={ds.dataset_id}
                    className="group rounded-2xl overflow-hidden transition-all duration-300 animate-slide-up"
                    style={{
                      animationDelay: `${idx * 40}ms`,
                      background: "var(--c-surface)",
                      border: "1px solid var(--c-border)",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "var(--c-surface-hover)";
                      (e.currentTarget as HTMLElement).style.borderColor = `${lglow.replace("0.4", "0.25")}`;
                      (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 30px rgba(0,0,0,0.15), 0 0 20px ${lglow.replace("0.4","0.06")}`;
                      (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "var(--c-surface)";
                      (e.currentTarget as HTMLElement).style.borderColor = "var(--c-border)";
                      (e.currentTarget as HTMLElement).style.boxShadow = "none";
                      (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                    }}
                  >
                    <div className="flex items-stretch">
                      {/* Left accent bar */}
                      <div
                        className="w-1 shrink-0 rounded-l-2xl"
                        style={{ background: lc, boxShadow: `0 0 12px ${lglow}` }}
                      />

                      {/* Main row */}
                      <div className="flex-1 px-5 py-4 flex items-center gap-4">
                        {/* Icon */}
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300 group-hover:scale-105"
                          style={{
                            background: `${lglow.replace("0.4", "0.08")}`,
                            border: `1px solid ${lglow.replace("0.4", "0.2")}`,
                          }}
                        >
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5" style={{ color: lc }}>
                            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                          </svg>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <p className="font-bold text-slate-200 truncate group-hover:text-white transition-colors">{ds.name}</p>
                            <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-0.5 rounded-full ${cfg.cls}`}>
                              <span
                                className="w-1.5 h-1.5 rounded-full"
                                style={{
                                  background: cfg.dot,
                                  boxShadow: `0 0 6px ${cfg.dot}`,
                                  ...(ds.status === "processing" || ds.status === "cleaning" ? { animation: "glow-pulse 1.5s ease-in-out infinite" } : {}),
                                }}
                              />
                              {cfg.label}
                            </span>
                            <span
                              className="text-[10px] font-bold rounded-full px-2 py-0.5"
                              style={{
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid rgba(255,255,255,0.08)",
                                color: "#94a3b8",
                              }}
                            >
                              {ds.file_type.toUpperCase()}
                            </span>
                            {cleaned && (
                              <span
                                className="text-[10px] font-bold rounded-full px-2 py-0.5"
                                style={{
                                  background: "rgba(139,92,246,0.1)",
                                  border: "1px solid rgba(139,92,246,0.2)",
                                  color: "#a78bfa",
                                }}
                              >
                                ✦ Cleaned
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600">
                            {ds.row_count != null ? ds.row_count.toLocaleString() : "—"} rows
                          </p>
                        </div>

                        {/* Right actions */}
                        <div className="flex items-center gap-3 shrink-0">
                          {ds.status === "cleaning" && (
                            <span className="text-xs font-bold" style={{ color: "#8b5cf6" }}>Cleaning…</span>
                          )}
                          {isReady && (
                            <Link
                              to={`/datasets/${ds.dataset_id}`}
                              className="text-sm font-bold text-white px-4 py-1.5 rounded-lg transition-all btn-neon"
                            >
                              Open →
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Hover action bar */}
                    {isReady && (
                      <div className="grid grid-rows-[0fr] group-hover:grid-rows-[1fr] transition-all duration-300">
                        <div className="overflow-hidden">
                          <div
                            className="px-5 py-3 flex items-center gap-2"
                            style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.2)" }}
                          >
                            <button
                              onClick={() => nav(`/datasets/${ds.dataset_id}/clean`)}
                              disabled={actionLoading === ds.dataset_id}
                              className="text-sm font-bold px-3 py-1.5 rounded-lg transition-all disabled:opacity-40"
                              style={{
                                background: "rgba(99,102,241,0.12)",
                                border: "1px solid rgba(99,102,241,0.22)",
                                color: "#22d3ee",
                              }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLElement).style.background = "rgba(99,102,241,0.22)";
                                (e.currentTarget as HTMLElement).style.boxShadow = "0 0 15px rgba(99,102,241,0.14)";
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLElement).style.background = "rgba(99,102,241,0.12)";
                                (e.currentTarget as HTMLElement).style.boxShadow = "none";
                              }}
                            >
                              Data Cleaning
                            </button>
                            <div className="flex-1" />
                            <button
                              onClick={() => handleDelete(ds.dataset_id)}
                              disabled={actionLoading === ds.dataset_id}
                              className="text-sm font-bold px-3 py-1.5 rounded-lg transition-all disabled:opacity-40"
                              style={{
                                background: "rgba(244,63,94,0.06)",
                                border: "1px solid rgba(244,63,94,0.15)",
                                color: "#f43f5e",
                              }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLElement).style.background = "rgba(244,63,94,0.12)";
                                (e.currentTarget as HTMLElement).style.boxShadow = "0 0 15px rgba(244,63,94,0.1)";
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLElement).style.background = "rgba(244,63,94,0.06)";
                                (e.currentTarget as HTMLElement).style.boxShadow = "none";
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {urlImportOpen && (
        <UrlImportModal
          onClose={() => setUrlImportOpen(false)}
          onComplete={(ds) => { setUrlImportOpen(false); setPendingCleanDs(ds); load(); }}
        />
      )}

      {pendingCleanDs && (
        <CleanChoiceModal
          ds={pendingCleanDs}
          onClean={() => { const ds = pendingCleanDs; setPendingCleanDs(null); nav(`/datasets/${ds.dataset_id}/clean`); }}
          onSkip={() => setPendingCleanDs(null)}
        />
      )}
    </>
  );
}
