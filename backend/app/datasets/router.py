import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, status

from ..auth.dependencies import require_auth
from ..config import get_settings
from ..database import get_client
from .models import DatasetCreate
from .processing import TEMP_DIR, run_processing_pipeline
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


@router.post("", status_code=status.HTTP_201_CREATED)
def create_dataset(body: DatasetCreate, _: Auth):
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
    )
    return {"dataset_id": dataset_id, "status": "queued", "clickhouse_table": table_name}


@router.get("")
def list_all_datasets(_: Auth):
    client = get_client()
    return list_datasets(client)


@router.get("/{dataset_id}")
def get_one_dataset(dataset_id: str, _: Auth):
    client = get_client()
    row = get_dataset(client, dataset_id)
    if row is None or row["status"] == "deleted":
        raise HTTPException(status_code=404, detail="Dataset not found")
    return row


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dataset(dataset_id: str, _: Auth):
    client = get_client()
    row = get_dataset(client, dataset_id)
    if row is None or row["status"] == "deleted":
        raise HTTPException(status_code=404, detail="Dataset not found")

    table = row["clickhouse_table"]
    # DROP TABLE is instant; individual row deletes via mutation would be slow
    client.command(f"DROP TABLE IF EXISTS databrief.`{table}`")

    update_dataset_status(client, dataset_id, "deleted")


@router.post("/{dataset_id}/upload")
async def upload_file(
    dataset_id: str,
    file: UploadFile,
    background_tasks: BackgroundTasks,
    _: Auth,
):
    client = get_client()
    row = get_dataset(client, dataset_id)
    if row is None or row["status"] == "deleted":
        raise HTTPException(status_code=404, detail="Dataset not found")
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
            while chunk := await file.read(1024 * 1024):  # 1 MB at a time
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


@router.get("/{dataset_id}/progress")
def get_progress(dataset_id: str, _: Auth):
    client = get_client()
    progress = get_latest_progress(client, dataset_id)
    if progress is None:
        return {"dataset_id": dataset_id, "stage": "queued", "percent": 0.0, "message": "Waiting to start"}
    return progress
