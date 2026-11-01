"""MetaFabricAI FastAPI application.

Step 8 exposes health endpoints and the reusable FastMCP client foundation.
A future Step 9 Muse AI agent can be added under ``app/agents/`` and
mounted here without changing the existing routers or services.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import discovery, health

CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(title="MetaFabricAI Backend", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router, prefix="/api")
    app.include_router(discovery.router, prefix="/api")
    return app


app = create_app()
