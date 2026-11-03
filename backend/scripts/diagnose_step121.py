"""Step 12.1 diagnostic: verbose vs concise ranking output (input fixed).

Input contract (both arms): ALL 1,660 catalog records with ALL six MCP
fields (AssignedID, Title, LayerList, Summary, Description, Tags) loaded
from ``backend/mcp_response.json`` -- no removal, truncation, summary,
keyword filtering, embedding prefilter, or exclusion. Only the RESPONSE
schema varies:

- verbose: the current ``RankingResult`` (relevance_reason +
  proposed_role + limitations per relevant record);
- concise: diagnostic-only ``AssignedID + relevance_score`` per relevant
  record (no reason/role/limitations text).

No two-stage reasoning is introduced: each arm is a single ranking call
over the complete catalog. The MCP server, frontend, Recipe Agent, and
Assistant contracts are untouched.

Default is a dry run: zero model calls, zero quota -- reports input
sizes, schema sizes, and predicted output-token savings from the real
catalog bytes. ``--live`` makes exactly 2 model calls (verbose, then
concise) with the Step 12 traffic-safety question and reports per-call
walls, provider tokens, finish reasons, attempts, and validation time.

    python scripts/diagnose_step121.py [--out FILE.json]
    python scripts/diagnose_step121.py --live [--out FILE.json]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from pydantic import BaseModel, Field

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

TRAFFIC_QUESTION = (
    "I am looking for traffic safety data near DC schools. "
    "Please find related data for this analysis."
)
TRAFFIC_LOCATION = "Washington, DC"

# The six MCP metadata fields under test -- fixed for both arms.
SIX_FIELDS = (
    "AssignedID", "Title", "LayerList", "Summary", "Description", "Tags"
)


class ConciseEvaluation(BaseModel):
    """Diagnostic-only concise ranking output (Step 12.1 experiment)."""

    AssignedID: str
    relevance_score: float = Field(ge=0, le=100)


class ConciseRankingResult(BaseModel):
    """One minimal evaluation per relevant record; no reason/role text."""

    evaluations: list[ConciseEvaluation] = Field(default_factory=list)


def load_catalog(path: Path) -> list[dict]:
    """Load every catalog row from the saved MCP inspection pages."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows: list[dict] = []
    for page in payload.get("pages", []):
        rows.extend(page.get("response", {}).get("rows", []))
    return rows


def check_input_contract(rows: list[dict]) -> dict:
    """Verify the fixed input: 1,660 records, unique IDs, six fields."""
    ids = [str(r.get("AssignedID")) for r in rows if r.get("AssignedID")]
    field_sets = [set(r.keys()) for r in rows if isinstance(r, dict)]
    return {
        "records": len(rows),
        "unique_assigned_ids": len(set(ids)),
        "all_have_six_fields": all(
            set(SIX_FIELDS) <= keys for keys in field_sets
        ),
    }


def build_input_payload(rows: list[dict]) -> tuple[str, dict]:
    """Serialize the shared ranking input (full six fields, untruncated)."""
    from app.agents.discovery_agent import FULL_CATALOG_SYSTEM_PROMPT

    catalog = [
        {key: r.get(key) for key in SIX_FIELDS} for r in rows
    ]
    payload = {
        "question": TRAFFIC_QUESTION,
        "location": TRAFFIC_LOCATION,
        "interpreted_intent": "traffic safety data near DC schools",
        "relevance_bar": 40,
        "record_count": len(catalog),
        "catalog_datasets": catalog,
    }
    text = json.dumps(payload, ensure_ascii=False)
    return FULL_CATALOG_SYSTEM_PROMPT + "\n" + text, payload


