"""Pytest setup: make the backend ``app`` package importable."""

import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture(autouse=True)
def _clear_discovery_catalog_cache():
    """Isolate tests from the Step 11.2 in-memory catalog scan cache."""
    from app.agents.discovery_agent import clear_discovery_cache

    clear_discovery_cache()
    yield
    clear_discovery_cache()
