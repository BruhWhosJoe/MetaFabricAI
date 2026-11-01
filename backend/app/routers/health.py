"""Health routers: backend liveness and MCP server connectivity."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.services.mcp_client import MCPClientError, MetaFabricMCPClient

router = APIRouter(tags=["health"])


def get_mcp_client() -> MetaFabricMCPClient:
    """Provide an MCP client instance (overridable in tests)."""
    return MetaFabricMCPClient()


@router.get("/health")
async def health() -> dict[str, str]:
    """Return backend liveness."""
    return {"status": "ok", "service": "MetaFabricAI Backend"}


@router.get("/mcp/health")
async def mcp_health(
    client: MetaFabricMCPClient = Depends(get_mcp_client),
) -> JSONResponse:
    """Connect to the Azure MCP server and report discovered tool names."""
    try:
        result = await client.health()
    except MCPClientError as exc:
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "service": "MetaFabricAI Backend",
                "mcp_server_url": client.server_url,
                "tools": [],
                "tool_count": 0,
                "error": str(exc),
            },
        )
    return JSONResponse(
        status_code=200,
        content={"service": "MetaFabricAI Backend", **result},
    )
