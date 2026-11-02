"""Step 11.3 fix: direct assigned_id filtering (explicit-ID requests).

Regression coverage for the reported live failure
``filter #1: unsupported field/op combination (assigned_id none_of)``:
the frontend engine already evaluated ``assigned_id`` any_of/none_of,
but the backend vocabulary rejected the very conditions the model was
allowed to emit, so exclusion requests never updated the panel.

All MCP and model calls are mocked -- no live Meta API or Azure calls.
"""

from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient

from app.agents.assistant_agent import AssistantAgent
from app.main import create_app
from app.models.assistant import FilterCondition
from app.routers.assistant import get_assistant_agent
from test_assistant import (
    FakeDiscoveryAgent,
    FakeMCPClient,
    FakeModelClient,
    chat_request,
    draft,
    endpoint_client,
)

EXCLUDED = ["390", "391", "762", "763", "761", "563", "392", "764",
            "765", "766", "760", "564", "513", "767"]


def chat_with(filters, **overrides):
    model = FakeModelClient(draft(
        reply="Excluding the datasets you named.",
        filter_command="apply",
        filters=filters,
        filter_description="Exclude the named datasets.",
        **overrides,
    ))
    return asyncio.run(
        AssistantAgent(FakeMCPClient(), model).chat(
            chat_request("Remove Crime Incidents datasets before 2025")))

def test_assigned_id_none_of_strings_applies():
    result = chat_with([{"field": "assigned_id", "op": "none_of",
                         "value": EXCLUDED}])
    assert result.filter_action.action == "apply"
    assert result.filter_action.filters == [
        FilterCondition(field="assigned_id", op="none_of", value=EXCLUDED)
    ]

def test_assigned_id_accepts_numeric_forms():
    result = chat_with([{"field": "AssignedID", "op": "none_of",
                         "value": [390, 391.0, " 762 "]}])
    assert result.filter_action.action == "apply"
    assert result.filter_action.filters[0].field == "assigned_id"
    assert result.filter_action.filters[0].value == ["390", "391", "762"]

def test_assigned_id_field_aliases_canonicalize():
    for alias in ("AssignedID", "assignedId", "assigned_id"):
        cond = FilterCondition(field=alias, op="any_of", value=["1"])
        assert cond.field == "assigned_id"
        assert cond.value == ["1"]

def test_assigned_id_one_of_applies():
    result = chat_with([{"field": "assigned_id", "op": "one_of",
                         "value": ["900", "901"]}])
    assert result.filter_action.action == "apply"
    assert result.filter_action.filters[0].value == ["900", "901"]

def test_assigned_id_single_scalar_value_applies():
    result = chat_with([{"field": "assigned_id", "op": "none_of",
                         "value": 390}])
    assert result.filter_action.action == "apply"
    assert result.filter_action.filters[0].value == ["390"]

def test_assigned_id_unsupported_op_is_unsupported():
    result = chat_with([{"field": "assigned_id", "op": "contains",
                         "value": ["390"]}])
    assert result.filter_action.action == "unsupported"
    assert "assigned_id contains" in result.filter_action.unsupported_reason

def test_assigned_id_malformed_values_are_rejected_safely():
    for bad in ([], [True, ""], ["   "], [None], [390.5]):
        result = chat_with([{"field": "assigned_id", "op": "none_of",
                             "value": bad}])
        assert result.filter_action.action == "unsupported", bad
        assert "non-empty list" in result.filter_action.unsupported_reason

def test_assigned_id_combines_with_other_criteria():
    result = chat_with([
        {"field": "relevance_score", "op": "gte", "value": 60},
        {"field": "assigned_id", "op": "none_of", "value": EXCLUDED},
    ])
    assert result.filter_action.action == "apply"
    assert [c.field for c in result.filter_action.filters] == [
        "relevance_score", "assigned_id"]
    assert result.filter_action.filters[1].value == EXCLUDED

def test_assigned_id_partial_failure_rejects_whole_action():
    # All-or-nothing: one bad condition vetoes the valid one too, so the
    # panel never silently broadens or narrows the request.
    result = chat_with([
        {"field": "assigned_id", "op": "none_of", "value": ["390"]},
        {"field": "assigned_id", "op": "contains", "value": ["391"]},
    ])
    assert result.filter_action.action == "unsupported"
    assert "filter #2" in result.filter_action.unsupported_reason

def test_endpoint_round_trips_assigned_id_filter():
    agent = AssistantAgent(FakeMCPClient(), FakeModelClient(draft(
        reply="Excluded.",
        filter_command="apply",
        filters=[{"field": "assigned_id", "op": "none_of",
                  "value": [390, "391"]}],
        filter_description="Exclude the named datasets.",
    )), discovery_agent=FakeDiscoveryAgent())
    app = create_app()
    app.dependency_overrides[get_assistant_agent] = lambda: agent
    response = TestClient(app, raise_server_exceptions=False).post(
        "/api/assistant/chat",
        json={"message": "Remove datasets 390 and 391",
              "history": [], "context": {}},
    )
    assert response.status_code == 200
    action = response.json()["filter_action"]
    assert action["action"] == "apply"
    assert action["filters"] == [
        {"field": "assigned_id", "op": "none_of",
         "value": ["390", "391"]}
    ]
