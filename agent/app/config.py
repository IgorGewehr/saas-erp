"""Runtime configuration — loaded once from env, validated by pydantic."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Core ---
    agent_shared_secret: str = Field(..., alias="AGENT_SHARED_SECRET")
    openai_api_key: str = Field(..., alias="OPENAI_API_KEY")
    next_public_api_base_url: str = Field(..., alias="NEXT_PUBLIC_API_BASE_URL")

    # --- Model defaults ---
    openai_model_default: str = Field("gpt-4o-mini", alias="OPENAI_MODEL_DEFAULT")

    # --- Server ---
    host: str = Field("0.0.0.0", alias="HOST")
    port: int = Field(8080, alias="PORT")
    log_level: str = Field("INFO", alias="LOG_LEVEL")

    # --- Safety ---
    agent_max_iterations: int = Field(8, alias="AGENT_MAX_ITERATIONS")
    agent_request_timeout_s: int = Field(30, alias="AGENT_REQUEST_TIMEOUT_S")

    # --- LangSmith (optional) ---
    langchain_tracing_v2: bool = Field(False, alias="LANGCHAIN_TRACING_V2")
    langchain_api_key: str | None = Field(None, alias="LANGCHAIN_API_KEY")
    langchain_project: str | None = Field(None, alias="LANGCHAIN_PROJECT")


@lru_cache
def get_settings() -> Settings:
    """Singleton accessor. Call once per module that needs config."""
    return Settings()  # type: ignore[call-arg]
