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

    # Discovery Agent safety limits (Steps 9/11.2). Catalog scan bounds
    # report partial coverage via completeness/warnings, never silently
    # skipped pages. discovery_candidate_limit is retained for
    # backward-compatible construction only; ranking no longer truncates
    # to it.
    #
    # Live-server limits verified 2026-11-01 against the Azure Metadata
    # MCP Server (see Step 11.2 report): get_metadata_catalog rejects
    # limit > 100 ("limit cannot exceed 100. Use pagination with offset"),
    # and get_layer_metadata rejects more than 50 layer_ids per call
    # ("Too many layer_ids. Maximum per call is 50."). Do not raise
    # discovery_catalog_page_size above 100 without a matching server-side
    # change to MAX_CATALOG_ROWS_PER_CALL; larger pages were benchmarked
    # and rejected (100 -> ok, 500/1000 -> error). The agent pages with
    # offset/next_offset and chunks detail lookups to <= 50 IDs instead.
    discovery_catalog_page_size: int = Field(default=500, ge=1, le=500)
    discovery_max_catalog_records: int = Field(default=10000, ge=1)
    discovery_candidate_limit: int = Field(default=30, ge=1, le=200)
    discovery_rank_batch_size: int = Field(default=10, ge=1, le=50)
    # Step 12 full-catalog architectures. "full_parallel" (Architecture B)
    # is the default: every catalog record is evaluated by Muse, in
    # concurrent batches, with no deterministic prefilter. "full_single"
    # (Architecture A) sends the whole catalog in one model call when it
    # fits the input token budget, otherwise it falls back to parallel
    # batches. "legacy" preserves the Step 11.2 heuristic-prefilter path
    # for benchmark comparison and rollback only.
    discovery_mode: str = Field(default="full_parallel")
    discovery_full_catalog_batch_size: int = Field(default=750, ge=100, le=1000)
    discovery_full_catalog_concurrency: int = Field(default=4, ge=1, le=8)
    # Safe single-call input budget (tokens), leaving headroom inside the
    # 1,048,576-token muse-spark-1.3 context for reasoning + JSON output.
    discovery_full_catalog_input_token_budget: int = Field(
        default=900000, ge=10000
    )
    # Relevance gate (Step 11.2): the ranking model scores 0-100 where
    # >= 75 is a direct match, 40-74 is useful supporting context, and
    # < 40 is weak/tangential. Only scores >= this threshold surface as
    # recommendations; weak matches are excluded rather than capped by
    # count, so broad requests still paginate over genuinely relevant sets.
    discovery_min_relevance_score: float = Field(default=40.0, ge=0, le=100)
    # Per-operation completion budgets (reasoning + visible JSON). Planning
    # output is small; ranking returns one evaluation per candidate.
    discovery_plan_max_completion_tokens: int = Field(default=4096, ge=256)
    discovery_rank_max_completion_tokens: int = Field(default=8192, ge=256)

    # Data Recipe Agent (Step 10).
    recipe_max_completion_tokens: int = Field(default=8192, ge=256)

    # AI Assistant Agent (Step 11.3). One structured chat call per user
    # message over a compact candidate context; MCP is touched only for
    # targeted verification, geo/date filter resolution, or an explicitly
    # allowed broader catalog search.
    assistant_max_completion_tokens: int = Field(default=2048, ge=256)


@lru_cache
def get_settings() -> Settings:
    """Return the cached application settings."""
    return Settings()
