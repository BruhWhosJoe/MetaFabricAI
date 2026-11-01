"""Live MCP connection test for the Azure Metadata MCP Server.

Connects over HTTPS, discovers all available tools, prints their actual
input schemas, calls ``get_metadata_fields``, and retrieves a small
``get_metadata_catalog`` sample. Catalog arguments are built from the
tool's discovered input schema (``limit``/``offset`` when present), never
invented.

Run from the ``backend/`` folder (with the project virtual environment
active):

    python scripts/test_mcp_connection.py

Exit code is 0 on success and 1 on any connection/tool failure.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

# Allow running as a plain script from the backend/ folder.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from app.services.mcp_client import (  # noqa: E402
    MCPClientError,
    MetaFabricMCPClient,
    normalize_tool,
    normalize_tool_result,
)

CATALOG_SAMPLE_LIMIT = 5


def _print_json(label: str, value: Any, max_chars: int = 4000) -> None:
    text = json.dumps(value, indent=2, ensure_ascii=False, default=str)
    if len(text) > max_chars:
        text = text[:max_chars] + "\n... (truncated)"
    print(f"\n{label}\n{text}")


def _catalog_arguments(tool: dict[str, Any]) -> dict[str, Any]:
    """Build a small catalog request from the actual input schema."""
    properties = (tool.get("input_schema") or {}).get("properties") or {}
    arguments: dict[str, Any] = {}
    if "limit" in properties:
        arguments["limit"] = CATALOG_SAMPLE_LIMIT
    if "offset" in properties:
        arguments["offset"] = 0
    return arguments


async def main() -> int:
    settings = get_settings()
    client = MetaFabricMCPClient()
    print("MetaFabricAI - Azure MCP connection test")
    print(f"MCP server: {settings.mcp_server_url}")
    print(f"Timeout (seconds): {settings.mcp_timeout_seconds}")

    try:
        async with client.connect() as session:
            raw_tools = await session.list_tools()
            tools = [normalize_tool(tool) for tool in raw_tools]

            print(f"\nDiscovered {len(tools)} tool(s):")
            for tool in tools:
                print(f"\n=== {tool['name']} ===")
                if tool.get("description"):
                    print(tool["description"].strip().splitlines()[0])
                _print_json("Input schema:", tool["input_schema"])

            fields_result = normalize_tool_result(
                await session.call_tool("get_metadata_fields", {})
            )
            _print_json("get_metadata_fields() result:", fields_result)

            catalog_tool = next(
                (t for t in tools if t["name"] == "get_metadata_catalog"), None
            )
            if catalog_tool is None:
                print("\nget_metadata_catalog is not available on this server.")
                return 1

            arguments = _catalog_arguments(catalog_tool)
            print(f"\nCalling get_metadata_catalog with {arguments} ...")
            catalog_result = normalize_tool_result(
                await session.call_tool("get_metadata_catalog", arguments)
            )
            if isinstance(catalog_result, dict):
                summary = {
                    key: catalog_result.get(key)
                    for key in (
                        "total_records",
                        "offset",
                        "requested_limit",
                        "returned_records",
                        "has_more",
                        "next_offset",
                        "records_remaining",
                        "selected_fields",
                    )
                    if key in catalog_result
                }
                _print_json("Catalog pagination summary:", summary)
                rows = catalog_result.get("rows") or []
                sample = [
                    {
                        "AssignedID": row.get("AssignedID"),
                        "Title": row.get("Title"),
                    }
                    for row in rows[:CATALOG_SAMPLE_LIMIT]
                    if isinstance(row, dict)
                ]
                _print_json("Catalog sample (AssignedID / Title):", sample)
            else:
                _print_json("get_metadata_catalog() result:", catalog_result)

    except MCPClientError as exc:
        print(f"\nMCP ERROR: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # network, TLS, protocol, timeout, ...
        print(f"\nCONNECTION ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print("\nLive MCP connection test succeeded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
