-- datasets: editable metadata; use ReplacingMergeTree so status changes are appended
-- rather than mutated in-place.  Read with FINAL or argMax(..., updated_at).
CREATE TABLE IF NOT EXISTS databrief.datasets
(
    dataset_id      String,
    name            String,
    original_filename String,
    file_type       String,
    status          String,   -- queued | processing | ready | failed
    row_count       UInt64,
    column_count    UInt32,
    clickhouse_table String,
    cleaning_log    String,   -- JSON array of human-readable lines
    column_schema   String,   -- JSON array of {name, type, nullable}
    quality_score   Float32,
    error_message   String,
    created_at      DateTime64(3, 'UTC'),
    updated_at      DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY dataset_id;

-- dataset_progress: append-only; read latest with argMax(percent, updated_at)
CREATE TABLE IF NOT EXISTS databrief.dataset_progress
(
    dataset_id  String,
    stage       String,   -- e.g. "parsing", "cleaning", "inserting"
    percent     Float32,
    message     String,
    updated_at  DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (dataset_id, updated_at);

-- chat_threads: editable (title can change); ReplacingMergeTree
CREATE TABLE IF NOT EXISTS databrief.chat_threads
(
    thread_id   String,
    title       String,
    created_at  DateTime64(3, 'UTC'),
    updated_at  DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY thread_id;

-- chat_messages: append-only; messages are never edited
CREATE TABLE IF NOT EXISTS databrief.chat_messages
(
    message_id              String,
    thread_id               String,
    role                    String,   -- user | assistant
    content                 String,
    referenced_dataset_ids  String,   -- JSON array of dataset_id strings
    created_at              DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (thread_id, created_at);

-- kpis: cached computed KPIs; ReplacingMergeTree so re-running KPI computation
-- replaces old values rather than appending duplicates. Read with FINAL.
CREATE TABLE IF NOT EXISTS databrief.kpis
(
    kpi_id          String,
    dataset_id      String,
    name            String,
    value           String,       -- formatted display string
    raw_value       Float64,
    change_percent  Float64,
    trend           String,       -- up | down | flat
    category        String,
    created_at      DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (dataset_id, name);
