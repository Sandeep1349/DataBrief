import re
import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from ..auth.dependencies import require_auth

router = APIRouter(prefix="/databases", tags=["databases"])
Auth = Annotated[str, Depends(require_auth)]


class DbParams(BaseModel):
    db_type: str  # postgresql | mysql | sqlite
    host: str = "localhost"
    port: int | None = None
    database: str
    username: str = ""
    password: str = ""


class DbImportParams(DbParams):
    src_table: str
    dataset_name: str


def _connect(p: DbParams):
    if p.db_type == "postgresql":
        try:
            import psycopg2
        except ImportError:
            raise HTTPException(status_code=500, detail="psycopg2 not installed")
        port = p.port or 5432
        return psycopg2.connect(
            host=p.host, port=port, dbname=p.database,
            user=p.username, password=p.password, connect_timeout=10,
        )
    elif p.db_type == "mysql":
        try:
            import pymysql
        except ImportError:
            raise HTTPException(status_code=500, detail="pymysql not installed")
        port = p.port or 3306
        return pymysql.connect(
            host=p.host, port=port, database=p.database,
            user=p.username, password=p.password, connect_timeout=10,
        )
    elif p.db_type == "sqlite":
        import sqlite3
        return sqlite3.connect(p.database)
    else:
        raise HTTPException(status_code=422, detail=f"Unsupported DB type: {p.db_type}")


def _list_tables_from_conn(conn, db_type: str) -> list[str]:
    cur = conn.cursor()
    if db_type == "postgresql":
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' "
            "ORDER BY table_name"
        )
    elif db_type == "mysql":
        cur.execute("SHOW TABLES")
    else:  # sqlite
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    return [row[0] for row in cur.fetchall()]


@router.post("/test")
def test_connection(params: DbParams, username: Auth):
    try:
        conn = _connect(params)
        conn.close()
        return {"ok": True, "message": "Connection successful"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/tables")
def list_tables(params: DbParams, username: Auth):
    try:
        conn = _connect(params)
        tables = _list_tables_from_conn(conn, params.db_type)
        conn.close()
        return {"tables": tables}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/import", status_code=201)
def import_table(params: DbImportParams, background_tasks: BackgroundTasks, username: Auth):
    # Validate table name to prevent SQL injection
    if not re.match(r"^[\w\-. ]+$", params.src_table):
        raise HTTPException(status_code=422, detail="Invalid table name")

    from ..database import get_client
    from ..datasets.queries import insert_dataset_version
    from ..datasets.processing import run_db_import_pipeline

    dataset_id = str(uuid.uuid4())
    ch_table = f"ds_{dataset_id.replace('-', '_')}"

    client = get_client()
    insert_dataset_version(
        client,
        dataset_id=dataset_id,
        name=params.dataset_name,
        original_filename=f"{params.src_table} ({params.db_type})",
        file_type="csv",
        status="queued",
        clickhouse_table=ch_table,
        owner_username=username,
    )

    background_tasks.add_task(
        run_db_import_pipeline,
        dataset_id=dataset_id,
        table_name=ch_table,
        conn_params=params.model_dump(),
        src_table=params.src_table,
    )

    return {"dataset_id": dataset_id, "status": "processing"}
