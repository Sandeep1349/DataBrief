import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, status

from ..auth.dependencies import require_auth
from ..config import get_settings
from ..database import get_client
from .models import DatasetCreate
from pydantic import BaseModel as _BaseModel

class UploadUrlBody(_BaseModel):
    url: str


class ManualCleanRule(_BaseModel):
    type: str  # replace | delete_where | fill_null
    column: str
    find_value: str | None = None
    replace_value: str | None = None
    operator: str | None = None
    value: str | None = None
    fill_value: str | None = None


class ManualCleanBody(_BaseModel):
    rules: list[ManualCleanRule]
from .processing import TEMP_DIR, run_processing_pipeline, run_url_processing_pipeline, run_ai_cleaning, run_revert_cleaning, run_manual_cleaning
from .queries import (
    get_dataset,
    get_latest_progress,
    insert_dataset_version,
    insert_progress,
    list_datasets,
    update_dataset_status,
)

router = APIRouter(prefix="/datasets", tags=["datasets"])

Auth = Annotated[str, Depends(require_auth)]


def _require_owned(client, dataset_id: str, username: str) -> dict:
    row = get_dataset(client, dataset_id)
    if row is None or row["status"] == "deleted":
        raise HTTPException(status_code=404, detail="Dataset not found")
    if row["owner_username"] != username:
        raise HTTPException(status_code=403, detail="Access denied")
    return row


@router.post("", status_code=status.HTTP_201_CREATED)
def create_dataset(body: DatasetCreate, username: Auth):
    dataset_id = str(uuid.uuid4())
    table_name = f"ds_{dataset_id.replace('-', '_')}"
    client = get_client()
    insert_dataset_version(
        client,
        dataset_id=dataset_id,
        name=body.name,
        original_filename=body.original_filename,
        file_type=body.file_type,
        status="queued",
        clickhouse_table=table_name,
        owner_username=username,
    )
    return {"dataset_id": dataset_id, "status": "queued", "clickhouse_table": table_name}


@router.get("")
def list_all_datasets(username: Auth):
    client = get_client()
    return list_datasets(client, owner_username=username)


@router.get("/{dataset_id}")
def get_one_dataset(dataset_id: str, username: Auth):
    client = get_client()
    return _require_owned(client, dataset_id, username)


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dataset(dataset_id: str, username: Auth):
    client = get_client()
    row = _require_owned(client, dataset_id, username)

    table = row["clickhouse_table"]
    client.command(f"DROP TABLE IF EXISTS databrief.`{table}`")
    update_dataset_status(client, dataset_id, "deleted")


@router.post("/{dataset_id}/upload")
async def upload_file(
    dataset_id: str,
    file: UploadFile,
    background_tasks: BackgroundTasks,
    username: Auth,
):
    client = get_client()
    row = _require_owned(client, dataset_id, username)
    if row["status"] != "queued":
        raise HTTPException(
            status_code=409, detail=f"Dataset is already in status '{row['status']}'"
        )

    settings = get_settings()
    max_bytes = settings.max_upload_mb * 1024 * 1024

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = "".join(c if c.isalnum() or c in (".", "-", "_") else "_" for c in (file.filename or "upload"))
    temp_path = TEMP_DIR / f"{dataset_id}_{safe_name}"

    bytes_written = 0
    try:
        with open(temp_path, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                bytes_written += len(chunk)
                if bytes_written > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds the {settings.max_upload_mb} MB limit",
                    )
                f.write(chunk)
    except HTTPException:
        temp_path.unlink(missing_ok=True)
        raise

    background_tasks.add_task(
        run_processing_pipeline,
        dataset_id=dataset_id,
        temp_path=temp_path,
        file_type=row["file_type"],
        table_name=row["clickhouse_table"],
    )

    return {"dataset_id": dataset_id, "status": "processing"}


@router.post("/{dataset_id}/upload-url")
def upload_from_url(dataset_id: str, body: UploadUrlBody, background_tasks: BackgroundTasks, username: Auth):
    if not body.url.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="URL must start with http:// or https://")
    client = get_client()
    row = _require_owned(client, dataset_id, username)
    if row["status"] != "queued":
        raise HTTPException(status_code=409, detail=f"Dataset is already in status '{row['status']}'")
    background_tasks.add_task(
        run_url_processing_pipeline,
        dataset_id=dataset_id,
        url=body.url,
        table_name=row["clickhouse_table"],
    )
    return {"dataset_id": dataset_id, "status": "processing"}


@router.get("/{dataset_id}/progress")
def get_progress(dataset_id: str, username: Auth):
    client = get_client()
    _require_owned(client, dataset_id, username)
    progress = get_latest_progress(client, dataset_id)
    if progress is None:
        return {"dataset_id": dataset_id, "stage": "queued", "percent": 0.0, "message": "Waiting to start"}
    return progress


@router.post("/{dataset_id}/clean", status_code=status.HTTP_202_ACCEPTED)
def clean_dataset(dataset_id: str, background_tasks: BackgroundTasks, username: Auth):
    client = get_client()
    row = _require_owned(client, dataset_id, username)
    if row["status"] not in ("ready",):
        raise HTTPException(status_code=409, detail=f"Dataset must be ready to clean (current: {row['status']})")
    update_dataset_status(client, dataset_id, "cleaning")
    background_tasks.add_task(
        run_ai_cleaning,
        dataset_id=dataset_id,
        table_name=row["clickhouse_table"],
        column_schema_json=row.get("column_schema", "[]"),
    )
    return {"dataset_id": dataset_id, "status": "cleaning"}


@router.post("/{dataset_id}/revert", status_code=status.HTTP_202_ACCEPTED)
def revert_dataset(dataset_id: str, background_tasks: BackgroundTasks, username: Auth):
    client = get_client()
    row = _require_owned(client, dataset_id, username)
    if row["status"] not in ("ready",):
        raise HTTPException(status_code=409, detail=f"Dataset must be ready to revert (current: {row['status']})")
    update_dataset_status(client, dataset_id, "cleaning")
    background_tasks.add_task(
        run_revert_cleaning,
        dataset_id=dataset_id,
        table_name=row["clickhouse_table"],
    )
    return {"dataset_id": dataset_id, "status": "cleaning"}


@router.post("/{dataset_id}/manual-clean", status_code=status.HTTP_202_ACCEPTED)
def manual_clean_dataset(dataset_id: str, body: ManualCleanBody, background_tasks: BackgroundTasks, username: Auth):
    client = get_client()
    row = _require_owned(client, dataset_id, username)
    if row["status"] not in ("ready",):
        raise HTTPException(status_code=409, detail=f"Dataset must be ready to clean (current: {row['status']})")
    if not body.rules:
        raise HTTPException(status_code=422, detail="Provide at least one cleaning rule")
    update_dataset_status(client, dataset_id, "cleaning")
    rules_dicts = [r.model_dump() for r in body.rules]
    background_tasks.add_task(
        run_manual_cleaning,
        dataset_id=dataset_id,
        table_name=row["clickhouse_table"],
        rules=rules_dicts,
        column_schema_json=row.get("column_schema", "[]"),
    )
    return {"dataset_id": dataset_id, "status": "cleaning"}
