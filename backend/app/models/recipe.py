"""Structured Data Recipe models for Step 10 (Pydantic-validated).

A Data Recipe is a *proposed*, editable analytical workflow built from
datasets the user selected after Step 9 discovery. It is never executed by
this step: ``status`` is always ``"proposed_not_executed"`` and
``analysis_performed`` is always ``False``.

Identifiers: ``AssignedID`` preserves the exact MCP catalog identifier so
the frontend can later add/remove datasets and re-request generation, and
every workflow step carries a stable ``step_id`` plus explicit
``input_dataset_ids`` / ``input_step_ids`` references so steps can be
rendered as connected nodes in an interactive workflow diagram.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, Field, field_validator, model_validator


def _normalize_id(value: object) -> str:
    if isinstance(value, bool) or value is None:
        raise ValueError("AssignedID values must be non-empty strings")
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not value.is_integer():
            raise ValueError("AssignedID values must be non-empty strings")
        return str(int(value))
    if isinstance(value, str):
        return value.strip()
    raise ValueError("AssignedID values must be non-empty strings")


def _strip_list(value: object) -> object:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    return value


class DiscoveryDatasetContext(BaseModel):
    """Optional per-dataset context carried over from Step 9 discovery."""

    AssignedID: str
    relevance_reason: str = ""
    proposed_role: str = ""

    @field_validator("AssignedID", mode="before")
    @classmethod
    def _normalize_assigned_id(cls, value: object) -> str:
        normalized = _normalize_id(value)
        if not normalized:
            raise ValueError("AssignedID must not be empty")
        return normalized


class DiscoveryContext(BaseModel):
    """Optional useful context from the preceding discovery step."""

    interpreted_intent: str = ""
    location: str | None = Field(default=None, max_length=200)
    dataset_context: list[DiscoveryDatasetContext] = Field(default_factory=list)

    @field_validator("location")
    @classmethod
    def _strip_location(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class RecipeRequest(BaseModel):
    """Request to generate a Data Recipe from selected verified datasets."""

    question: str = Field(min_length=3, max_length=2000)
    selected_assigned_ids: list[str] = Field(
        validation_alias=AliasChoices(
            "selected_assigned_ids",
            "selectedAssignedIDs",
            "selectedAssignedIds",
            "selected_dataset_assigned_ids",
            "assigned_ids",
            "AssignedIDs",
            "selected_ids",
            "selected_dataset_ids",
            "dataset_assigned_ids",
            "dataset_ids",
        ),
        serialization_alias="selected_assigned_ids",
        min_length=1,
        max_length=20,
    )
    location: str | None = Field(default=None, max_length=200)
    discovery_context: DiscoveryContext | None = None

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

    @field_validator("selected_assigned_ids", mode="before")
    @classmethod
    def _normalize_ids(cls, value: object) -> object:
        if isinstance(value, (str, int, float)) and not isinstance(value, bool):
            value = [value]
        if not isinstance(value, (list, tuple)):
            return value
        return [_normalize_id(item) for item in value]

    @model_validator(mode="after")
    def _check_ids(self) -> "RecipeRequest":
        ids = self.selected_assigned_ids
        if not ids:
            raise ValueError("selected_assigned_ids must not be empty")
        if any(not item for item in ids):
            raise ValueError("selected_assigned_ids must not contain empty values")
        seen: set[str] = set()
        duplicates: list[str] = []
        for item in ids:
            if item in seen and item not in duplicates:
                duplicates.append(item)
            seen.add(item)
        if duplicates:
            raise ValueError(
                "selected_assigned_ids contains duplicate AssignedID "
                f"value(s): {', '.join(duplicates)}"
            )
        return self


# ---------------------------------------------------------------------------
# Verified dataset + recipe building blocks
# ---------------------------------------------------------------------------


class RecipeDataset(BaseModel):
    """One user-selected dataset, verified against MCP metadata.

    Identity/metadata fields are populated by the server from the MCP
    record, never by the model. ``role``/``role_explanation`` are the
    model's proposed role for this dataset in the workflow.
    """

    AssignedID: str
    title: str | None = None
    description: str | None = None
    summary: str | None = None
    source_portal: str | None = None
    access_url: str | None = None
    tags: str | None = None
    topic_categories: str | None = None
    extent: str | None = None
    role: str = "input dataset"
    role_explanation: str = ""
    relevance_reason: str = ""
    limitations: list[str] = Field(default_factory=list)
    # Full MCP record as returned by get_layer_metadata, preserved verbatim
    # (JSON values only) so no verified metadata is lost.
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("limitations", mode="before")
    @classmethod
    def _coerce_limitations(cls, value: object) -> object:
        return _strip_list(value)


class DatasetRelationship(BaseModel):
    """A proposed relationship between two verified selected datasets.

    ``source_dataset_id``/``target_dataset_id`` are AssignedIDs of selected
    datasets, suitable as edge endpoints in a workflow diagram.
    ``basis`` distinguishes relationships supported by the verified
    metadata from proposed ones that still require verification.
    """

    relationship_id: str
    source_dataset_id: str
    target_dataset_id: str
    relationship_type: str = "related"
    description: str = ""
    basis: Literal["metadata_supported", "proposed_requires_verification"] = (
        "proposed_requires_verification"
    )
    verification_needed: list[str] = Field(default_factory=list)

    @field_validator("verification_needed", mode="before")
    @classmethod
    def _coerce_list(cls, value: object) -> object:
        return _strip_list(value)


class WorkflowStep(BaseModel):
    """One ordered, editable step in the proposed analytical workflow."""

    step_id: str
    order: int = Field(ge=1)
    operation: str
    title: str = ""
    explanation: str = ""
    input_dataset_ids: list[str] = Field(default_factory=list)
    input_step_ids: list[str] = Field(default_factory=list)
    proposed_output: str = ""

    @field_validator("input_dataset_ids", "input_step_ids", mode="before")
    @classmethod
    def _coerce_list(cls, value: object) -> object:
        return _strip_list(value)


class ExpectedOutput(BaseModel):
    """A proposed analytical output (nothing has been produced yet)."""

    name: str
    description: str = ""
    produced_by_step_id: str | None = None


# ---------------------------------------------------------------------------
# Internal model (LLM) draft -- validated, then grounded by the agent
# ---------------------------------------------------------------------------


class ModelDatasetRole(BaseModel):
    AssignedID: str
    role: str = ""
    role_explanation: str = ""
    limitations: list[str] = Field(default_factory=list)

    @field_validator("AssignedID", mode="before")
    @classmethod
    def _normalize(cls, value: object) -> object:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return _normalize_id(value)
        return value.strip() if isinstance(value, str) else value

    @field_validator("limitations", mode="before")
    @classmethod
    def _coerce(cls, value: object) -> object:
        return _strip_list(value)


class ModelRelationship(BaseModel):
    source_dataset_id: str = ""
    target_dataset_id: str = ""
    relationship_type: str = "related"
    description: str = ""
    basis: Literal[
        "metadata_supported", "proposed_requires_verification"
    ] = "proposed_requires_verification"
    verification_needed: list[str] = Field(default_factory=list)

    @field_validator("verification_needed", mode="before")
    @classmethod
    def _coerce(cls, value: object) -> object:
        return _strip_list(value)


class ModelWorkflowStep(BaseModel):
    step_id: str = ""
    operation: str = ""
    title: str = ""
    explanation: str = ""
    input_dataset_ids: list[str] = Field(default_factory=list)
    input_step_ids: list[str] = Field(default_factory=list)
    proposed_output: str = ""

    @field_validator("input_dataset_ids", "input_step_ids", mode="before")
    @classmethod
    def _coerce(cls, value: object) -> object:
        return _strip_list(value)


class RecipeDraft(BaseModel):
    """Raw structured draft returned by the model; grounded by the agent."""

    analytical_objective: str = ""
    dataset_roles: list[ModelDatasetRole] = Field(default_factory=list)
    relationships: list[ModelRelationship] = Field(default_factory=list)
    workflow_steps: list[ModelWorkflowStep] = Field(default_factory=list)
    expected_outputs: list[str] = Field(default_factory=list)
    data_gaps: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)

    @field_validator(
        "expected_outputs", "data_gaps", "assumptions", "limitations",
        "uncertainties",
        mode="before",
    )
    @classmethod
    def _coerce(cls, value: object) -> object:
        return _strip_list(value)


# ---------------------------------------------------------------------------
# Response
# ---------------------------------------------------------------------------


class DataRecipeResponse(BaseModel):
    """Structured Data Recipe returned by POST /api/recipe/generate."""

    recipe_id: str
    question: str
    analytical_objective: str = ""
    status: Literal["proposed_not_executed"] = "proposed_not_executed"
    analysis_performed: Literal[False] = False
    selected_datasets: list[RecipeDataset] = Field(default_factory=list)
    relationships: list[DatasetRelationship] = Field(default_factory=list)
    workflow_steps: list[WorkflowStep] = Field(default_factory=list)
    expected_outputs: list[str] = Field(default_factory=list)
    data_gaps: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

    @property
    def selected_assigned_ids(self) -> list[str]:
        return [dataset.AssignedID for dataset in self.selected_datasets]


# Backwards-friendly alias.
RecipeResponse = DataRecipeResponse
RecipeGenerateRequest = RecipeRequest
