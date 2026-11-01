# MetaFabricAI Backend (Steps 8-10)

FastAPI backend, reusable asynchronous FastMCP client for the Azure
Metadata MCP Server, (Step 9) the Meta Muse AI Metadata Discovery
Agent, and (Step 10) the AI Data Recipe Agent. It does not connect
the React frontend (Step 11), does not execute recipes, and does not
duplicate the metadata catalog.

```text
Citizen -> React Web App (Step 7, unchanged)
        -> Meta Muse AI Agent (Step 9, not in this step)
        -> FastAPI backend (this folder)
        -> FastMCP client  ->  Azure Metadata MCP Server  ->  Open Data Catalog
```

## Structure

```text
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI app, CORS, /api router mounting
│   ├── config.py               # pydantic-settings env configuration
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── discovery_agent.py  # Muse Spark + MCP discovery workflow (Step 9)
│   │   └── recipe_agent.py     # Muse Spark Data Recipe workflow (Step 10)
│   ├── models/
│   │   ├── __init__.py
│   │   ├── discovery.py        # discovery request/response + plan/ranking
│   │   └── recipe.py           # Data Recipe request/response (Step 10)
│   ├── services/
│   │   ├── __init__.py
│   │   ├── mcp_client.py       # reusable async FastMCP client
│   │   └── model_client.py     # Meta Model API client (OpenAI-compatible)
│   └── routers/
│       ├── __init__.py
│       ├── discovery.py        # POST /api/discovery/search (Step 9)
│       ├── recipe.py           # POST /api/recipe/generate (Step 10)
│       └── health.py           # GET /api/health, GET /api/mcp/health
├── scripts/
│   └── test_mcp_connection.py  # live Azure MCP connection test
├── tests/
│   ├── conftest.py
│   ├── test_discovery.py       # mocked MCP + model discovery tests (Step 9)
│   ├── test_recipe.py          # mocked MCP + model Data Recipe tests (Step 10)
│   ├── test_health.py          # health/docs/CORS + mocked MCP health
│   └── test_mcp_client.py      # mocked-transport MCP client tests
├── requirements.txt
├── .env.example
└── README.md
```

A future Muse agent belongs in `backend/app/agents/` (Step 9) and can reuse
`app.services.mcp_client.MetaFabricMCPClient` without changing this layer.

## Endpoints

| Endpoint           | Description                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `GET /api/health`  | `{"status": "ok", "service": "MetaFabricAI Backend"}`              |
| `GET /api/mcp/health` | Connects to Azure MCP; returns actual discovered tool names, or `503` with an error when unavailable |
| `POST /api/discovery/search` | Step 9 AI discovery: ranked, MCP-grounded dataset recommendations (see below) |
| `POST /api/recipe/generate` | Step 10 Data Recipe: proposed (never executed) workflow from selected AssignedIDs |
| `GET /docs`        | Interactive OpenAPI (Swagger UI) documentation                     |
| `GET /openapi.json`| OpenAPI schema                                                     |

Discovered MCP tools (verified live): `get_metadata_fields`,
`get_metadata_field_definitions`, `get_metadata_catalog`,
`get_layer_metadata`. Their arguments in `mcp_client.py` mirror the server's
actual discovered input schemas; catalog pagination fields (`total_records`,
`has_more`, `next_offset`, ...) are preserved untouched.

## Prerequisites

- Windows PowerShell
- Python 3.11+ (developed/tested on Python 3.14.10)
- The existing React frontend is untouched by everything below.

## Setup (Windows PowerShell)

Run from the project root. The virtual environment lives at the project
root (`.venv`, git-ignored) and is shared by the backend commands below.

```powershell
cd C:\Projects\MetaFabricAI

# Create the project virtual environment (skip if .venv already exists)
python -m venv .venv

# Activate it
.\.venv\Scripts\Activate.ps1

# Install backend dependencies
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt

# Configure environment (creates backend\.env, git-ignored)
Copy-Item backend\.env.example backend\.env
```

If PowerShell blocks activation, allow scripts for the current session only:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

## Configuration

`backend\.env` (see [.env.example](.env.example)):

```dotenv
MCP_SERVER_URL=https://ca-metadata-mcp-dev.wittyforest-26c063ae.eastus.azurecontainerapps.io/mcp
MCP_TIMEOUT_SECONDS=60
MODEL_API_KEY=your_actual_meta_model_api_key
META_MODEL=muse-spark-1.3
META_REASONING_MODEL=muse-wonder-1.0
META_API_BASE_URL=https://api.meta.ai/v1
```

