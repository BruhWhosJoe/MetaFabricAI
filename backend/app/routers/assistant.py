"""AI Assistant router: POST /api/assistant/chat (Step 11.3).

Errors are mapped without credentials or stack traces: missing model
configuration and unavailable MCP -> 503, model provider/response
failures -> 502. Request validation errors (short/blank messages, bad
shapes) are reported by FastAPI as 422.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.agents.assistant_agent import AssistantAgent
from app.models.assistant import AssistantChatRequest, AssistantChatResponse
from app.routers.discovery import get_model_client
from app.routers.health import get_mcp_client
from app.services.mcp_client import MCPClientError, MetaFabricMCPClient
from app.services.model_client import (
    MetaModelClient,
    ModelConfigurationError,
    ModelProviderError,
    ModelResponseError,
)

router = APIRouter(tags=["assistant"])


def get_assistant_agent(
    mcp_client: MetaFabricMCPClient = Depends(get_mcp_client),
    model_client: MetaModelClient = Depends(get_model_client),
) -> AssistantAgent:
    """Provide the AI Assistant Agent (overridable in tests)."""
    return AssistantAgent(mcp_client, model_client)


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"detail": message, "error": code},
    )


@router.post("/assistant/chat", response_model=AssistantChatResponse)
async def assistant_chat(
    request: AssistantChatRequest,
    agent: AssistantAgent = Depends(get_assistant_agent),
) -> AssistantChatResponse | JSONResponse:
    """Answer a metadata-aware assistant message with structured actions."""
    try:
        return await agent.chat(request)
    except ModelConfigurationError as exc:
        return _error(503, "model_not_configured", str(exc))
    except MCPClientError as exc:
        return _error(503, "mcp_unavailable", f"Metadata catalog unavailable: {exc}")
    except (ModelProviderError, ModelResponseError) as exc:
        return _error(502, "model_error", str(exc))
