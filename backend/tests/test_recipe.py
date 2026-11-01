"""Tests for Step 10 Data Recipe: agent, models, and endpoint.

All MCP and model calls are mocked -- no live Meta API or Azure calls.
"""

import json

import pytest
from fastapi.testclient import TestClient

from app.agents.recipe_agent import (
    RECIPE_SYSTEM_PROMPT,
    RecipeAgent,
    RecipeDatasetNotFoundError,
    RecipeValidationError,
)
from app.main import create_app
from app.models.recipe import RecipeRequest
from app.routers.recipe import get_recipe_agent
from app.services.mcp_client import MCPConnectionError
from app.services.model_client import (
    ModelConfigurationError,
    ModelProviderError,
    ModelResponseError,
)

QUESTION = "Which neighborhoods in Washington, DC are vulnerable to flooding?"


def make_row(assigned_id, title, **overrides):
    row = {
        "AssignedID": assigned_id,
        "Title": title,
        "LayerList": "[]",
        "Summary": f"Summary for {title}",
        "Description": f"Description for {title} in Washington DC.",
        "Tags": "flood, washington dc",
        "PortalName": "opendata.dc.gov",
        "AccessURL": f"https://example.gov/datasets/{assigned_id}",
        "Extent": "[-77.1,38.8,-76.9,39.0]",
        "TopicCategories": "/Categories/Environment",
    }
    row.update(overrides)
    return row


ROWS = [
    make_row("42", "Flood Hazard Areas"),
    make_row("7", "Elderly Population by Neighborhood"),
]


def default_draft(candidate_ids):
    return {
        "analytical_objective": "Identify neighborhoods exposed to flood hazard.",
        "dataset_roles": [
            {"AssignedID": cid, "role": "input dataset",
             "role_explanation": f"Role for {cid}", "limitations": []}
            for cid in candidate_ids
        ],
        "relationships": (
            [{
                "source_dataset_id": candidate_ids[0],
                "target_dataset_id": candidate_ids[1],
                "relationship_type": "spatial_overlay",
                "description": "Overlay hazard with population.",
                "basis": "proposed_requires_verification",
                "verification_needed": ["geometry", "coordinate system"],
            }] if len(candidate_ids) > 1 else []
        ),
        "workflow_steps": [
            {"step_id": "load", "operation": "load_datasets",
             "title": "Load datasets", "explanation": "Load selected data.",
             "input_dataset_ids": list(candidate_ids), "input_step_ids": [],
             "proposed_output": "loaded datasets"},
            {"step_id": "join", "operation": "spatial_overlay",
             "title": "Overlay", "explanation": "Overlay hazard and population.",
             "input_dataset_ids": [], "input_step_ids": ["load"],
             "proposed_output": "neighborhood flood exposure"},
        ],
        "expected_outputs": ["Map of flood-exposed neighborhoods"],
        "data_gaps": ["No building-level damage data selected."],
        "assumptions": ["Datasets share a compatible geography."],
        "limitations": ["Recipe has not been executed."],
        "uncertainties": ["Coordinate systems require verification."],
    }


class FakeMCPClient:
    server_url = "https://example.invalid/mcp"

    def __init__(self, rows=None, error=None):
        self.rows = ROWS if rows is None else rows
        self.error = error
        self.detail_calls = []
        self.catalog_calls = 0

    async def get_layer_metadata(self, layer_ids, fields=None):
        self.detail_calls.append(list(layer_ids))
        if self.error is not None:
            raise self.error
        by_id = {str(r.get("AssignedID")): r for r in self.rows}
        return {"rows": [by_id[i] for i in layer_ids if i in by_id]}

    async def get_metadata_catalog(self, **kwargs):  # pragma: no cover
        self.catalog_calls += 1
        raise AssertionError("recipe must not rescan the catalog")

    async def get_metadata_fields(self, **kwargs):  # pragma: no cover
        raise AssertionError("recipe must not rescan the catalog")


class FakeModelClient:
    def __init__(self, draft=None, error=None, configured=True):
        self.draft = draft
        self.error = error
        self.configured = configured
        self.calls = []

    def ensure_configured(self):
        if not self.configured:
            raise ModelConfigurationError("MODEL_API_KEY is not configured.")

    async def generate_json(self, *, system_prompt, user_prompt, schema_name,
                            json_schema, use_reasoning=False,
                            max_completion_tokens=4096):
        self.calls.append({
            "schema_name": schema_name, "system_prompt": system_prompt,
            "user_prompt": user_prompt, "use_reasoning": use_reasoning,
        })
        if self.error is not None:
            raise self.error
        if callable(self.draft):
            return self.draft(json.loads(user_prompt))
        if self.draft is not None:
            return self.draft
        payload = json.loads(user_prompt)
        ids = [d["AssignedID"] for d in payload["selected_datasets"]]
        return default_draft(ids)


def make_agent(mcp=None, model=None):
    return RecipeAgent(mcp or FakeMCPClient(), model or FakeModelClient())


def endpoint_client(agent):
    app = create_app()
    app.dependency_overrides[get_recipe_agent] = lambda: agent
    return TestClient(app, raise_server_exceptions=False)


