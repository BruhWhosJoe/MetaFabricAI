"""Tests for GET /api/health, /docs, CORS, and GET /api/mcp/health.

Remote MCP calls are mocked -- these tests never touch the Azure server.
"""

from fastapi.testclient import TestClient

from app.main import app, create_app
from app.routers.health import get_mcp_client
from app.services.mcp_client import MCPConnectionError, MCPToolError

client = TestClient(app)


class FakeMCPClient:
    """Stand-in MCP client returning fixed discovered tools."""

    server_url = "https://example.invalid/mcp"

    async def health(self):
        return {
            "status": "ok",
            "mcp_server_url": self.server_url,
            "tools": [
                "get_metadata_fields",
                "get_metadata_field_definitions",
                "get_metadata_catalog",
                "get_layer_metadata",
            ],
            "tool_count": 4,
        }


class FailingMCPClient:
    """Stand-in MCP client simulating an unavailable MCP server."""

    server_url = "https://example.invalid/mcp"

    async def health(self):
        raise MCPConnectionError("Failed to connect to MCP server: refused")


def _client_with_mcp(fake) -> TestClient:
    test_app = create_app()
    test_app.dependency_overrides[get_mcp_client] = lambda: fake
    return TestClient(test_app, raise_server_exceptions=False)


def test_health_returns_ok():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "MetaFabricAI Backend",
    }


def test_docs_available():
    response = client.get("/docs")
    assert response.status_code == 200


def test_openapi_available():
    response = client.get("/openapi.json")
    assert response.status_code == 200
    assert "/api/health" in response.json()["paths"]
    assert "/api/mcp/health" in response.json()["paths"]


def test_cors_allows_vite_dev_origin():
    response = client.get(
        "/api/health", headers={"Origin": "http://localhost:5173"}
    )
    assert response.status_code == 200
    assert (
        response.headers.get("access-control-allow-origin")
        == "http://localhost:5173"
    )


def test_cors_rejects_unlisted_origin():
    response = client.get(
        "/api/health", headers={"Origin": "http://evil.example"}
    )
    assert response.headers.get("access-control-allow-origin") is None


def test_mcp_health_returns_discovered_tool_names():
    response = _client_with_mcp(FakeMCPClient()).get("/api/mcp/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "MetaFabricAI Backend"
    assert body["tools"] == [
        "get_metadata_fields",
        "get_metadata_field_definitions",
        "get_metadata_catalog",
        "get_layer_metadata",
    ]
    assert body["tool_count"] == 4


def test_mcp_health_returns_503_when_mcp_unavailable():
    response = _client_with_mcp(FailingMCPClient()).get("/api/mcp/health")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "error"
    assert body["tools"] == []
    assert body["tool_count"] == 0
    assert "error" in body and body["error"]


def test_mcp_health_returns_503_on_tool_error():
    class ToolFailingClient(FailingMCPClient):
        async def health(self):
            raise MCPToolError("MCP tool 'x' call failed")

    response = _client_with_mcp(ToolFailingClient()).get("/api/mcp/health")
    assert response.status_code == 503
    assert response.json()["status"] == "error"
