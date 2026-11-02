"""Step 11.2 regression tests: performance, relevance, AccessURL.

All MCP and model calls are mocked -- no live Meta API or Azure calls.
Covers: timing/pagination behavior, large candidate sets, accurate
relevance filtering (> 5 genuinely relevant results, weak matches
excluded), scan-field AccessURL preservation, chunked enrichment, and
Discovery-vs-Recipe AccessURL consistency.
"""

from __future__ import annotations

import pytest

from app.agents.discovery_agent import (
    ENRICH_BATCH_SIZE,
    DiscoveryAgent,
    record_access_url,
)
from app.agents.recipe_agent import RecipeAgent
from app.models.discovery import DiscoveryRequest
from app.models.recipe import RecipeRequest
from app.services.mcp_client import MCPConnectionError, MCPToolError

HEALTH_PLAN = {
    "subject": "healthcare data",
    "summary": "Find healthcare related data.",
    "geographic_area": None,
    "categories": ["health", "healthcare"],
    "keywords": ["health", "healthcare", "clinic", "hospital", "medical"],
    "dataset_roles": ["health dataset"],
    "geographic_requirements": [],
    "demographic_requirements": [],
    "additional_fields": [],
    "ambiguities": [],
}

TIMING_KEYS = {
    "mcp_fields_ms",
    "plan_model_ms",
    "catalog_scan_ms",
    "catalog_pages",
    "prefilter_ms",
    "rank_model_ms",
    "rank_batches",
    "enrich_ms",
    "serialize_ms",
    "total_ms",
}


def health_row(assigned_id: str, title: str, **overrides):
    row = {
        "AssignedID": assigned_id,
        "Title": title,
        "LayerList": "[]",
        "Summary": f"Summary for {title}",
        "Description": f"Description for {title} about community health and clinics.",
        "Tags": "health, clinic, medical",
        "PortalName": "healthdata.gov",
        "AccessURL": f"https://example.gov/datasets/{assigned_id}",
        "Extent": "[-77.1,38.8,-76.9,39.0]",
        "TopicCategories": "/Categories/Health",
    }
    row.update(overrides)
    return row


def zebra_row(i: int):
    return {
        "AssignedID": f"z{i}",
        "Title": f"Zebra Dataset {i}",
        "LayerList": "[]",
        "Summary": "zebra stripes",
        "Description": "zebra habitat",
        "Tags": "zebra",
        "PortalName": "example.gov",
        "AccessURL": f"https://example.gov/datasets/z{i}",
        "Extent": "",
        "TopicCategories": "",
    }


class FakeMCPClient:
    server_url = "https://example.invalid/mcp"

    def __init__(self, rows, detail_rows=None, fail_detail=False):
        self.rows = rows
        self.detail_rows = detail_rows if detail_rows is not None else rows
        self.fail_detail = fail_detail
        self.catalog_calls: list[tuple] = []
        self.detail_calls: list[list[str]] = []

    async def get_metadata_fields(self, default_search_only=False):
        return {
            "always_search_fields": [
                "AssignedID", "Title", "LayerList", "Summary",
                "Description", "Tags",
            ],
            "fields": [
                {"fieldName": n} for n in (
                    "AssignedID", "Title", "LayerList", "Summary",
                    "Description", "Tags", "PortalName", "AccessURL",
                    "Extent", "TopicCategories")
            ],
        }

    async def get_metadata_field_definitions(self, fields=None):
        return {"fields": []}

    async def get_metadata_catalog(self, fields=None, offset=0, limit=100):
        self.catalog_calls.append((fields, offset, limit))
        page = self.rows[offset:offset + limit]
        has_more = offset + len(page) < len(self.rows)
        return {
            "total_records": len(self.rows),
            "offset": offset,
            "returned_records": len(page),
            "has_more": has_more,
            "next_offset": offset + len(page) if has_more else None,
            "rows": page,
        }

    async def get_layer_metadata(self, layer_ids, fields=None):
        self.detail_calls.append(list(layer_ids))
        if self.fail_detail:
            raise MCPToolError("boom")
        by_id = {str(r.get("AssignedID")): r for r in self.detail_rows}
        return {"rows": [by_id[i] for i in layer_ids if i in by_id]}


class FakeModelClient:
    def __init__(self, plan=None, scorer=None):
        self.plan = plan if plan is not None else dict(HEALTH_PLAN)
        self.scorer = scorer
        self.calls: list[str] = []

    def ensure_configured(self):
        return None

    async def generate_json(self, *, system_prompt, user_prompt, schema_name,
                            json_schema, use_reasoning=False,
                            max_completion_tokens=4096):
        import json as _json

        self.calls.append(schema_name)
        if schema_name == "search_plan":
            return dict(self.plan)
        payload = _json.loads(user_prompt)
        evaluations = []
        for i, candidate in enumerate(payload["candidate_datasets"]):
            score = self.scorer(candidate, i) if self.scorer else 90 - (i % 10)
            evaluations.append({
                "AssignedID": candidate["AssignedID"],
                "relevance_score": score,
                "relevance_reason": f"Grounded in {candidate['Title']}",
                "proposed_role": "direct match: primary health layer",
                "limitations": [],
            })
        return {"evaluations": evaluations}


