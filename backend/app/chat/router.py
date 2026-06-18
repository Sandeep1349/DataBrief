"""Chat endpoints — threads, messages, streaming responses.

Thread and message state is persisted in ClickHouse (chat_threads,
chat_messages tables). The Chat agent streams SSE-formatted responses.
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..auth.dependencies import require_auth
from ..analytics.kpis import get_kpis
from ..database import get_client
from ..datasets.queries import list_datasets, get_dataset
from .agents import stream_chat_response, run_writer, generate_thread_title

router = APIRouter(prefix="/chat", tags=["chat"])
Auth = Annotated[str, Depends(require_auth)]


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ThreadCreate(BaseModel):
    title: str = "New conversation"


class ThreadUpdate(BaseModel):
    title: str


class MessageCreate(BaseModel):
    content: str
    dataset_ids: list[str] = []  # empty = all datasets


# ---------------------------------------------------------------------------
# Thread endpoints
# ---------------------------------------------------------------------------

@router.post("/threads", status_code=status.HTTP_201_CREATED)
def create_thread(body: ThreadCreate, _: Auth):
    client = get_client()
    thread_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    client.insert(
        "databrief.chat_threads",
        [[thread_id, body.title, now, now]],
        column_names=["thread_id", "title", "created_at", "updated_at"],
    )
    return {"thread_id": thread_id, "title": body.title, "created_at": now}


@router.get("/recent-datasets")
def recent_datasets(_: Auth):
    """Return IDs of up to 3 most recently used datasets across all chat messages."""
    client = get_client()
    result = client.query(
        """
        SELECT referenced_dataset_ids
        FROM databrief.chat_messages
        WHERE role = 'assistant'
        ORDER BY created_at DESC
        LIMIT 100
        """
    )
    seen: list[str] = []
    for row in result.named_results():
        try:
            ids = json.loads(row["referenced_dataset_ids"] or "[]")
            for ds_id in ids:
                if ds_id and ds_id not in seen:
                    seen.append(ds_id)
                if len(seen) >= 3:
                    return seen
        except Exception:
            pass
    return seen


@router.get("/threads")
def list_threads(_: Auth):
    client = get_client()
    result = client.query(
        """
        SELECT thread_id, title, created_at, updated_at
        FROM databrief.chat_threads FINAL
        WHERE title != '__deleted__'
        ORDER BY updated_at DESC
        LIMIT 100
        """
    )
    return list(result.named_results())


@router.get("/threads/{thread_id}")
def get_thread(thread_id: str, _: Auth):
    client = get_client()
    result = client.query(
        "SELECT thread_id, title, created_at, updated_at FROM databrief.chat_threads FINAL "
        "WHERE thread_id = {thread_id:String} LIMIT 1",
        parameters={"thread_id": thread_id},
    )
    rows = list(result.named_results())
    if not rows or rows[0]["title"] == "__deleted__":
        raise HTTPException(status_code=404, detail="Thread not found")
    return rows[0]


@router.delete("/threads/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_thread(thread_id: str, _: Auth):
    client = get_client()
    now = datetime.now(timezone.utc)
    # Soft-delete by inserting a replacement row (ReplacingMergeTree)
    result = client.query(
        "SELECT thread_id, created_at FROM databrief.chat_threads FINAL "
        "WHERE thread_id = {thread_id:String} LIMIT 1",
        parameters={"thread_id": thread_id},
    )
    rows = list(result.named_results())
    if not rows:
        raise HTTPException(status_code=404, detail="Thread not found")
    client.insert(
        "databrief.chat_threads",
        [[thread_id, "__deleted__", rows[0]["created_at"], now]],
        column_names=["thread_id", "title", "created_at", "updated_at"],
    )


@router.patch("/threads/{thread_id}")
def rename_thread(thread_id: str, body: ThreadUpdate, _: Auth):
    client = get_client()
    result = client.query(
        "SELECT thread_id, created_at FROM databrief.chat_threads FINAL "
        "WHERE thread_id = {thread_id:String} AND title != '__deleted__' LIMIT 1",
        parameters={"thread_id": thread_id},
    )
    rows = list(result.named_results())
    if not rows:
        raise HTTPException(status_code=404, detail="Thread not found")
    now = datetime.now(timezone.utc)
    client.insert(
        "databrief.chat_threads",
        [[thread_id, body.title, rows[0]["created_at"], now]],
        column_names=["thread_id", "title", "created_at", "updated_at"],
    )
    return {"thread_id": thread_id, "title": body.title}


# ---------------------------------------------------------------------------
# Message endpoints
# ---------------------------------------------------------------------------

@router.get("/threads/{thread_id}/messages")
def list_messages(thread_id: str, _: Auth):
    client = get_client()
    result = client.query(
        """
        SELECT message_id, thread_id, role, content, referenced_dataset_ids, created_at
        FROM databrief.chat_messages
        WHERE thread_id = {thread_id:String}
        ORDER BY created_at ASC
        LIMIT 500
        """,
        parameters={"thread_id": thread_id},
    )
    return list(result.named_results())


@router.post("/threads/{thread_id}/messages")
async def send_message(thread_id: str, body: MessageCreate, username: Auth):
    """Send a user message and stream the assistant response as SSE."""
    client = get_client()

    # Validate thread exists
    result = client.query(
        "SELECT thread_id FROM databrief.chat_threads FINAL "
        "WHERE thread_id = {thread_id:String} AND title != '__deleted__' LIMIT 1",
        parameters={"thread_id": thread_id},
    )
    if not list(result.named_results()):
        raise HTTPException(status_code=404, detail="Thread not found")

    # Persist user message
    user_msg_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    client.insert(
        "databrief.chat_messages",
        [[user_msg_id, thread_id, "user", body.content, json.dumps(body.dataset_ids), now]],
        column_names=["message_id", "thread_id", "role", "content", "referenced_dataset_ids", "created_at"],
    )

    # Load conversation history (last 20 messages)
    hist_result = client.query(
        """
        SELECT role, content FROM databrief.chat_messages
        WHERE thread_id = {thread_id:String}
        ORDER BY created_at DESC
        LIMIT 20
        """,
        parameters={"thread_id": thread_id},
    )
    history = list(reversed(list(hist_result.named_results())))
    # Drop the user message we just inserted (it's included in the stream call)
    history = [h for h in history if h["content"] != body.content]

    # Resolve dataset scope (only this user's datasets)
    all_datasets = list_datasets(client, owner_username=username)
    ready_datasets = [d for d in all_datasets if d["status"] == "ready"]
    if body.dataset_ids:
        scoped = [d for d in ready_datasets if d["dataset_id"] in body.dataset_ids]
    else:
        scoped = ready_datasets  # cross-dataset scope per spec

    # Build schemas for each dataset
    schemas = []
    for ds in scoped[:5]:  # cap to 5 datasets in context
        try:
            schema = json.loads(ds.get("column_schema") or "[]")
            schemas.append({
                "table": ds["clickhouse_table"],
                "name": ds["name"],
                "columns": [c["name"] for c in schema],
            })
        except Exception:
            pass

    # Gather KPIs from all scoped datasets
    all_kpis: list[dict] = []
    for ds in scoped[:5]:
        all_kpis.extend(get_kpis(client, ds["dataset_id"]))

    # Stream generator that also persists the final response
    def generate():
        full_text = ""
        for chunk in stream_chat_response(thread_id, body.content, history, schemas, all_kpis):
            yield chunk
            # Extract full text from the done event to persist
            if chunk.startswith('data: {"type": "done"') or '"type":"done"' in chunk:
                try:
                    data = json.loads(chunk[6:])
                    full_text = data.get("full_text", "")
                except Exception:
                    pass

        # Persist assistant response after stream ends
        if full_text:
            try:
                asst_msg_id = str(uuid.uuid4())
                client.insert(
                    "databrief.chat_messages",
                    [[asst_msg_id, thread_id, "assistant", full_text,
                      json.dumps([d["dataset_id"] for d in scoped]),
                      datetime.now(timezone.utc)]],
                    column_names=["message_id", "thread_id", "role", "content",
                                  "referenced_dataset_ids", "created_at"],
                )
            except Exception:
                pass

            # Auto-generate title on the first exchange
            if not history:
                try:
                    new_title = generate_thread_title(body.content, full_text)
                    created_result = client.query(
                        "SELECT created_at FROM databrief.chat_threads FINAL "
                        "WHERE thread_id = {thread_id:String} LIMIT 1",
                        parameters={"thread_id": thread_id},
                    )
                    created_rows = list(created_result.named_results())
                    if created_rows:
                        client.insert(
                            "databrief.chat_threads",
                            [[thread_id, new_title, created_rows[0]["created_at"],
                              datetime.now(timezone.utc)]],
                            column_names=["thread_id", "title", "created_at", "updated_at"],
                        )
                except Exception:
                    pass

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Insights endpoint (Writer agent)
# ---------------------------------------------------------------------------

@router.get("/datasets/{dataset_id}/insights")
def get_insights(dataset_id: str, username: Auth):
    """Generate an executive summary for a dataset using the Writer agent."""
    client = get_client()
    ds = get_dataset(client, dataset_id)
    if ds is None or ds["status"] == "deleted":
        raise HTTPException(status_code=404, detail="Dataset not found")
    if ds.get("owner_username", "") != username:
        raise HTTPException(status_code=403, detail="Access denied")
    if ds["status"] != "ready":
        raise HTTPException(status_code=404, detail="Dataset not found or not ready")

    kpis = get_kpis(client, dataset_id)
    narrative = run_writer(ds["name"], kpis)
    return {"dataset_id": dataset_id, "name": ds["name"], "narrative": narrative}
