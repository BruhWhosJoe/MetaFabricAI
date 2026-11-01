"""Discovery router: POST /api/discovery/search (Step 9).

Errors are mapped to clear HTTP responses without credentials or stack
traces: missing model configuration and unavailable MCP -> 503, model
provider/response failures -> 502.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.agents.discovery_agent import DiscoveryAgent
from app.models.discovery import DiscoveryRequest, DiscoveryResponse
from app.routers.health import get_mcp_client
from app.services.mcp_client import MCPClientError, MetaFabricMCPClient
from app.services.model_client import (
    MetaModelClient,
    ModelConfigurationError,
    ModelProviderError,
    ModelResponseError,
)

router = APIRouter(tags=["discovery"])


def get_model_client() -> MetaModelClient:
    """Provide a Meta Model API client (overridable in tests)."""
    return MetaModelClient()


def get_discovery_agent(
    mcp_client: MetaFabricMCPClient = Depends(get_mcp_client),
    model_client: MetaModelClient = Depends(get_model_client),
) -> DiscoveryAgent:
    """Provide the Discovery Agent (overridable in tests)."""
    return DiscoveryAgent(mcp_client, model_client)


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"detail": message, "error": code},
    )


@router.post("/discovery/search", response_model=DiscoveryResponse)
async def discovery_search(
    request: DiscoveryRequest,
    agent: DiscoveryAgent = Depends(get_discovery_agent),
) -> DiscoveryResponse | JSONResponse:
    """Discover and rank government datasets for a citizen question."""
    try:
        return await agent.search(request)
    except ModelConfigurationError as exc:
        return _error(503, "model_not_configured", str(exc))
    except MCPClientError as exc:
        return _error(503, "mcp_unavailable", f"Metadata catalog unavailable: {exc}")
    except (ModelProviderError, ModelResponseError) as exc:
        return _error(502, "model_error", str(exc))
