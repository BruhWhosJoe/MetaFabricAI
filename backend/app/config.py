"""Environment-based configuration for the MetaFabricAI backend.

Settings are loaded from environment variables and, for local development,
from ``backend/.env`` (git-ignored). See ``backend/.env.example`` for the
documented variables. No secrets are hard-coded here.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parents[1]

DEFAULT_MCP_SERVER_URL = (
    "https://ca-metadata-mcp-dev.wittyforest-26c063ae."
    "eastus.azurecontainerapps.io/mcp"
)


class Settings(BaseSettings):
    """Runtime settings, overridable via environment variables / .env."""

    model_config = SettingsConfigDict(
        env_file=_BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    mcp_server_url: str = Field(default=DEFAULT_MCP_SERVER_URL)
    mcp_timeout_seconds: float = Field(default=60.0, gt=0)

    # Meta Model API (Step 9). The API key is server-side only and is never
    # exposed to the frontend, logs, or HTTP responses.
    model_api_key: str | None = Field(default=None)
    meta_model: str = Field(default="muse-spark-1.3")
    meta_reasoning_model: str = Field(default="muse-wonder-1.0")
    meta_api_base_url: str = Field(default="https://api.meta.ai/v1")
    model_timeout_seconds: float = Field(default=60.0, gt=0)
    model_max_retries: int = Field(default=2, ge=0, le=5)
    # Muse Spark is a reasoning model: hidden reasoning tokens count toward
    # the completion budget, so budgets must cover reasoning + visible JSON.
    # "low" keeps straightforward planning/ranking reasoning bounded.
    model_reasoning_effort: str | None = Field(default="low")

    # Discovery Agent safety limits (Step 9). These bound catalog scanning
    # and model token use; hitting a limit yields partial results, never
    # silently skipped pages.
    discovery_catalog_page_size: int = Field(default=100, ge=1, le=100)
    discovery_max_catalog_records: int = Field(default=10000, ge=1)
    discovery_candidate_limit: int = Field(default=30, ge=1, le=200)
    discovery_rank_batch_size: int = Field(default=10, ge=1, le=50)
    discovery_min_relevance_score: float = Field(default=1.0, ge=0, le=100)
    # Per-operation completion budgets (reasoning + visible JSON). Planning
    # output is small; ranking returns one evaluation per candidate.
    discovery_plan_max_completion_tokens: int = Field(default=4096, ge=256)
    discovery_rank_max_completion_tokens: int = Field(default=8192, ge=256)

    # Data Recipe Agent (Step 10).
    recipe_max_completion_tokens: int = Field(default=8192, ge=256)


@lru_cache
def get_settings() -> Settings:
    """Return the cached application settings."""
    return Settings()
