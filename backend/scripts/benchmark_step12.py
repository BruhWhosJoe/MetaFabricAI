"""Step 12 benchmark: full-catalog Architecture A vs B (mock + live).

Mock mode (default) builds a synthetic catalog (default 1,660 records,
the live catalog size) and a simulated Muse client whose latency scales
with input size, so sequential vs parallel vs single-call batching can
be compared without network access or an API key:

    python scripts/benchmark_step12.py [--records 1660] [--out FILE.json]

Live mode hits the real MCP catalog and Meta Model API (needs
``backend/.env`` with a valid MODEL_API_KEY):

    python scripts/benchmark_step12.py --live

Live mode measures, per query and per architecture: MCP retrieval time,
cache init/refresh time, metadata serialization time, actual model
input token usage (provider-reported when available), model
reasoning/generation time, validation time, and total request time.
The primary benchmark query is the Step 12 traffic-safety question;
flooding, crime, housing, and population queries round out the set.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.agents.discovery_agent import DiscoveryAgent, clear_discovery_cache  # noqa: E402
from app.models.discovery import DiscoveryRequest  # noqa: E402

QUERIES = [
    ("traffic", "I am looking for traffic safety data near DC schools. "
                 "Please find related data for this analysis."),
    ("flooding", "Which neighborhoods in Washington, DC are vulnerable "
                  "to flooding? Find flood hazard and elderly population data."),
    ("crime", "Find crime incident data for Washington, DC neighborhoods."),
    ("housing", "Find affordable housing and property data for Washington, DC."),
    ("population", "Find population and demographic data by neighborhood "
                    "for Washington, DC."),
]

TOPICS = ["traffic", "flood", "crime", "housing", "population",
          "school", "safety", "health", "transport", "environment"]


def synthetic_catalog(n: int) -> list[dict]:
    rows = []
    for i in range(n):
        topic = TOPICS[i % len(TOPICS)]
        rows.append({
            "AssignedID": str(1000 + i),
            "Title": f"{topic.title()} Dataset {i} Washington DC",
            "LayerList": "[]",
            "Summary": f"Summary of {topic} dataset {i}.",
            "Description": (
                f"Description for {topic} dataset {i} covering Washington "
                f"DC with metadata field {i % 37} and topical detail."),
            "Tags": f"{topic}, washington dc",
            "PortalName": "opendata.dc.gov",
            "AccessURL": f"https://example.gov/datasets/{1000 + i}",
            "Extent": "[-77.1,38.8,-76.9,39.0]",
            "TopicCategories": f"/Categories/{topic.title()}",
        })
    return rows


class SimulatedMCPClient:
    """Paginated mock catalog with a realistic per-page latency."""

    server_url = "mock://step12-benchmark"
    page_latency_s = 0.005

    def __init__(self, rows: list[dict]):
        self.rows = rows

    async def get_metadata_fields(self, default_search_only=False):
        return {
            "always_search_fields": ["AssignedID", "Title"],
            "fields": [{"fieldName": n} for n in (
                "AssignedID", "Title", "LayerList", "Summary", "Description",
                "Tags", "PortalName", "AccessURL", "Extent",
                "TopicCategories")],
        }

    async def get_metadata_field_definitions(self, fields=None):
        return {"fields": []}

    async def get_metadata_catalog(self, fields=None, offset=0, limit=100):
        await asyncio.sleep(self.page_latency_s)
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
        await asyncio.sleep(0.002)
        by_id = {r["AssignedID"]: r for r in self.rows}
        return {"rows": [by_id[i] for i in layer_ids if i in by_id]}


class SimulatedModelClient:
    """Model double with size-proportional latency (reasoning emulation).

    Per-call latency = base + per_record * batch_records, emulating a
    reasoning model that reads every record. Usage counters accumulate
    like the real client.
    """

    def __init__(self, base_s=0.05, per_record_s=0.002, relevant_every=37):
        self.base_s = base_s
        self.per_record_s = per_record_s
        self.relevant_every = relevant_every
        self.calls: list[str] = []
        self.usage_totals = {"prompt_tokens": 0.0, "completion_tokens": 0.0,
                             "total_tokens": 0.0, "reasoning_tokens": 0.0}

    def ensure_configured(self):
        return None

    async def generate_json(self, *, system_prompt, user_prompt, schema_name,
                            json_schema, use_reasoning=False,
                            max_completion_tokens=4096):
        self.calls.append(schema_name)
        payload = json.loads(user_prompt)
        if schema_name == "search_plan":
            await asyncio.sleep(0.02)
            self._charge(300, 200)
            return {"subject": "benchmark", "summary": "benchmark query",
                    "geographic_area": "Washington, DC",
                    "categories": ["benchmark"],
                    "keywords": ["benchmark", "washington", "dc"],
                    "dataset_roles": [], "geographic_requirements": [],
                    "demographic_requirements": [], "additional_fields": [],
                    "ambiguities": []}
        records = payload.get("catalog_datasets")
        if records is None and "candidate_datasets" in payload:
            records = payload["candidate_datasets"]
        if records is not None:
            await asyncio.sleep(
                self.base_s + self.per_record_s * len(records))
            self._charge(len(user_prompt) // 4, 60 * max(1, len(records) // 50))
            return {"evaluations": [
                {"AssignedID": r["AssignedID"], "relevance_score": 85,
                 "relevance_reason": f"Grounded in {r.get('Title')}",
                 "proposed_role": "direct match", "limitations": []}
                for r in records
                if (int(r["AssignedID"]) % self.relevant_every == 0)
            ]}
        if schema_name == "full_catalog_final_ranking":
            candidates = payload["batch_candidates"]
            await asyncio.sleep(
                self.base_s + self.per_record_s * len(candidates))
            self._charge(len(user_prompt) // 4, 60 * len(candidates))
            return {"evaluations": [
                {"AssignedID": c["AssignedID"],
                 "relevance_score": c["batch_score"],
                 "relevance_reason": c["batch_reason"],
                 "proposed_role": c["batch_role"], "limitations": []}
                for c in candidates
            ]}
        raise AssertionError(schema_name)

    def _charge(self, prompt_tokens, completion_tokens):
        self.usage_totals["prompt_tokens"] += prompt_tokens
        self.usage_totals["completion_tokens"] += completion_tokens
        self.usage_totals["total_tokens"] += prompt_tokens + completion_tokens
        self.usage_totals["reasoning_tokens"] += completion_tokens // 2


def summarize(name, result) -> dict:
    t = result.timings_ms or {}
    return {
        "query": name,
        "recommended": len(result.recommendations),
        "examined": result.catalog_examined,
        "candidates": result.candidate_count,
        "total_ms": t.get("total_ms"),
        "mcp_fields_ms": t.get("mcp_fields_ms"),
        "plan_model_ms": t.get("plan_model_ms"),
        "catalog_scan_ms": t.get("catalog_scan_ms"),
        "catalog_cache_hit": t.get("catalog_cache_hit"),
        "serialize_ms": t.get("serialize_ms"),
        "rank_model_ms": t.get("rank_model_ms"),
        "rank_batches": t.get("rank_batches"),
        "final_rank_model_ms": t.get("final_rank_model_ms"),
        "enrich_ms": t.get("enrich_ms"),
        "validation_ms": t.get("validation_ms"),
        "model_calls": t.get("model_calls"),
        "model_input_est_tokens": t.get("model_input_est_tokens"),
        "model_prompt_tokens": t.get("model_prompt_tokens"),
        "model_completion_tokens": t.get("model_completion_tokens"),
    }


async def run_case(agent, query_name, question, warm_mcp) -> dict:
    request = DiscoveryRequest(question=question, location="Washington, DC")
    started = time.perf_counter()
    result = await agent.search(request)
    wall_ms = (time.perf_counter() - started) * 1000
    row = summarize(query_name, result)
    row["wall_ms"] = round(wall_ms, 1)
    return row


async def main_async(args) -> list[dict]:
    rows_data = []
    if args.live:
        from app.services.mcp_client import MetaFabricMCPClient
        from app.services.model_client import MetaModelClient
        mcp_factory = lambda: MetaFabricMCPClient()  # noqa: E731
        model_factory = lambda: MetaModelClient()  # noqa: E731
        print("LIVE mode: real MCP catalog + Meta Model API.")
    else:
        catalog = synthetic_catalog(args.records)
        print(f"MOCK mode: synthetic catalog of {len(catalog)} records.")
        mcp_factory = lambda: SimulatedMCPClient(catalog)  # noqa: E731
        model_factory = lambda: SimulatedModelClient()  # noqa: E731

    modes = [
        ("full_single", {"mode": "full_single"}),
        ("full_parallel_c4", {"mode": "full_parallel",
                              "full_catalog_batch_size": 750,
                              "full_catalog_concurrency": 4}),
        ("full_parallel_c1_sequential", {"mode": "full_parallel",
                                         "full_catalog_batch_size": 750,
                                         "full_catalog_concurrency": 1}),
        ("legacy", {"mode": "legacy"}),
    ]
    all_rows = []
    for mode_name, kwargs in modes:
        for cache_state in ("cold", "warm"):
            clear_discovery_cache()
            agent = DiscoveryAgent(mcp_factory(), model_factory(), **kwargs)
            # Warm the cache first when measuring the warm state.
            if cache_state == "warm":
                await agent.search(DiscoveryRequest(question=QUERIES[0][1]))
            for query_name, question in QUERIES:
                row = await run_case(agent, query_name, question, None)
                row.update({"mode": mode_name, "cache": cache_state})
                all_rows.append(row)
                print(f"{mode_name:28s} {cache_state:4s} {query_name:9s} "
                      f"total={row['total_ms']:>9.1f}ms "
                      f"scan={row['catalog_scan_ms']:>8.1f}ms "
                      f"rank={row['rank_model_ms']:>9.1f}ms "
                      f"batches={row['rank_batches']:>4.0f} "
                      f"recs={row['recommended']:>3d}")
    return all_rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", type=int, default=1660)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--out", default="step12-benchmark.json")
    args = parser.parse_args()
    all_rows = asyncio.run(main_async(args))
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(all_rows, fh, indent=2)
    print(f"\nWrote {len(all_rows)} measurements to {args.out}")
    # Architecture comparison on the primary query, warm cache.
    print("\nPrimary query (traffic, warm cache):")
    for row in all_rows:
        if row["query"] == "traffic" and row["cache"] == "warm":
            print(f"  {row['mode']:28s} total={row['total_ms']:.1f}ms "
                  f"rank={row['rank_model_ms']:.1f}ms "
                  f"calls={row['model_calls']:.0f} "
                  f"in_est={row['model_input_est_tokens']:.0f} "
                  f"recs={row['recommended']}")


if __name__ == "__main__":
    main()
