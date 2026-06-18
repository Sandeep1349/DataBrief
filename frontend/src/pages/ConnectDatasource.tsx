import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { streamProgress, testDbConnection, listDbTables, importDbTable } from "../api/datasets";
import type { ProgressUpdate } from "../types";
import type { DbParams } from "../api/datasets";

// ─── Source definitions ───────────────────────────────────────────────────────

type SourceId = "database" | "cloud" | "url" | "sheets" | "kafka";

type Source = {
  id: SourceId;
  label: string;
  desc: string;
  available: boolean;
  gradient: string;
  icon: React.ReactNode;
  badges: string[];
};

const SOURCES: Source[] = [
  {
    id: "database",
    label: "Database",
    desc: "Connect directly to a relational database and import a table as a dataset.",
    available: true,
    gradient: "from-violet-400 to-purple-600",
    badges: ["PostgreSQL", "MySQL", "SQLite"],
    icon: (
      <svg viewBox="0 0 20 20" fill="white" className="w-5 h-5">
        <path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z" />
        <path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z" />
        <path d="M17 5c0 1.657-3.134 3-7 3S3 6.657 3 5s3.134-3 7-3 7 1.343 7 3z" />
      </svg>
    ),
  },
  {
    id: "url",
    label: "URL / REST API",
    desc: "Fetch data from any public URL or REST API endpoint that returns JSON, CSV, or Parquet.",
    available: true,
    gradient: "from-emerald-400 to-teal-500",
    badges: ["CSV URL", "JSON URL", "Parquet", "REST API"],
    icon: (
      <svg viewBox="0 0 20 20" fill="white" className="w-5 h-5">
        <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    id: "sheets",
    label: "Google Sheets",
    desc: "Paste the link to a public Google Sheet and import it as a dataset instantly.",
    available: true,
    gradient: "from-green-400 to-emerald-600",
    badges: ["Public Sheets", "Auto CSV export"],
    icon: (
      <svg viewBox="0 0 20 20" fill="white" className="w-5 h-5">
        <path fillRule="evenodd" d="M5 4a3 3 0 00-3 3v6a3 3 0 003 3h10a3 3 0 003-3V7a3 3 0 00-3-3H5zm-1 9v-1h5v2H5a1 1 0 01-1-1zm7 1h4a1 1 0 001-1v-1h-5v2zm0-4h5V8h-5v2zM9 8H4v2h5V8z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    id: "cloud",
    label: "Cloud Storage",
    desc: "Pull data files directly from your cloud storage bucket without downloading them first.",
    available: false,
    gradient: "from-cyan-400 to-blue-500",
    badges: ["AWS S3", "Google Cloud", "Azure Blob", "Cloudflare R2"],
    icon: (
      <svg viewBox="0 0 20 20" fill="white" className="w-5 h-5">
        <path d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.977A4.5 4.5 0 1113.5 16h-8z" />
      </svg>
    ),
  },
  {
    id: "kafka",
    label: "Streaming / Kafka",
    desc: "Connect to a Kafka topic or streaming pipeline and ingest data in real-time.",
    available: false,
    gradient: "from-orange-400 to-red-500",
    badges: ["Kafka", "Kinesis", "Pub/Sub", "Real-time"],
    icon: (
      <svg viewBox="0 0 20 20" fill="white" className="w-5 h-5">
        <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
      </svg>
    ),
  },
];

// ─── Shared helpers ───────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--c-t2)" }}>
      {children}
    </label>
  );
}

