import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth.router import router as auth_router
from .datasets.router import router as datasets_router
from .analytics.router import router as analytics_router
from .chat.router import router as chat_router

log = logging.getLogger(__name__)


def _recover_stuck_datasets() -> None:
    """On startup, mark any dataset stuck in 'processing' as 'failed'.

    Temp files are ephemeral and won't survive a backend restart, so the
    pipeline cannot be automatically restarted — the user must re-upload.
    This clears the stuck state so they can do so.
    """
    try:
        from .database import get_client
        from .datasets.queries import list_datasets, update_dataset_status, insert_progress

        client = get_client()
        for ds in list_datasets(client):
            if ds["status"] == "processing":
                log.warning(
                    "Dataset %s stuck in 'processing' — marking failed (re-upload required)",
                    ds["dataset_id"],
                )
                update_dataset_status(
                    client,
                    ds["dataset_id"],
                    "failed",
                    error_message="Server restarted during processing. Please re-upload the file.",
                )
                insert_progress(
                    client,
                    ds["dataset_id"],
                    "failed",
                    0.0,
                    "Server restarted mid-processing — re-upload required",
                )
    except Exception as exc:
        # Don't crash startup if ClickHouse isn't ready yet
        log.warning("Startup recovery check skipped: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _recover_stuck_datasets()
    yield


app = FastAPI(title="DataBrief API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(datasets_router)
app.include_router(analytics_router)
app.include_router(chat_router)


@app.get("/health")
def health():
    return {"status": "ok"}
