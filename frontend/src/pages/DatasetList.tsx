import { useState, useEffect, useRef, DragEvent } from "react";
import { Link } from "react-router-dom";
import { listDatasets, deleteDataset, streamProgress } from "../api/datasets";
import { api } from "../api/client";
import type { Dataset, ProgressUpdate } from "../types";

const STATUS_COLORS: Record<string, string> = {
  ready: "bg-green-100 text-green-700",
  processing: "bg-yellow-100 text-yellow-700",
  failed: "bg-red-100 text-red-700",
  pending: "bg-gray-100 text-gray-600",
  deleted: "bg-gray-100 text-gray-400",
};

export default function DatasetList() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stopPollRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    load();
    return () => stopPollRef.current?.();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await listDatasets();
      setDatasets(data.filter((d) => d.status !== "deleted"));
    } finally {
      setLoading(false);
    }
  }

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

  async function handleUpload() {
    if (!selectedFile || !uploadName.trim()) return;
    setUploading(true);
    setProgress(null);
    setError("");

    try {
      const ext = selectedFile.name.split(".").pop()?.toLowerCase() ?? "csv";
      const fileType = ext === "xlsx" || ext === "xls" ? "excel" : ext;

      const { dataset_id } = await api.post<{ dataset_id: string }>("/datasets", {
        name: uploadName.trim(),
        original_filename: selectedFile.name,
        file_type: fileType,
      });

      const form = new FormData();
      form.append("file", selectedFile);
      await api.upload(`/datasets/${dataset_id}/upload`, form);

      setSelectedFile(null);
      setUploadName("");
      if (fileInputRef.current) fileInputRef.current.value = "";

      stopPollRef.current = streamProgress(
        dataset_id,
        (p) => setProgress(p),
        () => {
          setUploading(false);
          setProgress(null);
          load();
        },
        (e) => {
          setUploading(false);
          setError(e.message);
        }
      );
    } catch (e) {
      setUploading(false);
      setError((e as Error).message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this dataset?")) return;
    await deleteDataset(id);
    load();
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Datasets</h1>

      {/* Upload card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Upload a dataset</h2>

        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition ${
            dragOver ? "border-brand-500 bg-brand-50" : "border-gray-300 hover:border-brand-400"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <p className="text-gray-500 text-sm">
            {selectedFile
              ? `📄 ${selectedFile.name} (${(selectedFile.size / 1024 / 1024).toFixed(1)} MB)`
              : "Drag & drop CSV, Excel, or Parquet — or click to browse"}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".csv,.xlsx,.xls,.parquet"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelect(f);
            }}
          />
        </div>

        {selectedFile && (
          <div className="mt-3 flex gap-3">
            <input
              type="text"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              placeholder="Dataset name"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              onClick={handleUpload}
              disabled={uploading || !uploadName.trim()}
              className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        )}

        {progress && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{progress.stage}</span>
              <span>{progress.percent.toFixed(0)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <div
                className="bg-brand-500 h-1.5 rounded-full transition-all"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">{progress.message}</p>
          </div>
        )}

        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      </div>

      {/* Dataset list */}
      {loading ? (
        <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
      ) : datasets.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">No datasets yet. Upload one above.</p>
      ) : (
        <div className="space-y-3">
          {datasets.map((ds) => (
            <div
              key={ds.dataset_id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[ds.status] ?? "bg-gray-100"}`}
                  >
                    {ds.status}
                  </span>
                  <span className="text-xs text-gray-400">{ds.file_type.toUpperCase()}</span>
                </div>
                <p className="font-medium text-gray-900 truncate">{ds.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {ds.row_count?.toLocaleString() ?? "—"} rows · {ds.column_count ?? "—"} columns
                  {ds.quality_score ? ` · quality ${ds.quality_score}/100` : ""}
                </p>
              </div>

              <div className="flex gap-2 shrink-0">
                {ds.status === "ready" && (
                  <Link
                    to={`/datasets/${ds.dataset_id}`}
                    className="text-sm text-brand-600 hover:text-brand-700 font-medium"
                  >
                    View →
                  </Link>
                )}
                <button
                  onClick={() => handleDelete(ds.dataset_id)}
                  className="text-sm text-red-400 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