function ProgressDisplay({ progress }: { progress: ProgressUpdate }) {
  return (
    <div className="mt-4 rounded-xl p-4" style={{ background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.18)" }}>
      <div className="flex justify-between text-xs mb-2">
        <span className="font-bold capitalize" style={{ color: "var(--c-t2)" }}>{progress.stage}</span>
        <span className="font-black" style={{ color: "#c084fc" }}>{progress.percent.toFixed(0)}%</span>
      </div>
      <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div
          className="h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${progress.percent}%`, background: "linear-gradient(90deg,#6366f1,#a855f7,#ec4899)" }}
        />
      </div>
      <p className="text-xs mt-2" style={{ color: "var(--c-t2)" }}>{progress.message}</p>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="mt-3 rounded-xl px-4 py-3" style={{ background: "rgba(244,63,94,0.06)", border: "1px solid rgba(244,63,94,0.15)" }}>
      <p className="text-rose-400 text-sm">{msg}</p>
    </div>
  );
}

// ─── Modal wrapper ────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl p-6 relative"
        style={{ background: "var(--c-surface-modal)", border: "1px solid var(--c-border-modal)", boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold" style={{ color: "var(--c-t1)" }}>{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
            style={{ color: "var(--c-t2)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── URL modal ────────────────────────────────────────────────────────────────

function UrlModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [error, setError] = useState("");

  function detectFileType(u: string): string {
    const ext = u.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
    const map: Record<string, string> = { xlsx: "excel", xls: "excel", csv: "csv", json: "json", parquet: "parquet", tsv: "tsv", tab: "tsv" };
    return map[ext] ?? "csv";
  }

  async function handleImport() {
    if (!url.trim() || !name.trim()) return;
    setLoading(true);
    setError("");
    setProgress(null);
    try {
      const filename = url.split("?")[0].split("/").pop() || "data";
      const fileType = detectFileType(url);
      const { dataset_id } = await api.post<{ dataset_id: string }>("/datasets", {
        name: name.trim(),
        original_filename: filename,
        file_type: fileType,
      });
      await api.post(`/datasets/${dataset_id}/upload-url`, { url });
      streamProgress(dataset_id, setProgress, () => nav(`/datasets/${dataset_id}`), (e) => { setLoading(false); setError(e.message); });
    } catch (e) {
      setLoading(false);
      setError((e as Error).message);
    }
  }

  return (
    <Modal title="Import from URL" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <Label>Data URL</Label>
          <input
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(""); }}
            placeholder="https://example.com/data.csv"
            className="input-neon font-mono placeholder:font-sans"
          />
          <p className="text-[11px] mt-1.5" style={{ color: "var(--c-t2)" }}>Supports CSV, JSON, Parquet, Excel, TSV</p>
        </div>
        <div>
          <Label>Dataset name</Label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My dataset"
            className="input-neon"
          />
        </div>
        <button
          onClick={handleImport}
          disabled={loading || !url.trim() || !name.trim()}
          className="w-full text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 transition-all btn-neon"
        >
          {loading ? "Importing…" : "Import from URL"}
        </button>
        {progress && <ProgressDisplay progress={progress} />}
        {error && <ErrorBox msg={error} />}
      </div>
    </Modal>
  );
}

// ─── Google Sheets modal ──────────────────────────────────────────────────────

function SheetsModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [error, setError] = useState("");

  function toExportUrl(input: string): string | null {
    const idMatch = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!idMatch) return null;
    const sheetId = idMatch[1];
    const gidMatch = input.match(/gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : "0";
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  }

  async function handleImport() {
    const csvUrl = toExportUrl(sheetUrl.trim());
    if (!csvUrl) { setError("Invalid Google Sheets URL. Make sure to paste the full sharing link."); return; }
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    setProgress(null);
    try {
      const { dataset_id } = await api.post<{ dataset_id: string }>("/datasets", {
        name: name.trim(),
        original_filename: "google_sheet.csv",
        file_type: "csv",
      });
      await api.post(`/datasets/${dataset_id}/upload-url`, { url: csvUrl });
      streamProgress(dataset_id, setProgress, () => nav(`/datasets/${dataset_id}`), (e) => { setLoading(false); setError(e.message); });
    } catch (e) {
      setLoading(false);
      setError((e as Error).message);
    }
  }

  return (
    <Modal title="Import from Google Sheets" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl px-4 py-3 text-xs" style={{ background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.15)", color: "var(--c-t2)" }}>
          The sheet must be publicly accessible (File → Share → Anyone with the link can view).
        </div>
        <div>
          <Label>Google Sheets URL</Label>
          <input
            type="url"
            value={sheetUrl}
            onChange={(e) => { setSheetUrl(e.target.value); setError(""); }}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            className="input-neon font-mono placeholder:font-sans"
          />
        </div>
        <div>
          <Label>Dataset name</Label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My dataset"
            className="input-neon"
          />
        </div>
        <button
          onClick={handleImport}
          disabled={loading || !sheetUrl.trim() || !name.trim()}
          className="w-full text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 transition-all btn-neon"
        >
          {loading ? "Importing…" : "Import Sheet"}
        </button>
        {progress && <ProgressDisplay progress={progress} />}
        {error && <ErrorBox msg={error} />}
      </div>
    </Modal>
  );
}

