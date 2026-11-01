"""Data Recipe router: POST /api/recipe/generate (Step 10).

Errors are mapped without credentials or stack traces: invalid selection
-> 422, unknown AssignedIDs -> 404, missing model configuration or
unavailable MCP -> 503, model provider/response failures -> 502.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.agents.recipe_agent import (
    RecipeAgent,
    RecipeDatasetNotFoundError,
    RecipeValidationError,
)
from app.models.recipe import DataRecipeResponse, RecipeRequest
from app.routers.discovery import get_model_client
from app.routers.health import get_mcp_client
from app.services.mcp_client import MCPClientError, MetaFabricMCPClient
from app.services.model_client import (
    MetaModelClient,
    ModelConfigurationError,
    ModelProviderError,
    ModelResponseError,
)

router = APIRouter(tags=["recipe"])


def get_recipe_agent(
    mcp_client: MetaFabricMCPClient = Depends(get_mcp_client),
    model_client: MetaModelClient = Depends(get_model_client),
) -> RecipeAgent:
    """Provide the Data Recipe Agent (overridable in tests)."""
    return RecipeAgent(mcp_client, model_client)


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"detail": message, "error": code},
    )


@router.post("/recipe/generate", response_model=DataRecipeResponse)
async def generate_recipe(
    request: RecipeRequest,
    agent: RecipeAgent = Depends(get_recipe_agent),
) -> DataRecipeResponse | JSONResponse:
    """Generate a proposed (not executed) Data Recipe for selected datasets."""
    try:
        return await agent.generate(request)
    except RecipeDatasetNotFoundError as exc:
        return _error(404, "dataset_not_found", str(exc))
    except RecipeValidationError as exc:
        return _error(422, "invalid_recipe_request", str(exc))
    except ModelConfigurationError as exc:
        return _error(503, "model_not_configured", str(exc))
    except MCPClientError as exc:
        return _error(503, "mcp_unavailable", f"Metadata catalog unavailable: {exc}")
    except (ModelProviderError, ModelResponseError) as exc:
        return _error(502, "model_error", str(exc))