def estimate_tokens(chars: int) -> int:
    return max(1, chars // 4)


def predict_output_savings(relevant_counts: list[int]) -> list[dict]:
    """Predict output tokens: verbose (~100 tok/record) vs concise (~10)."""
    rows = []
    for count in relevant_counts:
        verbose = count * 100
        concise = count * 10
        rows.append({
            "relevant_records": count,
            "verbose_output_est_tokens": verbose,
            "concise_output_est_tokens": concise,
            "saved_est_tokens": verbose - concise,
        })
    return rows


def dry_run(rows: list[dict]) -> dict:
    """Zero-model-call report from the real catalog bytes."""
    from app.agents.discovery_agent import FULL_CATALOG_SYSTEM_PROMPT
    from app.models.discovery import RankingResult
    from app.services.model_client import to_strict_json_schema

    contract = check_input_contract(rows)
    system_prompt, payload = build_input_payload(rows)
    input_chars = len(system_prompt)
    verbose_schema = to_strict_json_schema(RankingResult.model_json_schema())
    concise_schema = to_strict_json_schema(
        ConciseRankingResult.model_json_schema()
    )
    report = {
        "mode": "dry_run",
        "live_model_calls": 0,
        "question": TRAFFIC_QUESTION,
        "input_contract": contract,
        "six_fields": list(SIX_FIELDS),
        "input_chars": input_chars,
        "input_est_tokens": estimate_tokens(input_chars),
        "input_mb": round(
            len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
            / (1024 * 1024), 3,
        ),
        "system_prompt_chars": len(FULL_CATALOG_SYSTEM_PROMPT),
        "verbose_schema_chars": len(json.dumps(verbose_schema)),
        "concise_schema_chars": len(json.dumps(concise_schema)),
        "output_scenarios": predict_output_savings([10, 30, 60, 100]),
        "note": (
            "Input is identical for both arms; only the response schema "
            "varies. Live --live run measures whether the smaller concise "
            "output reduces ranking wall time."
        ),
    }
    return report


async def live_run(rows: list[dict]) -> dict:
    """Exactly 2 live model calls: verbose arm, then concise arm."""
    from app.agents.discovery_agent import FULL_CATALOG_SYSTEM_PROMPT
    from app.models.discovery import RankingResult
    from app.services.model_client import MetaModelClient

    system_prompt, payload = build_input_payload(rows)
    user_prompt = system_prompt[len(FULL_CATALOG_SYSTEM_PROMPT) + 1:]
    concise_system = (
        FULL_CATALOG_SYSTEM_PROMPT
        + " Return ONLY AssignedID and relevance_score per relevant record."
    )
    client = MetaModelClient()
    client.ensure_configured()
    from app.config import get_settings

    budget = get_settings().discovery_rank_max_completion_tokens
    model_name = client.model_for(use_reasoning=False)
    arms = []
    for arm, schema_cls, sys_prompt in (
        ("verbose", RankingResult, FULL_CATALOG_SYSTEM_PROMPT),
        ("concise", ConciseRankingResult, concise_system),
    ):
        calls_before = len(client.call_history)
        wall_started = time.perf_counter()
        raw = await client.generate_json(
            system_prompt=sys_prompt,
            user_prompt=user_prompt,
            schema_name=f"step121_{arm}",
            json_schema=schema_cls.model_json_schema(),
            max_completion_tokens=budget,
        )
        wall_ms = (time.perf_counter() - wall_started) * 1000
        validate_started = time.perf_counter()
        parsed = schema_cls.model_validate(raw)
        validate_ms = (time.perf_counter() - validate_started) * 1000
        attempts = client.call_history[calls_before:]
        last = attempts[-1] if attempts else {}
        arms.append({
            "arm": arm,
            "model": model_name,
            "max_completion_tokens": budget,
            "input_chars": len(user_prompt),
            "input_est_tokens": estimate_tokens(len(user_prompt)),
            "attempts": len(attempts),
            "wall_ms": round(wall_ms, 1),
            "finish_reason": last.get("finish_reason"),
            "prompt_tokens": last.get("prompt_tokens"),
            "completion_tokens": last.get("completion_tokens"),
            "reasoning_tokens": last.get("reasoning_tokens"),
            "parse_ms": last.get("parse_ms"),
            "validate_ms": round(validate_ms, 1),
            "evaluations": len(parsed.evaluations),
            "errors": [a.get("error") for a in attempts if a.get("error")],
        })
    return {
        "mode": "live",
        "live_model_calls": 2,
        "question": TRAFFIC_QUESTION,
        "input_contract": check_input_contract(rows),
        "arms": arms,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true",
                        help="make exactly 2 live model calls")
    parser.add_argument("--catalog", default="mcp_response.json",
                        help="saved MCP catalog pages (default: %(default)s)")
    parser.add_argument("--out", default="diagnose_step121_report.json")
    args = parser.parse_args()

    catalog_path = Path(args.catalog)
    if not catalog_path.is_absolute():
        catalog_path = BACKEND_DIR / catalog_path.name
    rows = load_catalog(catalog_path)
    if args.live:
        import asyncio

        report = asyncio.run(live_run(rows))
    else:
        report = dry_run(rows)
    out = Path(args.out)
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"\nWrote {len(json.dumps(report))} chars to {out}")
    if not args.live:
        print("Dry run: 0 live model calls (quota-safe). "
              "Add --live for the 2-call experiment.")


if __name__ == "__main__":
    main()
