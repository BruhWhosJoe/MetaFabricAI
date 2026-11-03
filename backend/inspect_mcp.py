
"""
MetaFabricAI - MCP Metadata Catalog Inspector
=============================================

Purpose:
    Inspect the exact metadata returned by the Azure MCP server's
    get_metadata_catalog tool, independently of the Muse AI model.

Supported commands:
    python inspect_mcp.py
    python inspect_mcp.py --limit 2
    python inspect_mcp.py --limit 500
    python inspect_mcp.py --limit 500 --all
    python inspect_mcp.py --limit 500 --all --offset 0

Outputs:
    mcp_response.json
    mcp_inspection_summary.json

Notes:
    - Read-only: does not modify the MCP catalog.
    - Does not invoke Muse or consume Muse model tokens.
    - Uses the existing FastMCP client.
    - Preserves complete MCP responses for inspection.
"""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

from fastmcp import Client


# ============================================================
# Configuration
# ============================================================

MCP_URL = (
    "https://ca-metadata-mcp-dev."
    "wittyforest-26c063ae.eastus.azurecontainerapps.io/mcp"
)

TOOL_NAME = "get_metadata_catalog"

OUTPUT_DIR = Path(__file__).resolve().parent

RAW_OUTPUT_FILE = "mcp_response.json"
SUMMARY_OUTPUT_FILE = "mcp_inspection_summary.json"


# ============================================================
# Utility functions
# ============================================================

def to_json_compatible(value):
    """
    Convert MCP SDK objects into JSON-compatible Python data.
    """

    if value is None:
        return None

    if isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, dict):
        return {
            str(key): to_json_compatible(item)
            for key, item in value.items()
        }

    if isinstance(value, (list, tuple)):
        return [
            to_json_compatible(item)
            for item in value
        ]

    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")

    if hasattr(value, "dict"):
        return value.dict()

    return str(value)


def parse_tool_result(result):
    """
    Extract the actual MCP tool response.

    Supports:
      - FastMCP CallToolResult.structured_content
      - Older response structures
      - MCP text content blocks
      - JSON-encoded response strings
    """

    if getattr(result, "is_error", False):
        error_content = getattr(result, "content", None)
        raise RuntimeError(
            f"MCP tool returned an error: {error_content}"
        )

    structured = getattr(
        result,
        "structured_content",
        None,
    )

    if structured is not None:
        return to_json_compatible(structured)

    content = getattr(result, "content", None)

    if content is None:
        return to_json_compatible(result)

    parsed_items = []

    for item in content:

        item_text = getattr(item, "text", None)

        if item_text is not None:
            try:
                parsed_items.append(
                    json.loads(item_text)
                )
            except json.JSONDecodeError:
                parsed_items.append(item_text)

        else:
            parsed_items.append(
                to_json_compatible(item)
            )

    if len(parsed_items) == 1:
        return parsed_items[0]

    return parsed_items


def extract_records(response):
    """
    Extract metadata records from the actual MCP response.

    The current Metadata MCP server returns its records
    under the 'rows' key.

    Additional wrappers are supported for compatibility.
    """

    if isinstance(response, str):

        try:
            response = json.loads(response)
        except json.JSONDecodeError:
            return []

    if isinstance(response, list):

        # Direct list of metadata records.
        if response and all(
            isinstance(item, dict)
            and "AssignedID" in item
            for item in response
        ):
            return response

        # Nested response list.
        for item in response:
            records = extract_records(item)

            if records:
                return records

        return []

    if isinstance(response, dict):

        # Actual MCP server format.
        rows = response.get("rows")

        if isinstance(rows, list):
            return rows

        # Handle nested wrappers.
        wrapper_keys = (
            "result",
            "structuredContent",
            "structured_content",
            "data",
            "records",
            "results",
            "items",
            "metadata",
            "content",
        )

        for key in wrapper_keys:

            if key in response:

                records = extract_records(
                    response[key]
                )

                if records:
                    return records

    return []


def find_catalog_info(response):
    """
    Locate the catalog pagination metadata.

    Returns the dictionary containing:
      - total_records
      - returned_records
      - has_more
      - next_offset

    Handles nested MCP wrappers.
    """

    if isinstance(response, str):
        try:
            return find_catalog_info(json.loads(response))
        except json.JSONDecodeError:
            return {}

    if isinstance(response, dict):

        if (
            "has_more" in response
            or "total_records" in response
        ):
            return response

        for key in (
            "result",
            "structuredContent",
            "structured_content",
            "data",
            "content",
        ):

            if key in response:
                info = find_catalog_info(response[key])

                if info:
                    return info

    if isinstance(response, list):

        for item in response:
            info = find_catalog_info(item)

            if info:
                return info

    return {}


def save_json(filename, data):
    """
    Save formatted UTF-8 JSON output.
    """

    output_path = OUTPUT_DIR / filename

    with output_path.open(
        "w",
        encoding="utf-8",
    ) as file:

        json.dump(
            data,
            file,
            indent=2,
            ensure_ascii=False,
            default=str,
        )

    return output_path