def make_request(ids, **kwargs):
    return RecipeRequest(question=QUESTION, selected_assigned_ids=ids, **kwargs)


# Successful generation (multiple datasets) --------------------------------
@pytest.mark.asyncio
async def test_successful_generation_multiple_datasets():
    mcp, model = FakeMCPClient(), FakeModelClient()
    result = await make_agent(mcp, model).generate(make_request(["42", "7"]))
    assert result.status == "proposed_not_executed"
    assert result.analysis_performed is False
    assert result.recipe_id
    assert result.question == QUESTION
    assert result.analytical_objective
    assert [d.AssignedID for d in result.selected_datasets] == ["42", "7"]
    assert [d.title for d in result.selected_datasets] == [
        "Flood Hazard Areas", "Elderly Population by Neighborhood"]
    assert all(d.role == "input dataset" for d in result.selected_datasets)
    assert result.relationships[0].source_dataset_id == "42"
    assert result.relationships[0].target_dataset_id == "7"
    assert result.relationships[0].basis == "proposed_requires_verification"
    assert result.expected_outputs and result.data_gaps
    assert result.assumptions and result.limitations and result.uncertainties
    # Exact-ID verification only: one get_layer_metadata call, no rescan.
    assert mcp.detail_calls == [["42", "7"]]
    assert mcp.catalog_calls == 0
    assert model.calls[0]["schema_name"] == "data_recipe"
    assert model.calls[0]["use_reasoning"] is False  # Muse Spark default


# One selected dataset -------------------------------------------------------
@pytest.mark.asyncio
async def test_one_selected_dataset():
    mcp = FakeMCPClient()
    result = await make_agent(mcp).generate(make_request(["42"]))
    assert [d.AssignedID for d in result.selected_datasets] == ["42"]
    assert result.relationships == []
    assert result.workflow_steps
    assert mcp.detail_calls == [["42"]]


# Preservation of verified metadata + selection order ------------------------
@pytest.mark.asyncio
async def test_preservation_of_verified_metadata_and_order():
    result = await make_agent().generate(make_request(["7", "42"]))
    assert [d.AssignedID for d in result.selected_datasets] == ["7", "42"]
    first = result.selected_datasets[0]
    assert first.metadata == ROWS[1]
    assert first.source_portal == "opendata.dc.gov"
    assert first.access_url == "https://example.gov/datasets/7"
    assert first.extent == "[-77.1,38.8,-76.9,39.0]"


# Stable workflow references ---------------------------------------------------
@pytest.mark.asyncio
async def test_stable_workflow_references():
    result = await make_agent().generate(make_request(["42", "7"]))
    steps = result.workflow_steps
    assert [s.step_id for s in steps] == ["step-1", "step-2"]
    assert [s.order for s in steps] == [1, 2]
    assert steps[0].input_dataset_ids == ["42", "7"]
    assert steps[1].input_step_ids == ["step-1"]
    known_datasets = {"42", "7"}
    seen_steps = set()
    for step in steps:
        assert set(step.input_dataset_ids) <= known_datasets
        assert set(step.input_step_ids) <= seen_steps
        seen_steps.add(step.step_id)


@pytest.mark.asyncio
async def test_model_invented_ids_are_dropped():
    def draft(payload):
        data = default_draft(["42", "7"])
        data["dataset_roles"].append(
            {"AssignedID": "9999", "role": "invented",
             "role_explanation": "", "limitations": []})
        data["relationships"].append({
            "source_dataset_id": "42", "target_dataset_id": "9999",
            "relationship_type": "join", "description": "invented",
            "basis": "metadata_supported", "verification_needed": []})
        data["workflow_steps"][0]["input_dataset_ids"] = ["42", "9999"]
        data["workflow_steps"][1]["input_step_ids"] = ["step-999", "load"]
        return data

    result = await make_agent(model=FakeModelClient(draft=draft)).generate(
        make_request(["42", "7"]))
    assert [d.AssignedID for d in result.selected_datasets] == ["42", "7"]
    assert all(r.target_dataset_id != "9999" for r in result.relationships)
    assert result.workflow_steps[0].input_dataset_ids == ["42"]
    assert result.workflow_steps[1].input_step_ids == ["step-1"]
    assert any("unverified" in w for w in result.warnings)


# Duplicate / empty / invalid selections --------------------------------------
def test_duplicate_assigned_ids_rejected():
    with pytest.raises(Exception, match="duplicate"):
        make_request(["42", "42"])
    client = endpoint_client(make_agent())
    response = client.post("/api/recipe/generate", json={
        "question": QUESTION, "selected_assigned_ids": ["42", "42"]})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_agent_rejects_duplicate_ids_directly():
    agent = make_agent()
    request = make_request(["42"])
    request.selected_assigned_ids = ["42", "42"]  # bypass model validation
    with pytest.raises(RecipeValidationError, match="duplicate"):
        await agent.generate(request)