def health_request() -> DiscoveryRequest:
    return DiscoveryRequest(question="Find healthcare related data")


def test_timings_reported_for_every_stage():
    async def run():
        mcp = FakeMCPClient([health_row("1", "Community Health Survey")])
        agent = DiscoveryAgent(mcp, FakeModelClient())
        return await agent.search(health_request())

    import asyncio

    result = asyncio.run(run())
    assert result.timings_ms is not None
    assert TIMING_KEYS <= set(result.timings_ms)
    assert result.timings_ms["catalog_pages"] == 1.0
    assert result.timings_ms["rank_batches"] == 1.0
    assert result.timings_ms["total_ms"] >= 0
    assert result.candidate_count == 1


def test_large_candidate_set_returns_all_genuinely_relevant():
    import asyncio

    async def run():
        health = [health_row(str(i), f"Community Health Survey {i}") for i in range(60)]
        rows = health + [zebra_row(i) for i in range(740)]
        mcp = FakeMCPClient(rows)
        model = FakeModelClient(
            scorer=lambda c, i: 85 if "Health" in (c["Title"] or "") else 10
        )
        agent = DiscoveryAgent(mcp, model)
        return agent, mcp, await agent.search(health_request())

    agent, mcp, result = asyncio.run(run())
    # 800 catalog records examined across 8 pages of 100.
    assert result.catalog_examined == 800
    assert result.timings_ms["catalog_pages"] == 8.0
    # Only the 60 health records qualify as candidates; zebra filler is out.
    assert result.candidate_count == 60
    # No arbitrary global cap: all 60 genuinely relevant results return.
    assert len(result.recommendations) == 60
    assert len(result.recommendations) > 5
    # Bounded batching: 60 candidates at batch size 10 -> 6 rank calls.
    rank_calls = [c for c in agent.model.calls if c == "candidate_ranking"]
    assert len(rank_calls) == 6
    # Detail lookups chunked to the server limit, never one giant call.
    assert mcp.detail_calls
    assert all(len(chunk) <= ENRICH_BATCH_SIZE for chunk in mcp.detail_calls)
    assert sum(len(chunk) for chunk in mcp.detail_calls) == 60
    # Every recommendation keeps its valid AccessURL.
    assert all(
        r.access_url == f"https://example.gov/datasets/{r.AssignedID}"
        for r in result.recommendations
    )


def test_weak_single_mention_records_never_become_candidates():
    import asyncio

    rows = [
        {
            "AssignedID": "w1",
            "Title": "Zebra Dataset",
            "Summary": "zebra stripes",
            # A single incidental body mention of health (score 1 < gate).
            "Description": "zebra habitat with a health note",
            "Tags": "zebra",
            "PortalName": "example.gov",
            "AccessURL": "https://example.gov/datasets/w1",
        },
        health_row("1", "Community Health Survey"),
    ]
    mcp = FakeMCPClient(rows)
    agent = DiscoveryAgent(mcp, FakeModelClient())
    result = asyncio.run(agent.search(health_request()))
    assert result.candidate_count == 1
    assert [r.AssignedID for r in result.recommendations] == ["1"]


def test_model_scores_below_threshold_are_excluded():
    import asyncio

    rows = [health_row(str(i), f"Community Health Survey {i}") for i in range(3)]
    mcp = FakeMCPClient(rows)
    model = FakeModelClient(scorer=lambda c, i: 25)
    agent = DiscoveryAgent(mcp, model)
    result = asyncio.run(agent.search(health_request()))
    assert result.candidate_count == 3
    assert result.recommendations == []


def test_scan_always_requests_access_url():
    import asyncio

    mcp = FakeMCPClient([health_row("1", "Community Health Survey")])
    agent = DiscoveryAgent(mcp, FakeModelClient())
    asyncio.run(agent.search(health_request()))
    assert mcp.catalog_calls
    for fields, _offset, _limit in mcp.catalog_calls:
        assert fields is not None
        assert "AccessURL" in fields


def test_enrich_failure_falls_back_to_scan_access_url():
    import asyncio

    mcp = FakeMCPClient(
        [health_row("1", "Community Health Survey")], fail_detail=True
    )
    agent = DiscoveryAgent(mcp, FakeModelClient())
    result = asyncio.run(agent.search(health_request()))
    assert len(result.recommendations) == 1
    assert result.recommendations[0].access_url == "https://example.gov/datasets/1"
    assert any("catalog records" in w for w in result.warnings)


