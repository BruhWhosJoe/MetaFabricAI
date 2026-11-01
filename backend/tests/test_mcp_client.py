"""Unit tests for MetaFabricMCPClient with a mocked FastMCP transport.

No network access: a fake client factory stands in for ``fastmcp.Client``.
"""

import pytest

from app.services.mcp_client import (
    MCPConnectionError,
    MCPToolError,
    MetaFabricMCPClient,
    normalize_tool_result,
)


class FakeTool:
    def __init__(self, name, input_schema):
        self.name = name
        self.description = f"{name} description"
        self.input_schema = input_schema
        self.output_schema = None


class FakeResult:
    def __init__(self, structured_content=None, data=None, content=None,
                 is_error=False):
        self.structured_content = structured_content
        self.data = data
        self.content = content or []
        self.is_error = is_error


class FakeTextBlock:
    def __init__(self, text):
        self.text = text


class FakeSession:
    """Async context manager mimicking a connected FastMCP client."""

    def __init__(self, harness):
        self._harness = harness

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def list_tools(self):
        if self._harness.list_error:
            raise self._harness.list_error
        return self._harness.tools

    async def call_tool(self, name, arguments=None):
        self._harness.calls.append((name, arguments))
        if self._harness.call_error:
            raise self._harness.call_error
        return self._harness.results[name]


class Harness:
    def __init__(self):
        self.calls = []
        self.list_error = None
        self.call_error = None
        self.tools = [
            FakeTool("get_metadata_fields",
                     {"type": "object", "properties": {
                         "default_search_only": {"type": "boolean"}}}),
            FakeTool("get_metadata_catalog",
                     {"type": "object", "properties": {
                         "fields": {}, "offset": {}, "limit": {}}}),
        ]
        self.results = {
            "get_metadata_fields": FakeResult(
                structured_content={"field_count": 2,
                                    "fields": [{"fieldName": "Title"}]}),
            "get_metadata_field_definitions": FakeResult(
                structured_content={"definitions": []}),
            "get_metadata_catalog": FakeResult(structured_content={
                "total_records": 1660, "has_more": True, "next_offset": 2,
                "rows": [{"AssignedID": "1", "Title": "A"},
                         {"AssignedID": "2", "Title": "B"}],
            }),
            "get_layer_metadata": FakeResult(
                structured_content={"rows": [{"AssignedID": "1"}]}),
        }

    def client(self):
        return MetaFabricMCPClient(
            server_url="https://example.invalid/mcp",
            client_factory=lambda: FakeSession(self),
        )


@pytest.mark.asyncio
async def test_list_tools_returns_names_and_schemas():
    harness = Harness()
    tools = await harness.client().list_tools()
    assert [t["name"] for t in tools] == [
        "get_metadata_fields", "get_metadata_catalog"]
    assert "default_search_only" in tools[0]["input_schema"]["properties"]


@pytest.mark.asyncio
async def test_health_returns_actual_tool_names():
    harness = Harness()
    result = await harness.client().health()
    assert result["status"] == "ok"
    assert result["tool_count"] == 2
    assert result["tools"][0] == "get_metadata_fields"


@pytest.mark.asyncio
async def test_get_metadata_fields_passes_schema_arguments():
    harness = Harness()
    result = await harness.client().get_metadata_fields()
    assert result == {"field_count": 2, "fields": [{"fieldName": "Title"}]}
    assert harness.calls == [
        ("get_metadata_fields", {"default_search_only": False})]


@pytest.mark.asyncio
async def test_get_metadata_catalog_passes_pagination_unchanged():
    harness = Harness()
    result = await harness.client().get_metadata_catalog(limit=2, offset=0)
    # All server fields preserved, including pagination markers.
    assert result["total_records"] == 1660
    assert result["has_more"] is True
    assert result["next_offset"] == 2
    assert result["rows"][1]["Title"] == "B"
    assert harness.calls == [
        ("get_metadata_catalog",
         {"fields": None, "offset": 0, "limit": 2})]


@pytest.mark.asyncio
async def test_get_layer_metadata_requires_and_passes_layer_ids():
    harness = Harness()
    result = await harness.client().get_layer_metadata(["1"])
    assert result == {"rows": [{"AssignedID": "1"}]}
    assert harness.calls == [
        ("get_layer_metadata", {"layer_ids": ["1"], "fields": None})]


@pytest.mark.asyncio
async def test_tool_error_result_raises_mcp_tool_error():
    harness = Harness()
    harness.results["get_metadata_fields"] = FakeResult(
        is_error=True, content=[FakeTextBlock("boom")])
    with pytest.raises(MCPToolError, match="boom"):
        await harness.client().get_metadata_fields()


@pytest.mark.asyncio
async def test_call_failure_is_wrapped_as_tool_error():
    harness = Harness()
    harness.call_error = RuntimeError("protocol exploded")
    with pytest.raises(MCPToolError):
        await harness.client().get_metadata_fields()


@pytest.mark.asyncio
async def test_connection_failure_is_wrapped_as_connection_error():
    def broken_factory():
        raise RuntimeError("connection refused")

    bad = MetaFabricMCPClient(
        server_url="https://example.invalid/mcp",
        client_factory=broken_factory)
    with pytest.raises(MCPConnectionError):
        await bad.list_tools()


@pytest.mark.asyncio
async def test_list_tools_failure_is_wrapped_as_connection_error():
    harness = Harness()
    harness.list_error = RuntimeError("handshake failed")
    with pytest.raises(MCPConnectionError):
        await harness.client().list_tools()


def test_normalize_prefers_structured_content_and_parses_text_json():
    assert normalize_tool_result(
        FakeResult(structured_content={"a": 1})) == {"a": 1}
    assert normalize_tool_result(
        FakeResult(content=[FakeTextBlock('{"b": 2}')])) == {"b": 2}
    assert normalize_tool_result(
        FakeResult(content=[FakeTextBlock("plain")])) == "plain"
