from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    clickhouse_host: str = "localhost"
    clickhouse_port: int = 8123
    clickhouse_db: str = "databrief"
    clickhouse_user: str = "databrief"
    clickhouse_password: str = ""

    app_user: str = "admin"
    app_password_hash: str = ""

    jwt_secret: str = ""
    jwt_expiry_hours: int = 24

    groq_api_key: str = ""

    max_upload_mb: int = 3072
    sample_row_cap: int = 20000

    model_config = {"env_file": ".env", "case_sensitive": False, "extra": "ignore"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
