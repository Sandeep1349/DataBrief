import { api, BASE } from "./client";
import type { Dataset, ProgressUpdate, CleanRule } from "../types";

export const listDatasets = () => api.get<Dataset[]>("/datasets");

export const getDataset = (id: string) => api.get<Dataset>(`/datasets/${id}`);

export const deleteDataset = (id: string) =>
  api.delete<void>(`/datasets/${id}`);

export const uploadFromUrl = (id: string, url: string) =>
  api.post<{ dataset_id: string; status: string }>(`/datasets/${id}/upload-url`, { url });

export const cleanDataset = (id: string) =>
  api.post<{ dataset_id: string; status: string }>(`/datasets/${id}/clean`, {});

export const revertDataset = (id: string) =>
  api.post<{ dataset_id: string; status: string }>(`/datasets/${id}/revert`, {});

export const manualCleanDataset = (id: string, rules: CleanRule[]) =>
  api.post<{ dataset_id: string; status: string }>(`/datasets/${id}/manual-clean`, { rules });

export async function createAndUploadUrl(
  url: string,
  name: string,
  fileType: string,
  onProgress: (p: ProgressUpdate) => void,
): Promise<string> {
  const filename = url.split("?")[0].split("/").pop() || "download";
  const { dataset_id } = await api.post<{ dataset_id: string }>("/datasets", {
    name,
    original_filename: filename,
    file_type: fileType,
  });

  await api.post(`/datasets/${dataset_id}/upload-url`, { url });

  await new Promise<void>((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const p = await api.get<ProgressUpdate>(`/datasets/${dataset_id}/progress`);
        onProgress(p);
        if (p.stage === "done") { clearInterval(interval); resolve(); }
        else if (p.stage === "failed") { clearInterval(interval); reject(new Error(p.message)); }
      } catch (e) { clearInterval(interval); reject(e); }
    }, 1500);
  });

  return dataset_id;
}

export async function createAndUpload(
  file: File,
  name: string,
  onProgress: (p: ProgressUpdate) => void
): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "csv";
  const fileType = ext === "xlsx" || ext === "xls" ? "excel" : ext;

  const { dataset_id } = await api.post<{ dataset_id: string }>("/datasets", {
    name,
    original_filename: file.name,
    file_type: fileType,
  });

  const form = new FormData();
  form.append("file", file);
  await api.upload(`/datasets/${dataset_id}/upload`, form);

  // Poll progress
  await new Promise<void>((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const p = await api.get<ProgressUpdate>(
          `/datasets/${dataset_id}/progress`
        );
        onProgress(p);
        if (p.stage === "done") {
          clearInterval(interval);
          resolve();
        } else if (p.stage === "failed") {
          clearInterval(interval);
          reject(new Error(p.message));
        }
      } catch (e) {
        clearInterval(interval);
        reject(e);
      }
    }, 1000);
  });

  return dataset_id;
}

export type DbParams = {
  db_type: string;
  host: string;
  port: number | null;
  database: string;
  username: string;
  password: string;
};

export const testDbConnection = (params: DbParams) =>
  api.post<{ ok: boolean; message: string }>("/databases/test", params);

export const listDbTables = (params: DbParams) =>
  api.post<{ tables: string[] }>("/databases/tables", params);

export const importDbTable = (params: DbParams & { src_table: string; dataset_name: string }) =>
  api.post<{ dataset_id: string; status: string }>("/databases/import", params);

export function streamProgress(
  datasetId: string,
  onUpdate: (p: ProgressUpdate) => void,
  onDone: () => void,
  onError: (e: Error) => void
): () => void {
  let stopped = false;
  const token = localStorage.getItem("token");

  const poll = async () => {
    while (!stopped) {
      try {
        const res = await fetch(`${BASE}/datasets/${datasetId}/progress`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) break;
        const p: ProgressUpdate = await res.json();
        onUpdate(p);
        if (p.stage === "done") { onDone(); break; }
        if (p.stage === "failed") { onError(new Error(p.message)); break; }
        await new Promise((r) => setTimeout(r, 1000));
      } catch (e) {
        onError(e as Error);
        break;
      }
    }
  };

  poll();
  return () => { stopped = true; };
}
