export interface Dataset {
  dataset_id: string;
  name: string;
  original_filename: string;
  file_type: string;
  status: "pending" | "processing" | "ready" | "failed" | "deleted";
  row_count: number;
  column_count: number;
  quality_score: number;
  clickhouse_table: string;
  column_schema: string;
  created_at: string;
}

export interface Kpi {
  kpi_id: string;
  dataset_id: string;
  name: string;
  value: string;
  raw_value: number;
  change_percent: number;
  trend: "up" | "down" | "flat";
  category: string;
  created_at: string;
}

export interface TimeSeriesPoint {
  period: string;
  value: number;
}

export interface BreakdownRow {
  category: string;
  value: number;
}

export interface HistogramBin {
  bin_start: number;
  bin_end: number;
  count: number;
}

export interface DataRow {
  [key: string]: string | number | boolean | null;
}

export interface Thread {
  thread_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  message_id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  referenced_dataset_ids: string;
  created_at: string;
}

export interface ProgressUpdate {
  stage: string;
  percent: number;
  message: string;
}

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
}