def test_empty_and_blank_selections_rejected():
    for ids in ([], [""], ["  "]):
        with pytest.raises(Exception):
            make_request(ids)
    client = endpoint_client(make_agent())
    assert client.post("/api/recipe/generate", json={
        "question": QUESTION, "selected_assigned_ids": []}).status_code == 422
    assert client.post("/api/recipe/generate", json={
        "question": "ab", "selected_assigned_ids": ["42"]}).status_code == 422


# Missing / invalid AssignedIDs -------------------------------------------------
@pytest.mark.asyncio
async def test_missing_assigned_id_raises_not_found():
    mcp, model = FakeMCPClient(), FakeModelClient()
    with pytest.raises(RecipeDatasetNotFoundError) as excinfo:
        await make_agent(mcp, model).generate(make_request(["42", "9999"]))
    assert excinfo.value.missing_ids == ["9999"]
    assert model.calls == []  # model never runs on unverified datasets


def test_missing_assigned_id_endpoint_404():
    client = endpoint_client(make_agent())
    response = client.post("/api/recipe/generate", json={
        "question": QUESTION, "selected_assigned_ids": ["9999"]})
    assert response.status_code == 404
    assert response.json()["error"] == "dataset_not_found"
    assert "9999" in response.json()["detail"]


# MCP failure --------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mcp_failure_propagates_and_endpoint_503():
    agent = make_agent(mcp=FakeMCPClient(error=MCPConnectionError("refused")))
    with pytest.raises(MCPConnectionError):
        await agent.generate(make_request(["42"]))
    response = endpoint_client(agent).post("/api/recipe/generate", json={
        "question": QUESTION, "selected_assigned_ids": ["42"]})
    assert response.status_code == 503
    assert response.json()["error"] == "mcp_unavailable"


# Model failure / malformed JSON ---------------------------------------------------
@pytest.mark.asyncio
@pytest.mark.parametrize("error", [
    ModelProviderError("Meta Model API timed out"),
    ModelResponseError("Model response contained malformed JSON."),
])
async def test_model_failure_propagates(error):
    agent = make_agent(model=FakeModelClient(error=error))
    with pytest.raises(type(error)):
        await agent.generate(make_request(["42"]))
    response = endpoint_client(agent).post("/api/recipe/generate", json={
        "question": QUESTION, "selected_assigned_ids": ["42"]})
    assert response.status_code == 502
    assert response.json()["error"] == "model_error"


@pytest.mark.asyncio
async def test_model_malformed_schema_output_is_safe_error():
    agent = make_agent(model=FakeModelClient(
        draft={"workflow_steps": "not-a-list"}))
    with pytest.raises(ModelResponseError, match="failed validation"):
        await agent.generate(make_request(["42"]))


@pytest.mark.asyncio
async def test_model_without_steps_is_safe_error():
    draft = default_draft(["42"])
    draft["workflow_steps"] = []
    agent = make_agent(model=FakeModelClient(draft=draft))
    with pytest.raises(ModelResponseError, match="no usable workflow steps"):
        await agent.generate(make_request(["42"]))


def test_missing_model_key_endpoint_503_without_secret_leak():
    agent = make_agent(model=FakeModelClient(configured=False))
    response = endpoint_client(agent).post("/api/recipe/generate", json={
        "question": QUESTION, "selected_assigned_ids": ["42"]})
    assert response.status_code == 503
    assert response.json()["error"] == "model_not_configured"
    assert "your_actual" not in response.text


# Endpoint contract ---------------------------------------------------------------
def test_recipe_endpoint_happy_path_and_existing_endpoints():
    client = endpoint_client(make_agent())
    response = client.post("/api/recipe/generate", json={
        "question": QUESTION,
        "selected_assigned_ids": ["42", "7"],
        "discovery_context": {
            "interpreted_intent": "Find flood-vulnerable neighborhoods.",
            "location": "Washington, DC",
            "dataset_context": [
                {"AssignedID": "42", "relevance_reason": "Flood hazard.",
                 "proposed_role": "hazard layer"},
            ],
        },
    })
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "proposed_not_executed"
    assert body["analysis_performed"] is False
    assert body["recipe_id"] and body["question"] == QUESTION
    assert [d["AssignedID"] for d in body["selected_datasets"]] == ["42", "7"]
    assert body["selected_datasets"][0]["relevance_reason"] == "Flood hazard."
    assert body["workflow_steps"][1]["input_step_ids"] == ["step-1"]
    assert set(body) == {
        "recipe_id", "question", "analytical_objective", "status",
        "analysis_performed", "selected_datasets", "relationships",
        "workflow_steps", "expected_outputs", "data_gaps", "assumptions",
        "limitations", "uncertainties", "warnings"}

    assert client.get("/api/health").status_code == 200
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/recipe/generate" in paths
    assert "/api/discovery/search" in paths  # Step 9 preserved
    assert "/api/health" in paths and "/api/mcp/health" in paths


def test_recipe_request_alias_and_prompt_grounding():
    request = RecipeRequest(question=QUESTION, AssignedIDs=["42"])
    assert request.selected_assigned_ids == ["42"]
    assert "never claim any analysis has been performed" in RECIPE_SYSTEM_PROMPT
    assert "Do not invent" in RECIPE_SYSTEM_PROMPT
