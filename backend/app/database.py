import clickhouse_connect
from .config import get_settings


def get_client() -> clickhouse_connect.driver.Client:
    s = get_settings()
    return clickhouse_connect.get_client(
        host=s.clickhouse_host,
        port=s.clickhouse_port,
        username=s.clickhouse_user,
        password=s.clickhouse_password,
        database=s.clickhouse_db,
        connect_timeout=10,
    )
