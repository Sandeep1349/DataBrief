import { api } from "./client";
import type {
  Kpi,
  TimeSeriesPoint,
  BreakdownRow,
  HistogramBin,
  DataRow,
} from "../types";

const base = (id: string) => `/datasets/${id}/analytics`;

export const getKpis = (id: string) =>
  api.get<Kpi[]>(`${base(id)}/kpis`);

export const getSummary = (id: string) =>
  api.get<{ dataset_id: string; total_rows: number; column_schema: unknown[]; stats: Record<string, unknown> }>(
    `${base(id)}/summary`
  );

export const getTimeSeries = (
  id: string,
  dtCol: string,
  metric: string,
  interval: string
) =>
  api.get<TimeSeriesPoint[]>(
    `${base(id)}/timeseries?dt_col=${encodeURIComponent(dtCol)}&metric=${encodeURIComponent(metric)}&interval=${interval}`
  );

export const getBreakdown = (
  id: string,
  col: string,
  metric = "count",
  limit = 10
) =>
  api.get<BreakdownRow[]>(
    `${base(id)}/breakdown?col=${encodeURIComponent(col)}&metric=${encodeURIComponent(metric)}&limit=${limit}`
  );

export const getHistogram = (id: string, col: string, bins = 20) =>
  api.get<HistogramBin[]>(
    `${base(id)}/histogram?col=${encodeURIComponent(col)}&bins=${bins}`
  );

export const getRows = (
  id: string,
  page = 1,
  limit = 50,
  filterCol?: string,
  filterOp?: string,
  filterVal?: string
) => {
  let url = `${base(id)}/rows?page=${page}&limit=${limit}`;
  if (filterCol) url += `&filter_col=${encodeURIComponent(filterCol)}`;
  if (filterOp) url += `&filter_op=${encodeURIComponent(filterOp)}`;
  if (filterVal !== undefined) url += `&filter_val=${encodeURIComponent(filterVal)}`;
  return api.get<DataRow[]>(url);
};

export const getInsights = (id: string) =>
  api.get<{ dataset_id: string; name: string; narrative: string }>(
    `/chat/datasets/${id}/insights`
  );

export async function downloadReport(id: string): Promise<void> {
  const token = localStorage.getItem("token");
  const BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
  const res = await fetch(`${BASE}/datasets/${id}/analytics/report`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Report failed: HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  a.download = match ? match[1] : `databrief-report-${id}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
