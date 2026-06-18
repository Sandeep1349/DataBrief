"""ClickHouse helpers for dataset metadata — all writes are appends (ReplacingMergeTree)."""
from datetime import datetime, timezone
from typing import Any, Optional


def _now() -> datetime:
    return datetime.now(timezone.utc)


def insert_dataset_version(
    client,
    *,
    dataset_id: str,
    name: str,
    original_filename: str,
    file_type: str,
    status: str,
    clickhouse_table: str,
    owner_username: str = "",
    row_count: int = 0,
    column_count: int = 0,
    cleaning_log: str = "[]",
    column_schema: str = "[]",
    quality_score: float = 0.0,
    error_message: str = "",
    created_at: Optional[datetime] = None,
) -> None:
    now = _now()
    client.insert(
        "databrief.datasets",
        [[
            dataset_id, name, original_filename, file_type, status,
            row_count, column_count, clickhouse_table,
            cleaning_log, column_schema, quality_score, error_message,
            created_at or now, now, owner_username,
        ]],
        column_names=[
            "dataset_id", "name", "original_filename", "file_type", "status",
            "row_count", "column_count", "clickhouse_table",
            "cleaning_log", "column_schema", "quality_score", "error_message",
            "created_at", "updated_at", "owner_username",
        ],
    )


def update_dataset_status(
    client,
    dataset_id: str,
    status: str,
    error_message: str = "",
    **kwargs: Any,
) -> None:
    row = get_dataset(client, dataset_id)
    if row is None:
        return
    insert_dataset_version(
        client,
        dataset_id=dataset_id,
        name=row["name"],
        original_filename=row["original_filename"],
        file_type=row["file_type"],
        status=status,
        clickhouse_table=row["clickhouse_table"],
        owner_username=row.get("owner_username", ""),
        row_count=kwargs.get("row_count", row["row_count"]),
        column_count=kwargs.get("column_count", row["column_count"]),
        cleaning_log=kwargs.get("cleaning_log", row["cleaning_log"]),
        column_schema=kwargs.get("column_schema", row["column_schema"]),
        quality_score=kwargs.get("quality_score", row["quality_score"]),
        error_message=error_message,
        created_at=row["created_at"],
    )


def insert_progress(
    client, dataset_id: str, stage: str, percent: float, message: str
) -> None:
    client.insert(
        "databrief.dataset_progress",
        [[dataset_id, stage, percent, message, _now()]],
        column_names=["dataset_id", "stage", "percent", "message", "updated_at"],
    )


def get_dataset(client, dataset_id: str) -> Optional[dict]:
    result = client.query(
        """
        SELECT
            dataset_id, name, original_filename, file_type, status,
            row_count, column_count, clickhouse_table,
            cleaning_log, column_schema, quality_score, error_message,
            created_at, updated_at, owner_username
        FROM databrief.datasets FINAL
        WHERE dataset_id = {dataset_id:String}
        LIMIT 1
        """,
        parameters={"dataset_id": dataset_id},
    )
    rows = list(result.named_results())
    return rows[0] if rows else None


def list_datasets(client, owner_username: Optional[str] = None) -> list[dict]:
    """Return datasets. If owner_username is provided, filter to that user only."""
    if owner_username is not None:
        result = client.query(
            """
            SELECT
                dataset_id, name, original_filename, file_type, status,
                row_count, column_count, clickhouse_table,
                cleaning_log, column_schema, quality_score, error_message,
                created_at, updated_at, owner_username
            FROM databrief.datasets FINAL
            WHERE status != 'deleted' AND owner_username = {owner:String}
            ORDER BY created_at DESC
            """,
            parameters={"owner": owner_username},
        )
    else:
        result = client.query(
            """
            SELECT
                dataset_id, name, original_filename, file_type, status,
                row_count, column_count, clickhouse_table,
                cleaning_log, column_schema, quality_score, error_message,
                created_at, updated_at, owner_username
            FROM databrief.datasets FINAL
            WHERE status != 'deleted'
            ORDER BY created_at DESC
            """
        )
    return list(result.named_results())


def get_latest_progress(client, dataset_id: str) -> Optional[dict]:
    result = client.query(
        """
        SELECT
            dataset_id,
            argMax(stage,   updated_at) AS stage,
            argMax(percent, updated_at) AS percent,
            argMax(message, updated_at) AS message
        FROM databrief.dataset_progress
        WHERE dataset_id = {dataset_id:String}
        GROUP BY dataset_id
        LIMIT 1
        """,
        parameters={"dataset_id": dataset_id},
    )
    rows = list(result.named_results())
    return rows[0] if rows else None