def json_size_bytes(data):
    """
    Estimate UTF-8 JSON size without pretty formatting.
    """

    serialized = json.dumps(
        data,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )

    return len(serialized.encode("utf-8"))


def print_response_diagnostics(response):
    """
    Show useful diagnostic information when no rows
    can be extracted.
    """

    print("\nWARNING: No metadata records extracted.")

    print(
        "Response type:",
        type(response).__name__,
    )

    if isinstance(response, dict):

        print(
            "Top-level keys:",
            list(response.keys()),
        )

        rows = response.get("rows")

        if rows is not None:
            print(
                "Rows type:",
                type(rows).__name__,
            )

            if isinstance(rows, list):
                print(
                    "Rows length:",
                    len(rows),
                )

    elif isinstance(response, list):

        print(
            "Top-level list length:",
            len(response),
        )

        if response:
            print(
                "First item type:",
                type(response[0]).__name__,
            )

    print("\nResponse preview:")

    preview = json.dumps(
        response,
        indent=2,
        ensure_ascii=False,
        default=str,
    )

    print(preview[:3000])


# ============================================================
# Main inspection
# ============================================================

async def main():

    parser = argparse.ArgumentParser(
        description=(
            "Inspect the metadata returned by "
            "MetaFabricAI's MCP server."
        )
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=2,
        help="Records requested per page (default: 2).",
    )

    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        help="Starting offset (default: 0).",
    )

    parser.add_argument(
        "--all",
        action="store_true",
        help="Retrieve every page of metadata.",
    )

    args = parser.parse_args()

    if args.limit < 1:
        parser.error("--limit must be at least 1.")

    if args.offset < 0:
        parser.error("--offset cannot be negative.")

    print("=" * 70)
    print("MetaFabricAI - MCP Metadata Catalog Inspector")
    print("=" * 70)

    print(f"MCP Server: {MCP_URL}")
    print(f"Tool: {TOOL_NAME}")
    print(f"Page size: {args.limit}")
    print(f"Starting offset: {args.offset}")
    print(f"Retrieve all pages: {args.all}")

    inspection_start = time.perf_counter()

    # Connect to the MCP server.
    async with Client(MCP_URL) as client:

        print("\n[1] Discovering MCP tools...")

        tools = await client.list_tools()

        catalog_tool = next(
            (
                tool
                for tool in tools
                if tool.name == TOOL_NAME
            ),
            None,
        )

        if catalog_tool is None:

            print(
                f"ERROR: Tool '{TOOL_NAME}' was not found."
            )

            print("\nAvailable MCP tools:")

            for tool in tools:
                print(f"  - {tool.name}")

            return 1

        # New MCP SDK field name.
        schema = getattr(
            catalog_tool,
            "input_schema",
            None,
        )

        print("\nTool input schema:")

        print(
            json.dumps(
                to_json_compatible(schema),
                indent=2,
                ensure_ascii=False,
                default=str,
            )
        )

        print("\n[2] Calling MCP metadata catalog...")

        all_records = []
        raw_pages = []
        page_summaries = []

        visited_offsets = set()

        offset = args.offset
        page_number = 0

        catalog_total = None

        while True:

            if offset in visited_offsets:
                raise RuntimeError(
                    "Pagination loop detected at "
                    f"offset {offset}."
                )

            visited_offsets.add(offset)

            page_number += 1

            request_args = {
                "offset": offset,
                "limit": args.limit,
            }

            print(
                f"\nPage {page_number}: "
                f"offset={offset}, "
                f"limit={args.limit}"
            )

            call_start = time.perf_counter()

            result = await client.call_tool(
                TOOL_NAME,
                request_args,
            )

            response = parse_tool_result(result)

            call_elapsed_ms = (
                time.perf_counter() - call_start
            ) * 1000

            records = extract_records(response)

            catalog_info = find_catalog_info(response)

            returned_records = catalog_info.get(
                "returned_records"
            )

            has_more = catalog_info.get(
                "has_more",
                False,
            )

            next_offset = catalog_info.get(
                "next_offset"
            )

            if catalog_total is None:
                catalog_total = catalog_info.get(
                    "total_records"
                )

            # Preserve the full response.
            raw_pages.append({
                "page_number": page_number,
                "request": request_args,
                "response": response,
            })

            payload_bytes = json_size_bytes(response)

            print(
                "  Records extracted:",
                len(records),
            )

            print(
                "  Server reported records:",
                returned_records,
            )

            print(
                f"  MCP call time: "
                f"{call_elapsed_ms:.2f} ms"
            )

            print(
                f"  Response size: "
                f"{payload_bytes / 1024:.2f} KB"
            )

            print(
                "  Has more:",
                has_more,
            )

            print(
                "  Next offset:",
                next_offset,
            )

            if not records:
                print_response_diagnostics(response)

            # Validate response count.
            if (
                returned_records is not None
                and returned_records != len(records)
            ):
                print(
                    "\nWARNING: The MCP server reports "
                    f"{returned_records} records, but "
                    f"the inspector extracted "
                    f"{len(records)}."
                )

            all_records.extend(records)

            page_summary = {
                "page_number": page_number,
                "offset": offset,
                "requested_limit": args.limit,
                "server_reported_records": returned_records,
                "extracted_records": len(records),
                "has_more": has_more,
                "next_offset": next_offset,
                "elapsed_ms": round(
                    call_elapsed_ms,
                    2,
                ),
                "response_size_bytes": payload_bytes,
                "response_size_kb": round(
                    payload_bytes / 1024,
                    2,
                ),
            }

            page_summaries.append(page_summary)

            # Save checkpoint after every page.
            # This preserves partial results if a later
            # MCP request fails.
            save_json(
                RAW_OUTPUT_FILE,
                {
                    "tool": TOOL_NAME,
                    "catalog_total": catalog_total,
                    "pages": raw_pages,
                },
            )

            if not args.all:
                break

            if not has_more:
                break

            if not records:
                raise RuntimeError(
                    "MCP indicated more pages but "
                    "the response contained no "
                    "extractable metadata rows. "
                    "See diagnostics above."
                )

            if next_offset is None:
                raise RuntimeError(
                    "MCP indicated more pages but "
                    "did not provide next_offset."
                )

            if isinstance(next_offset, bool):
                raise RuntimeError(
                    f"Invalid next_offset: {next_offset}"
                )

            try:
                next_offset = int(next_offset)
            except (ValueError, TypeError):
                raise RuntimeError(
                    f"Invalid next_offset: {next_offset}"
                )

            if next_offset <= offset:
                raise RuntimeError(
                    "Invalid pagination: next_offset "
                    f"{next_offset} is not greater "
                    f"than current offset {offset}."
                )

            offset = next_offset

    # ========================================================
    # Generate inspection summary
    # ========================================================

    print("\n[3] Analyzing metadata...")

    total_elapsed_ms = (
        time.perf_counter() - inspection_start
    ) * 1000

    field_names = sorted({
        field
        for record in all_records
        if isinstance(record, dict)
        for field in record.keys()
    })

    first_record = (
        all_records[0]
        if all_records
        else None
    )

    assigned_ids = [
        str(record["AssignedID"])
        for record in all_records
        if isinstance(record, dict)
        and record.get("AssignedID") is not None
    ]

    unique_assigned_ids = len(set(assigned_ids))

    duplicate_assigned_ids = (
        len(assigned_ids) - unique_assigned_ids
    )

    total_payload_bytes = sum(
        page["response_size_bytes"]
        for page in page_summaries
    )

    summary = {
        "mcp_server": MCP_URL,
        "tool": TOOL_NAME,
        "catalog_total_reported": catalog_total,
        "total_records_retrieved": len(all_records),
        "unique_assigned_ids": unique_assigned_ids,
        "duplicate_assigned_ids": duplicate_assigned_ids,
        "page_count": page_number,
        "total_elapsed_ms": round(
            total_elapsed_ms,
            2,
        ),
        "total_payload_bytes": total_payload_bytes,
        "total_payload_mb": round(
            total_payload_bytes / (1024 * 1024),
            3,
        ),
        "fields_found": field_names,
        "page_summaries": page_summaries,
        "first_record": first_record,
    }

    summary_path = save_json(
        SUMMARY_OUTPUT_FILE,
        summary,
    )

    # ========================================================
    # Display final report
    # ========================================================

    print("\n" + "=" * 70)
    print("MCP METADATA INSPECTION RESULTS")
    print("=" * 70)

    print(
        f"Catalog total reported: {catalog_total}"
    )

    print(
        f"Records retrieved: {len(all_records)}"
    )

    print(
        f"Unique AssignedIDs: {unique_assigned_ids}"
    )

    print(
        f"Duplicate AssignedIDs: "
        f"{duplicate_assigned_ids}"
    )

    print(
        f"Pages requested: {page_number}"
    )

    print(
        f"Total execution time: "
        f"{total_elapsed_ms:.2f} ms"
    )

    print(
        f"Total response payload: "
        f"{total_payload_bytes / (1024 * 1024):.3f} MB"
    )

    print("\nMetadata fields:")

    for field in field_names:
        print(f"  - {field}")

    print("\nFirst metadata record:")

    print(
        json.dumps(
            first_record,
            indent=2,
            ensure_ascii=False,
            default=str,
        )[:8000]
    )

    print("\nOutput files:")

    print(
        f"  Raw MCP response: "
        f"{OUTPUT_DIR / RAW_OUTPUT_FILE}"
    )

    print(
        f"  Inspection summary: "
        f"{summary_path}"
    )

    if (
        args.all
        and args.offset == 0
        and catalog_total is not None
        and len(all_records) != catalog_total
    ):
        print(
            "\nWARNING: Retrieved record count "
            "does not match the catalog total."
        )
        return 1

    print("\nInspection completed successfully.")

    return 0


if __name__ == "__main__":

    try:
        exit_code = asyncio.run(main())

        sys.exit(exit_code)

    except KeyboardInterrupt:
        print("\nInspection interrupted by user.")
        sys.exit(130)

    except Exception as exc:
        print(
            f"\nERROR: {type(exc).__name__}: {exc}"
        )
        sys.exit(1)