// ─── Database modal ───────────────────────────────────────────────────────────

const DB_DEFAULTS: Record<string, number> = { postgresql: 5432, mysql: 3306, sqlite: 0 };

function DbModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();

  const [step, setStep] = useState<"credentials" | "tables">("credentials");
  const [params, setParams] = useState<DbParams>({
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    database: "",
    username: "",
    password: "",
  });
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [selectedTable, setSelectedTable] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [error, setError] = useState("");

  function set<K extends keyof DbParams>(k: K, v: DbParams[K]) {
    setParams((p) => ({ ...p, [k]: v }));
    setTestOk(false);
    setError("");
  }

  function handleDbTypeChange(t: string) {
    setParams((p) => ({ ...p, db_type: t, port: DB_DEFAULTS[t] || null }));
    setTestOk(false);
    setError("");
  }

  async function handleTest() {
    setTesting(true);
    setError("");
    setTestOk(false);
    try {
      await testDbConnection(params);
      setTestOk(true);
      // Fetch tables immediately after a successful test
      setLoadingTables(true);
      const { tables: t } = await listDbTables(params);
      setTables(t);
      setSelectedTable(t[0] ?? "");
      setStep("tables");
    } catch (e) {
      setError((e as Error).message.replace(/^.*?detail[":]+\s*/i, ""));
    } finally {
      setTesting(false);
      setLoadingTables(false);
    }
  }

  async function handleImport() {
    if (!selectedTable || !datasetName.trim()) return;
    setImporting(true);
    setError("");
    setProgress(null);
    try {
      const { dataset_id } = await importDbTable({ ...params, src_table: selectedTable, dataset_name: datasetName.trim() });
      streamProgress(dataset_id, setProgress, () => nav(`/datasets/${dataset_id}`), (e) => { setImporting(false); setError(e.message); });
    } catch (e) {
      setImporting(false);
      setError((e as Error).message.replace(/^.*?detail[":]+\s*/i, ""));
    }
  }

  const isSqlite = params.db_type === "sqlite";

  return (
    <Modal title="Connect to Database" onClose={onClose}>
      {step === "credentials" && (
        <div className="space-y-4">
          {/* DB type */}
          <div>
            <Label>Database type</Label>
            <select
              value={params.db_type}
              onChange={(e) => handleDbTypeChange(e.target.value)}
              className="input-neon"
            >
              <option value="postgresql">PostgreSQL</option>
              <option value="mysql">MySQL / MariaDB</option>
              <option value="sqlite">SQLite</option>
            </select>
          </div>

          {isSqlite ? (
            <div>
              <Label>File path</Label>
              <input
                type="text"
                value={params.database}
                onChange={(e) => set("database", e.target.value)}
                placeholder="/path/to/database.db"
                className="input-neon font-mono placeholder:font-sans"
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label>Host</Label>
                  <input type="text" value={params.host} onChange={(e) => set("host", e.target.value)} placeholder="localhost" className="input-neon" />
                </div>
                <div>
                  <Label>Port</Label>
                  <input
                    type="number"
                    value={params.port ?? ""}
                    onChange={(e) => set("port", e.target.value ? parseInt(e.target.value) : null)}
                    className="input-neon"
                  />
                </div>
              </div>
              <div>
                <Label>Database name</Label>
                <input type="text" value={params.database} onChange={(e) => set("database", e.target.value)} placeholder="my_database" className="input-neon" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Username</Label>
                  <input type="text" value={params.username} onChange={(e) => set("username", e.target.value)} placeholder="postgres" className="input-neon" />
                </div>
                <div>
                  <Label>Password</Label>
                  <input type="password" value={params.password} onChange={(e) => set("password", e.target.value)} placeholder="••••••••" className="input-neon" />
                </div>
              </div>
            </>
          )}

          <button
            onClick={handleTest}
            disabled={testing || (!isSqlite && !params.database.trim())}
            className="w-full text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 transition-all btn-neon"
          >
            {testing ? "Testing connection…" : "Test & Connect"}
          </button>
          {testOk && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#4ade80" }}>
              Connection successful!
            </div>
          )}
          {error && <ErrorBox msg={error} />}
        </div>
      )}

      {step === "tables" && (
        <div className="space-y-4">
          <button
            onClick={() => { setStep("credentials"); setError(""); setProgress(null); }}
            className="flex items-center gap-1.5 text-xs font-semibold mb-1 transition-colors"
            style={{ color: "var(--c-t2)" }}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Back to credentials
          </button>

          {loadingTables ? (
            <p className="text-sm py-4 text-center" style={{ color: "var(--c-t2)" }}>Loading tables…</p>
          ) : tables.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: "var(--c-t2)" }}>No tables found in this database.</p>
          ) : (
            <>
              <div>
                <Label>Select table to import</Label>
                <select
                  value={selectedTable}
                  onChange={(e) => setSelectedTable(e.target.value)}
                  className="input-neon"
                >
                  {tables.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <p className="text-[11px] mt-1.5" style={{ color: "var(--c-t2)" }}>{tables.length} table{tables.length !== 1 ? "s" : ""} found</p>
              </div>

              <div>
                <Label>Dataset name</Label>
                <input
                  type="text"
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                  placeholder={selectedTable || "My dataset"}
                  className="input-neon"
                />
              </div>

              <button
                onClick={handleImport}
                disabled={importing || !selectedTable || !datasetName.trim()}
                className="w-full text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 transition-all btn-neon"
              >
                {importing ? "Importing…" : `Import "${selectedTable}"`}
              </button>

              {progress && <ProgressDisplay progress={progress} />}
              {error && <ErrorBox msg={error} />}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ConnectDatasource() {
  const [activeModal, setActiveModal] = useState<SourceId | null>(null);

  function openModal(id: SourceId, available: boolean) {
    if (available) setActiveModal(id);
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--c-t1)" }}>Connect Datasource</h1>
        <p className="text-sm mt-1" style={{ color: "var(--c-t2)" }}>Choose how you want to bring your data into DataBrief</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {SOURCES.map((s) => (
          <div
            key={s.id}
            onClick={() => openModal(s.id, s.available)}
            className={`relative rounded-2xl border-2 p-6 flex flex-col gap-4 transition-all duration-200 ${
              s.available
                ? "cursor-pointer group"
                : "opacity-55 cursor-not-allowed"
            }`}
            style={{
              background: "var(--c-surface)",
              border: s.available ? "2px solid var(--c-border)" : "2px solid var(--c-border)",
            }}
            onMouseEnter={(e) => {
              if (s.available) {
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(139,92,246,0.5)";
                (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(139,92,246,0.12)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--c-border)";
              (e.currentTarget as HTMLElement).style.boxShadow = "none";
            }}
          >
            {!s.available && (
              <span
                className="absolute top-4 right-4 text-[10px] font-bold rounded-full px-2 py-0.5 tracking-wide"
                style={{ color: "var(--c-t2)", background: "rgba(255,255,255,0.05)" }}
              >
                COMING SOON
              </span>
            )}

            {s.available && (
              <span
                className="absolute top-4 right-4 text-[10px] font-bold rounded-full px-2 py-0.5 tracking-wide"
                style={{ color: "#a78bfa", background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.25)" }}
              >
                AVAILABLE
              </span>
            )}

            <div className="flex items-center gap-4">
              <div
                className={`w-11 h-11 rounded-xl bg-gradient-to-br ${s.gradient} flex items-center justify-center shadow-sm ${s.available ? "group-hover:scale-105 transition-transform" : ""}`}
              >
                {s.icon}
              </div>
              <div>
                <p className="font-semibold" style={{ color: "var(--c-t1)" }}>{s.label}</p>
                {s.available && (
                  <p className="text-xs mt-0.5" style={{ color: "#a78bfa" }}>Click to connect →</p>
                )}
              </div>
            </div>

            <p className="text-sm leading-relaxed" style={{ color: "var(--c-t2)" }}>{s.desc}</p>

            <div className="flex flex-wrap gap-1.5">
              {s.badges.map((b) => (
                <span key={b} className="text-[11px] font-medium rounded-md px-2 py-0.5" style={{ background: "rgba(255,255,255,0.05)", color: "var(--c-t2)" }}>
                  {b}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {activeModal === "url" && <UrlModal onClose={() => setActiveModal(null)} />}
      {activeModal === "sheets" && <SheetsModal onClose={() => setActiveModal(null)} />}
      {activeModal === "database" && <DbModal onClose={() => setActiveModal(null)} />}
    </div>
  );
}
