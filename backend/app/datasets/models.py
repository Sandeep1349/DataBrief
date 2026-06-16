from pydantic import BaseModel


class DatasetCreate(BaseModel):
    name: str
    original_filename: str
    file_type: str  # csv | xlsx | parquet


class ProgressResponse(BaseModel):
    dataset_id: str
    stage: str
    percent: float
    message: str
