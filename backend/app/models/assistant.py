"""Structured AI Assistant chat models for Step 11.3 (Pydantic-validated).

The assistant answers questions about datasets, metadata, search results,
and the current discovery mission. Dataset-specific answers are grounded in
real MCP catalog metadata: the frontend sends a compact context of the
current candidates, the model replies with a structured draft
(``AssistantDraft``), and the agent verifies every referenced ``AssignedID``
with targeted ``get_layer_metadata`` calls before responding. Model-invented
identifiers are dropped, never surfaced.

Conversational filtering uses the same path: the model translates the
user's intent into ``FilterCondition`` entries, the agent validates them
against the supported vocabulary, and the frontend applies them
deterministically. Conditions that need metadata absent from the compact
recommendations (geographic extent, modification dates) are resolved by the
agent into explicit ``assigned_id`` ID-list filters via targeted MCP
retrieval, or reported as ``unsupported`` with an explanation -- never
guessed.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationInfo, field_validator

from app.models.discovery import DiscoveryResponse

FilterField = Literal[
    "keyword",
    "title",
    "description",
    "source",
    "proposed_role",
    "location",
    "has_access_url",
    "has_geo",
    "relevance_score",
    "updated_after",
    "assigned_id",
]

FilterOp = Literal[
    "contains",
    "not_contains",
    "equals",
    "not_equals",
    "gte",
    "lte",
    "any_of",
    "one_of",
    "none_of",
]

FilterActionType = Literal["apply", "clear", "undo", "none", "unsupported"]

FilterCommandType = Literal["apply", "clear", "undo", "none"]


def _normalize_id(value: object) -> str | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return str(int(value)) if float(value).is_integer() else None
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _canonical_filter_field(value: object) -> object:
    """Map field-name variants to one canonical internal field.

    The model may emit ``AssignedID``, ``assignedId``, or
    ``assigned_id``; all three address the same dataset identifier and
    must validate identically. Unknown fields pass through unchanged so
    Pydantic still rejects them (422-style, never silent broadening).
    """
    if isinstance(value, str):
        compact = re.sub(r"[\s_]+", "", value).lower()
        if compact == "assignedid":
            return "assigned_id"
    return value


def _normalize_assigned_id_list(value: object) -> list[str]:
    """Coerce a raw assigned_id value to a clean, deduped ID list.

    Accepts a single ID or a list mixing numeric and string forms
    (``390``, ``390.0``, ``" 390 "`` all mean ``"390"``). Booleans,
    blanks, non-integral floats, and other malformed entries are dropped
    rather than matched -- an empty result means the value carries no
    usable ID and the caller must reject it as unsupported.
    """
    items = value if isinstance(value, (list, tuple)) else [value]
    out: list[str] = []
    for item in items:
        normalized = _normalize_id(item)
        if normalized and normalized not in out:
            out.append(normalized)
    return out


class FilterCondition(BaseModel):
    """One deterministic dataset filter condition."""

    field: FilterField
    op: FilterOp
    value: str | float | bool | list[str | int | float] | None = None

    @field_validator("field", mode="before")
    @classmethod
    def _canonical_field(cls, value: object) -> object:
        return _canonical_filter_field(value)

    @field_validator("value", mode="before")
    @classmethod
    def _normalize_value(cls, value: object, info: ValidationInfo) -> object:
        if info.data.get("field") != "assigned_id":
            return value
        return _normalize_assigned_id_list(value)


class FilterAction(BaseModel):
    """Structured filter instruction returned to the frontend.

    The frontend applies ``apply`` filters deterministically, clears all on
    ``clear``, pops its filter history on ``undo``, and shows
    ``unsupported_reason`` for ``unsupported``/``none`` without changing
    results.
    """

    action: FilterActionType = "none"
    filters: list[FilterCondition] = Field(default_factory=list)
    description: str = ""
    unsupported_reason: str = ""


class AssistantHistoryMessage(BaseModel):
    """One prior chat turn, kept as data (never instructions)."""

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class AssistantDatasetSnippet(BaseModel):
    """Compact candidate context supplied by the frontend.

    Only the fields the discovery response already carries are sent, so chat
    never re-fetches the full catalog. Longer text is truncated by the
    sender; the agent re-truncates defensively.
    """

    AssignedID: str
    title: str | None = None
    description: str | None = None
    source_portal: str | None = None
    access_url: str | None = None
    relevance_score: float | None = None
    relevance_reason: str | None = None
    proposed_role: str | None = None

    @field_validator("AssignedID", mode="before")
    @classmethod
    def _normalize_assigned_id(cls, value: object) -> str:
        normalized = _normalize_id(value)
        if not normalized:
            raise ValueError("AssignedID must not be empty")
        return normalized


class AssistantContext(BaseModel):
    """Authoritative workspace snapshot accompanying a chat message."""

    question: str = ""
    interpreted_intent: str = ""
    location: str | None = None
    candidate_datasets: list[AssistantDatasetSnippet] = Field(default_factory=list)
    selected_assigned_ids: list[str] = Field(default_factory=list)
    active_filter_descriptions: list[str] = Field(default_factory=list)
    recipe_summary: str | None = None
    # Full-workspace counts (Step 11.3 Task 4): the compact
    # candidate_datasets list is capped for the model prompt, so count
    # questions ("How many datasets remain?") are answered from these
    # exact figures instead of the truncated list. Defaults keep older
    # clients valid; the agent falls back to the candidate list length.
    total_candidates: int = Field(default=0, ge=0)
    visible_candidates: int = Field(default=0, ge=0)

    @field_validator("selected_assigned_ids", mode="before")
    @classmethod
    def _normalize_ids(cls, value: object) -> object:
        if not isinstance(value, (list, tuple)):
            return value
        return [v for v in (_normalize_id(item) for item in value) if v]


class AssistantChatRequest(BaseModel):
    """Chat request from the frontend assistant panel."""

    message: str = Field(min_length=1, max_length=2000)
    history: list[AssistantHistoryMessage] = Field(default_factory=list, max_length=30)
    context: AssistantContext = Field(default_factory=AssistantContext)
    allow_catalog_search: bool = False
    max_context_datasets: int = Field(default=20, ge=1, le=50)

    @field_validator("message")
    @classmethod
    def _strip_message(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("message must not be blank")
        return stripped


class AssistantDraft(BaseModel):
    """Raw structured draft returned by the model; grounded by the agent."""

    reply: str = ""
    referenced_assigned_ids: list[str] = Field(default_factory=list)
    filter_command: FilterCommandType = "none"
    filters: list[FilterCondition] = Field(default_factory=list)
    filter_description: str = ""
    needs_catalog_search: bool = False
    catalog_query: str = ""
    unsupported_reason: str = ""


class AssistantChatResponse(BaseModel):
    """Structured chat response consumed by the assistant panel."""

    reply: str
    referenced_assigned_ids: list[str] = Field(default_factory=list)
    grounded_assigned_ids: list[str] = Field(default_factory=list)
    filter_action: FilterAction = Field(default_factory=FilterAction)
    needs_catalog_search: bool = False
    catalog_query: str | None = None
    catalog_search: DiscoveryResponse | None = None
    warnings: list[str] = Field(default_factory=list)