Step 9 discovery (`POST /api/discovery/search`) accepts
`{"question": "...", "location": "Washington, DC", "max_recommendations": 5}`
and returns ranked recommendations grounded only in MCP catalog records,
with `catalog_total`, `catalog_examined`, `completeness`, and `warnings`.
Errors: missing `MODEL_API_KEY` -> `503 model_not_configured`, unavailable
MCP -> `503 mcp_unavailable`, model provider/response failure -> `502
model_error`. Live discovery tests are opt-in:
`$env:RUN_LIVE_DISCOVERY_TESTS=1` before running pytest.

Step 10 Data Recipes (`POST /api/recipe/generate`) accept
`{"question": "...", "selected_assigned_ids": ["42", "7"]}` (aliases such
as `AssignedIDs` are also accepted), with optional `location` and
`discovery_context`. Selected IDs are verified with one
`get_layer_metadata` call -- the catalog is not rescanned -- then Muse
Spark proposes roles, relationships, and ordered steps. The response
always has `status: "proposed_not_executed"` and
`analysis_performed: false`. Errors: duplicate/empty selection -> `422`,
unknown AssignedIDs -> `404 dataset_not_found`, missing key or MCP
failure -> `503`, model failure/malformed output -> `502 model_error`.

Settings are loaded by [app/config.py](app/config.py) via `pydantic-settings`.
Real `.env` files and `.venv` are git-ignored (root `.gitignore`).
Environment variables set in the shell take precedence over `.env` values
with the same effect for local overrides.

## Run the backend

```powershell
cd C:\Projects\MetaFabricAI\backend
..\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Then open:

- Health: http://127.0.0.1:8000/api/health
- MCP health: http://127.0.0.1:8000/api/mcp/health
- Docs: http://127.0.0.1:8000/docs

CORS is configured for the Vite dev server origins
`http://localhost:5173` and `http://127.0.0.1:5173`.

Quick checks from another PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:8000/api/mcp/health
```

Expected `/api/mcp/health` (live Azure server):

```json
{
  "service": "MetaFabricAI Backend",
  "status": "ok",
  "mcp_server_url": "https://ca-metadata-mcp-dev.wittyforest-26c063ae.eastus.azurecontainerapps.io/mcp",
  "tools": ["get_metadata_fields", "get_metadata_field_definitions", "get_metadata_catalog", "get_layer_metadata"],
  "tool_count": 4
}
```

If the MCP server is unavailable, `/api/mcp/health` returns HTTP `503` with
`"status": "error"` and an `"error"` message; `/api/health` still returns
`200`.

## Live MCP connection test

Discovers tools, prints their actual input schemas, calls
`get_metadata_fields`, and fetches a small catalog sample (arguments built
from the discovered `get_metadata_catalog` schema):

```powershell
cd C:\Projects\MetaFabricAI\backend
..\.venv\Scripts\Activate.ps1
python scripts\test_mcp_connection.py
```

Exit code `0` means live connectivity succeeded; `1` prints the real error.

## Automated tests

All remote MCP calls are mocked -- tests never touch Azure:

```powershell
cd C:\Projects\MetaFabricAI\backend
..\.venv\Scripts\Activate.ps1
python -m pytest tests -v
```

Coverage: FastAPI health response, `/docs`, CORS allow/deny, MCP health
success (actual tool names) and `503` error handling, FastMCP client
argument passing for all four metadata tools, pagination preservation,
JSON normalization, and connection/tool error wrapping.

## Using the MCP client (for Step 9)

```python
import asyncio
from app.services.mcp_client import MetaFabricMCPClient

async def main():
    client = MetaFabricMCPClient()  # URL/timeout from backend/.env
    print(await client.health())                       # discovered tools
    fields = await client.get_metadata_fields()
    page = await client.get_metadata_catalog(limit=100, offset=0)
    # Page further with page["next_offset"] while page["has_more"] is true.
    layer = await client.get_layer_metadata(["1"])

asyncio.run(main())
```

## Troubleshooting

| Symptom | Check |
| ------- | ----- |
| `ModuleNotFoundError: app` | Run commands from `backend\` so `app` is importable |
| `/api/mcp/health` returns 503 | Azure MCP server/network unavailable; run the live script for the raw error |
| Activation script blocked | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` |
| Port 8000 in use | Add `--port 8001` to the uvicorn command |
