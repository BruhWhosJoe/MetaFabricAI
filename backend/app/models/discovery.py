"""Structured discovery models for Step 9 (Pydantic-validated).

Request/response shapes are the contract the Step 11 frontend and the
Step 10 Data Recipe generator will consume. ``AssignedID`` preserves the
exact MCP catalog identifier casing so Step 10 can call
``get_layer_metadata`` with it unchanged.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class DiscoveryRequest(BaseModel):
    """Citizen natural-language discovery request.

    ``max_recommendations`` is an optional explicit page size for legacy
    callers. When omitted (the default), the agent returns every dataset
    that meets the relevance criteria, ordered by relevance -- there is no
    default total cap.
    """

    question: str = Field(min_length=3, max_length=2000)
    location: str | None = Field(default=None, max_length=200)
    max_recommendations: int | None = Field(default=None, ge=1)

    @field_validator("question")
    @classmethod
    def _strip_question(cls, value: str) -> str:
        stripped = value.strip()
        if len(stripped) < 3:
            raise ValueError("question must contain at least 3 characters")
        return stripped

    @field_validator("location")
    @classmethod
    def _strip_location(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class SearchPlan(BaseModel):
    """Internal structured search plan produced by question understanding."""

    subject: str = ""
    summary: str = ""
    geographic_area: str | None = None
    categories: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    dataset_roles: list[str] = Field(default_factory=list)
    geographic_requirements: list[str] = Field(default_factory=list)
    demographic_requirements: list[str] = Field(default_factory=list)
    additional_fields: list[str] = Field(default_factory=list)
    ambiguities: list[str] = Field(default_factory=list)


class CandidateEvaluation(BaseModel):
    """One model relevance evaluation for a verified catalog record."""

    AssignedID: str
    relevance_score: float = Field(ge=0, le=100)
    relevance_reason: str = ""
    proposed_role: str = ""
    limitations: list[str] = Field(default_factory=list)

    @field_validator("limitations", mode="before")
    @classmethod
    def _coerce_limitations(cls, value: object) -> object:
        if value is None:
            return []
        if isinstance(value, str):
            return [value] if value.strip() else []
        return value


class RankingResult(BaseModel):
    """Model ranking output for one batch of verified candidates."""

    evaluations: list[CandidateEvaluation] = Field(default_factory=list)


class DatasetRecommendation(BaseModel):
    """A ranked dataset recommendation grounded in MCP metadata."""

    AssignedID: str
    title: str | None = None
    description: str | None = None
    source_portal: str | None = None
    access_url: str | None = None
    relevance_score: float = Field(ge=0, le=100)
    relevance_reason: str = ""
    proposed_role: str = ""
    limitations: list[str] = Field(default_factory=list)


class DiscoveryResponse(BaseModel):
    """Structured response returned by POST /api/discovery/search.

    ``candidate_count`` is the number of catalog records that passed the
    heuristic prefilter and were sent to relevance ranking;
    ``recommendations`` is the subset that also passed the model relevance
    threshold. ``timings_ms`` reports per-stage server-side durations for
    performance diagnosis (Step 11.2); it is diagnostic only and never
    affects ranking.
    """

    request_id: str
    question: str
    interpreted_intent: str = ""
    recommendations: list[DatasetRecommendation] = Field(default_factory=list)
    catalog_total: int | None = None
    catalog_examined: int = 0
    completeness: Literal["complete", "partial", "unknown"] = "unknown"
    warnings: list[str] = Field(default_factory=list)
    candidate_count: int = Field(default=0, ge=0)
    timings_ms: dict[str, float] | None = None