def test_access_url_field_name_variants_preserved():
    import asyncio

    row = health_row("9", "Community Health Survey")
    del row["AccessURL"]
    row["access_url"] = "https://example.gov/datasets/9"
    mcp = FakeMCPClient([row])
    agent = DiscoveryAgent(mcp, FakeModelClient())
    result = asyncio.run(agent.search(health_request()))
    assert result.recommendations[0].access_url == "https://example.gov/datasets/9"
    assert record_access_url({"accessUrl": "https://example.gov/x"}) == "https://example.gov/x"


def test_catalog_cache_avoids_rescan():
    import asyncio

    async def run():
        mcp = FakeMCPClient([health_row("1", "Community Health Survey")])
        agent = DiscoveryAgent(mcp, FakeModelClient())
        first = await agent.search(health_request())
        calls_after_first = len(mcp.catalog_calls)
        second = await agent.search(health_request())
        return mcp, calls_after_first, first, second

    mcp, calls_after_first, first, second = asyncio.run(run())
    assert calls_after_first == 1
    assert len(mcp.catalog_calls) == 1  # cache hit: no new catalog calls
    assert [r.AssignedID for r in second.recommendations] == [
        r.AssignedID for r in first.recommendations
    ]


def test_discovery_and_recipe_use_same_access_url():
    import asyncio

    row = health_row("42", "Community Health Survey")

    async def run():
        discovery_mcp = FakeMCPClient([row])
        discovery = await DiscoveryAgent(
            discovery_mcp, FakeModelClient()
        ).search(health_request())

        class RecipeMCP:
            server_url = "https://example.invalid/mcp"

            async def get_layer_metadata(self, layer_ids, fields=None):
                return {"rows": [row]}

        class RecipeModel:
            def ensure_configured(self):
                return None

            async def generate_json(self, **kwargs):
                return {
                    "analytical_objective": "obj",
                    "dataset_roles": [{
                        "AssignedID": "42", "role": "input dataset",
                        "role_explanation": "x", "limitations": [],
                    }],
                    "relationships": [],
                    "workflow_steps": [{
                        "step_id": "s1", "order": 1, "operation": "load",
                        "title": "Load", "explanation": "x",
                        "input_dataset_ids": ["42"], "input_step_ids": [],
                        "proposed_output": "loaded",
                    }],
                    "expected_outputs": [],
                    "data_gaps": [],
                    "assumptions": [],
                    "limitations": [],
                    "uncertainties": [],
                }

        recipe = await RecipeAgent(RecipeMCP(), RecipeModel()).generate(
            RecipeRequest(
                question="Find healthcare related data",
                selected_assigned_ids=["42"],
            )
        )
        return discovery, recipe

    discovery, recipe = asyncio.run(run())
    assert discovery.recommendations[0].access_url == "https://example.gov/datasets/42"
    assert recipe.selected_datasets[0].access_url == "https://example.gov/datasets/42"


def test_pagination_reports_pages_and_complete_coverage():
    import asyncio

    rows = [zebra_row(i) for i in range(249)]
    rows.append(health_row("match", "Community Health Survey"))
    mcp = FakeMCPClient(rows)
    agent = DiscoveryAgent(mcp, FakeModelClient())
    result = asyncio.run(agent.search(health_request()))
    assert [c for c in mcp.catalog_calls] is not None
    assert len(mcp.catalog_calls) == 3  # 250 rows at page size 100
    assert result.timings_ms["catalog_pages"] == 3.0
    assert result.completeness == "complete"
    assert [r.AssignedID for r in result.recommendations] == ["match"]


def test_geography_only_records_are_not_candidates():
    import asyncio

    geo_only = {
        "AssignedID": "geo1",
        "Title": "DC Public Libraries",
        "LayerList": "[]",
        "Summary": "Library branches",
        "Description": "Public library branches in Washington DC.",
        "Tags": "washington dc, libraries",
        "PortalName": "example.gov",
        "AccessURL": "https://example.gov/datasets/geo1",
        "Extent": "",
        "TopicCategories": "",
    }
    rows = [geo_only, health_row("1", "Community Health Survey")]
    mcp = FakeMCPClient(rows)
    agent = DiscoveryAgent(mcp, FakeModelClient())
    request = DiscoveryRequest(
        question="Find healthcare related data", location="Washington, DC"
    )
    result = asyncio.run(agent.search(request))
    # The libraries record matches only geography; it must not qualify.
    assert result.candidate_count == 1
    assert [r.AssignedID for r in result.recommendations] == ["1"]


def test_broad_request_suggests_narrower_categories():
    import asyncio

    rows = [health_row(str(i), f"Community Health Survey {i}") for i in range(60)]
    mcp = FakeMCPClient(rows)
    # Model rates almost everything weak: only AssignedID "0" passes.
    # (Score by ID, not batch position: each rank batch restarts at 0.)
    model = FakeModelClient(
        scorer=lambda c, i: 85 if c["AssignedID"] == "0" else 10
    )
    agent = DiscoveryAgent(mcp, model)
    result = asyncio.run(agent.search(health_request()))
    assert result.candidate_count == 60
    assert len(result.recommendations) == 1
    assert any("narrowing" in w for w in result.warnings)
