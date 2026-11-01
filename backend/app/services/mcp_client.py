"""Reusable asynchronous FastMCP client for the Azure Metadata MCP Server.

Wraps the FastMCP Python SDK (``fastmcp.Client``) over HTTPS. Tool names and
arguments below mirror the server's actual discovered input schemas
(verified live against the Azure endpoint):

- ``get_metadata_fields``: ``{default_search_only: bool = false}``
- ``get_metadata_field_definitions``: ``{fields: list[str] | null = null}``
- ``get_metadata_catalog``:
  ``{fields: list[str] | null = null, offset: int = 0, limit: int = 100}``
- ``get_layer_metadata``:
  ``{layer_ids: list[str] (required), fields: list[str] | null = null}``

No metadata is invented or dropped: results are normalized to plain JSON
values with every server-provided field preserved, including the catalog
pagination fields (``has_more``, ``next_offset``, ``total_records``, ...).
Server-side page limits are respected -- this client never overrides the
``limit`` a caller passes and surfaces the server's pagination markers so
callers can page with ``offset``/``next_offset``.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastmcp import Client

from app.config import get_settings


class MCPClientError(Exception):
    """Base error for MCP client failures."""


class MCPConnectionError(MCPClientError):
    """Raised when the MCP server cannot be reached or the session fails."""


class MCPToolError(MCPClientError):
    """Raised when the MCP server reports a tool-level error."""


def _to_jsonable(value: Any) -> Any:
    """Convert SDK/pydantic values to plain JSON-serializable values."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(item) for item in value]
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        try:
            return _to_jsonable(model_dump(mode="json"))
        except TypeError:
            return _to_jsonable(model_dump())
    return str(value)


def _parse_text(text: str) -> Any:
    """Parse a text content block as JSON when possible, else keep text."""
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return text


def normalize_tool_result(result: Any) -> Any:
    """Normalize a FastMCP ``CallToolResult`` to plain JSON values.

    Prefers ``structured_content`` (full structured payload), falls back to
    ``data``, then to the content blocks (JSON-parsing text blocks). Raises
    :class:`MCPToolError` when the server marks the result as an error.
    """
    if getattr(result, "is_error", False):
        message = _content_to_text(result)
        raise MCPToolError(message or "MCP tool returned an error.")

    structured = getattr(result, "structured_content", None)
    if structured is not None:
        return _to_jsonable(structured)

    data = getattr(result, "data", None)
    if data is not None:
        return _to_jsonable(data)

    blocks: list[Any] = []
    for block in getattr(result, "content", None) or []:
        text = getattr(block, "text", None)
        if isinstance(text, str):
            blocks.append(_parse_text(text))
        else:
            blocks.append(_to_jsonable(block))
    if len(blocks) == 1:
        return blocks[0]
    return blocks


def _content_to_text(result: Any) -> str:
    parts: list[str] = []
    for block in getattr(result, "content", None) or []:
        text = getattr(block, "text", None)
        if isinstance(text, str):
            parts.append(text)
    return "\n".join(parts).strip()


def normalize_tool(tool: Any) -> dict[str, Any]:
    """Normalize a discovered MCP tool to a JSON dict with its schema."""
    input_schema = getattr(tool, "input_schema", None)
    if input_schema is None:  # older SDK attribute spelling
        input_schema = getattr(tool, "inputSchema", None)
    output_schema = getattr(tool, "output_schema", None)
    if output_schema is None:
        output_schema = getattr(tool, "outputSchema", None)
    normalized: dict[str, Any] = {
        "name": getattr(tool, "name", ""),
        "description": getattr(tool, "description", None),
        "input_schema": _to_jsonable(input_schema) if input_schema else {},
    }
    if output_schema:
        normalized["output_schema"] = _to_jsonable(output_schema)
    return normalized


class MetaFabricMCPClient:
    """Async client for the Azure Metadata MCP Server.

    Each operation opens its own short-lived HTTPS session, so instances are
    cheap and safe to create per request. Use :meth:`connect` to run several
    operations over one session.
    """

    def __init__(
        self,
        server_url: str | None = None,
        timeout_seconds: float | None = None,
        client_factory: Callable[[], Any] | None = None,
    ) -> None:
        settings = get_settings()
        self.server_url = server_url or settings.mcp_server_url
        self.timeout_seconds = (
            timeout_seconds
            if timeout_seconds is not None
            else settings.mcp_timeout_seconds
        )
        self._client_factory = client_factory

    def _make_client(self) -> Any:
        if self._client_factory is not None:
            return self._client_factory()
        return Client(self.server_url, timeout=self.timeout_seconds)

    @asynccontextmanager
    async def connect(self) -> AsyncIterator[Any]:
        """Yield a connected FastMCP client; wrap failures as MCP errors."""
        try:
            async with self._make_client() as client:
                yield client
        except MCPClientError:
            raise
        except Exception as exc:  # network, protocol, auth, timeout, ...
            raise MCPConnectionError(
                f"Failed to connect to MCP server at {self.server_url}: {exc}"
            ) from exc

    async def list_tools(self) -> list[dict[str, Any]]:
        """Discover all MCP tools with their actual input schemas."""
        async with self.connect() as client:
            try:
                tools = await client.list_tools()
            except MCPClientError:
                raise
            except Exception as exc:
                raise MCPConnectionError(
                    f"Failed to list MCP tools from {self.server_url}: {exc}"
                ) from exc
        return [normalize_tool(tool) for tool in tools]

    async def call_tool(
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> Any:
        """Call an MCP tool by name and return its normalized JSON result."""
        async with self.connect() as client:
            return await self._call_on(client, name, arguments)

    @staticmethod
    async def _call_on(
        client: Any, name: str, arguments: dict[str, Any] | None
    ) -> Any:
        try:
            result = await client.call_tool(name, arguments or {})
        except MCPClientError:
            raise
        except Exception as exc:
            raise MCPToolError(f"MCP tool '{name}' call failed: {exc}") from exc
        return normalize_tool_result(result)

    async def health(self) -> dict[str, Any]:
        """Connect, discover tools, and return their actual names."""
        tools = await self.list_tools()
        names = [tool["name"] for tool in tools]
        return {
            "status": "ok",
            "mcp_server_url": self.server_url,
            "tools": names,
            "tool_count": len(names),
        }

    # -- Metadata tools (arguments mirror the discovered input schemas) ----

    async def get_metadata_fields(
        self, default_search_only: bool = False
    ) -> Any:
        """List metadata field names available in the catalog."""
        return await self.call_tool(
            "get_metadata_fields",
            {"default_search_only": default_search_only},
        )

    async def get_metadata_field_definitions(
        self, fields: list[str] | None = None
    ) -> Any:
        """Return definitions for selected fields (all when omitted)."""
        return await self.call_tool(
            "get_metadata_field_definitions", {"fields": fields}
        )

    async def get_metadata_catalog(
        self,
        fields: list[str] | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> Any:
        """Return one page of raw metadata catalog rows.

        Pagination is server-driven: the result preserves ``total_records``,
        ``has_more`` and ``next_offset`` so callers can fetch further pages
        by passing ``offset=next_offset``. ``limit`` is passed through
        unchanged; the server caps it at its own maximum per call.
        """
        return await self.call_tool(
            "get_metadata_catalog",
            {"fields": fields, "offset": offset, "limit": limit},
        )

    async def get_layer_metadata(
        self, layer_ids: list[str], fields: list[str] | None = None
    ) -> Any:
        """Fetch metadata for exact catalog records by ``AssignedID``."""
        return await self.call_tool(
            "get_layer_metadata",
            {"layer_ids": layer_ids, "fields": fields},
        )
