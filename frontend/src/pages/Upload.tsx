import { useState, useRef, DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { streamProgress, uploadFromUrl } from "../api/datasets";
import type { ProgressUpdate } from "../types";

const FORMAT_BADGES = ["CSV", "Excel", "Parquet", "JSON", "TSV"];

function getFileType(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "csv";
  if (ext === "xlsx" || ext === "xls") return "excel";
  return ext;
}

export default function Upload() {
  const nav = useNavigate();

  const [mode, setMode] = useState<"file" | "url">("file");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [error, setError] = useState("");
  const stopPollRef = useRef<(() => void) | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [urlInput, setUrlInput] = useState("");
  const [urlName, setUrlName] = useState("");

  function handleFileSelect(file: File) {
    setSelectedFile(file);
    if (!uploadName) setUploadName(file.name.replace(/\.[^.]+$/, ""));
    setError("");
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }

  function startPolling(dataset_id: string) {
    stopPollRef.current = streamProgress(
      dataset_id,
      (p) => setProgress(p),
      () => { setUploading(false); setProgress(null); nav("/databases"); },
      (e) => { setUploading(false); setError(e.message); }
    );
  }

  async function handleUpload() {
    if (!selectedFile || !uploadName.trim()) return;
    setUploading(true);
    setProgress(null);
    setError("");

    try {
      const { dataset_id } = await api.post<{ dataset_id: string }>("/datasets", {
        name: uploadName.trim(),
        original_filename: selectedFile.name,
        file_type: getFileType(selectedFile),
      });

      const form = new FormData();
      form.append("file", selectedFile);
      await api.upload(`/datasets/${dataset_id}/upload`, form);

      setSelectedFile(null);
      setUploadName("");
      if (fileInputRef.current) fileInputRef.current.value = "";

      startPolling(dataset_id);
    } catch (e) {
      setUploading(false);
      setError((e as Error).message);
    }
  }

  async function handleUrlImport() {
    const url = urlInput.trim();
    const name = urlName.trim();
    if (!url || !name) return;
    setUploading(true);
    setProgress(null);
    setError("");

    try {
      const filename = url.split("?")[0].split("/").pop() || "data";
      const { dataset_id } = await api.post<{ dataset_id: string }>("/datasets", {
        name,
        original_filename: filename,
        file_type: "csv",
      });

      await uploadFromUrl(dataset_id, url);
      setUrlInput("");
      setUrlName("");
      startPolling(dataset_id);
    } catch (e) {
      setUploading(false);
      setError((e as Error).message);
    }
  }

  return (
    <div className="relative min-h-screen p-8 page-bg">
      <div className="fixed inset-0 bg-grid opacity-40 pointer-events-none" />

      <div className="relative z-10 max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8 animate-slide-up">
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-2 h-8 rounded-full"
              style={{ background: "linear-gradient(180deg, #38bdf8, #6366f1)", boxShadow: "0 0 14px rgba(99,102,241,0.65)" }}
            />
            <h1 className="text-3xl font-black text-white tracking-tight">
              Data <span className="text-gradient">Upload</span>
            </h1>
          </div>
          <p className="text-slate-500 text-sm ml-5">Import a file or fetch data from a remote URL</p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl overflow-hidden animate-slide-up"
          style={{
            background: "var(--c-surface)",
            border: "1px solid rgba(255,255,255,0.07)",
            animationDelay: "80ms",
          }}
        >
          {/* Tab header */}
          <div
            className="px-6 py-4 flex items-center gap-6"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
          >
            <button
              onClick={() => { setMode("file"); setError(""); }}
              className={`flex items-center gap-2 text-sm font-bold pb-0.5 border-b-2 transition-all ${
                mode === "file"
                  ? "border-cyan-400 text-cyan-400"
                  : "border-transparent text-slate-600 hover:text-slate-300"
              }`}
              style={mode === "file" ? { textShadow: "0 0 10px rgba(56,189,248,0.6)" } : {}}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              Upload File
            </button>
            <button
              onClick={() => { setMode("url"); setError(""); }}
              className={`flex items-center gap-2 text-sm font-bold pb-0.5 border-b-2 transition-all ${
                mode === "url"
                  ? "border-violet-400 text-violet-400"
                  : "border-transparent text-slate-600 hover:text-slate-300"
              }`}
              style={mode === "url" ? { textShadow: "0 0 10px rgba(139,92,246,0.5)" } : {}}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
              </svg>
              From URL
            </button>
            {mode === "file" && (
              <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                {FORMAT_BADGES.map((f) => (
                  <span
                    key={f}
                    className="text-[10px] font-bold rounded-md px-1.5 py-0.5"
                    style={{
                      background: "rgba(99,102,241,0.1)",
                      border: "1px solid rgba(99,102,241,0.2)",
                      color: "rgba(129,140,248,0.8)",
                    }}
                  >
                    {f}
                  </span>
                ))}
                <span className="text-xs text-slate-600 ml-1">· up to 3 GB</span>
              </div>
            )}
          </div>

          <div className="p-6">
            {/* File mode */}
            {mode === "file" && (
              <>
                <div
                  className={`relative rounded-2xl p-10 text-center cursor-pointer transition-all duration-300 scan-container ${
                    dragOver ? "scale-[1.01]" : ""
                  }`}
                  style={{
                    border: dragOver
                      ? "2px dashed rgba(99,102,241,0.65)"
                      : selectedFile
                      ? "2px dashed rgba(168,85,247,0.45)"
                      : "2px dashed rgba(139,92,246,0.18)",
                    background: dragOver
                      ? "rgba(99,102,241,0.07)"
                      : selectedFile
                      ? "rgba(168,85,247,0.05)"
                      : "var(--c-surface)",
                    boxShadow: dragOver ? "0 0 30px rgba(99,102,241,0.14), inset 0 0 30px rgba(99,102,241,0.05)" : "none",
                  }}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => !selectedFile && fileInputRef.current?.click()}
                >
                  {selectedFile ? (
                    <div className="flex items-center justify-center gap-4">
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center animate-float"
                        style={{
                          background: "rgba(139,92,246,0.1)",
                          border: "1px solid rgba(139,92,246,0.2)",
                          boxShadow: "0 0 20px rgba(139,92,246,0.1)",
                        }}
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6 text-violet-400">
                          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-bold text-slate-200">{selectedFile.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedFile(null); setUploadName(""); }}
                        className="ml-2 w-7 h-7 rounded-full flex items-center justify-center text-slate-500 hover:text-rose-400 transition-all"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div
                        className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 animate-float"
                        style={{
                          background: "rgba(99,102,241,0.1)",
                          border: "1px solid rgba(99,102,241,0.22)",
                        }}
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8" style={{ color: "rgba(129,140,248,0.75)" }}>
                          <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <p className="text-sm font-semibold text-slate-400">
                        Drop your file here, or{" "}
                        <span
                          className="text-violet-400 cursor-pointer hover:text-violet-300 transition-colors"
                          style={{ textShadow: "0 0 10px rgba(192,132,252,0.5)" }}
                          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                        >
                          browse
                        </span>
                      </p>
                      <p className="text-xs text-slate-600 mt-2">CSV · Excel · Parquet · JSON · TSV</p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".csv,.xlsx,.xls,.parquet,.json,.tsv,.tab"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
                  />
                </div>

                {selectedFile && (
                  <div className="mt-4 flex gap-3">
                    <input
                      type="text"
                      value={uploadName}
                      onChange={(e) => setUploadName(e.target.value)}
                      placeholder="Dataset name"
                      className="input-neon flex-1"
                    />
                    <button
                      onClick={handleUpload}
                      disabled={uploading || !uploadName.trim()}
                      className="text-white px-6 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 transition-all btn-neon whitespace-nowrap"
                    >
                      {uploading ? "Uploading…" : "Upload"}
                    </button>
                  </div>
                )}
              </>
            )}

            {/* URL mode */}
            {mode === "url" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                    Data URL
                  </label>
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => { setUrlInput(e.target.value); setError(""); }}
                    placeholder="https://example.com/data.csv"
                    className="input-neon font-mono placeholder:font-sans"
                  />
                  <p className="text-[11px] text-slate-600 mt-1.5">
                    Supports direct links to CSV, Excel, Parquet, JSON, or TSV files
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                    Dataset name
                  </label>
                  <input
                    type="text"
                    value={urlName}
                    onChange={(e) => setUrlName(e.target.value)}
                    placeholder="My dataset"
                    className="input-neon"
                  />
                </div>
                <button
                  onClick={handleUrlImport}
                  disabled={uploading || !urlInput.trim() || !urlName.trim()}
                  className="w-full text-white py-3 rounded-xl text-sm font-bold disabled:opacity-40 transition-all btn-neon"
                >
                  {uploading ? "Fetching…" : "Import from URL"}
                </button>
              </div>
            )}

            {/* Progress */}
            {progress && (
              <div
                className="mt-4 rounded-2xl p-4"
                style={{
                  background: "rgba(99,102,241,0.07)",
                  border: "1px solid rgba(99,102,241,0.18)",
                }}
              >
                <div className="flex justify-between text-xs mb-2">
                  <span className="font-bold text-slate-400 capitalize">{progress.stage}</span>
                  <span className="font-black text-violet-400" style={{ textShadow: "0 0 10px rgba(192,132,252,0.6)" }}>
                    {progress.percent.toFixed(0)}%
                  </span>
                </div>
                <div
                  className="w-full rounded-full h-1.5 overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                >
                  <div
                    className="h-1.5 rounded-full transition-all duration-300 progress-bar-glow"
                    style={{
                      width: `${progress.percent}%`,
                      background: "linear-gradient(90deg, #6366f1, #a855f7, #ec4899)",
                    }}
                  />
                </div>
                <p className="text-xs text-slate-600 mt-2">{progress.message}</p>
              </div>
            )}

            {error && (
              <div
                className="mt-4 rounded-2xl px-4 py-3"
                style={{
                  background: "rgba(244,63,94,0.06)",
                  border: "1px solid rgba(244,63,94,0.15)",
                }}
              >
                <p className="text-rose-400 text-sm">{error}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
