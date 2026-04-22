"""Shared pytest fixtures.

Tests run against a real Postgres (started via docker-compose). See the
project README or the CI test workflow for the exact startup command.

Data isolation: the `db_session` fixture cleans all table rows at the end
of each test function. Tables are created once per session.
"""

import os
import sys
from collections.abc import AsyncGenerator
from pathlib import Path

# Make api/ importable regardless of where pytest is invoked from.
API_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_ROOT))

# Default to the docker-compose db. CI or local dev can override.
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://benchmarks:benchmarks@localhost:5432/benchmarks",
)

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlmodel.ext.asyncio.session import AsyncSession

from database import engine, init_db
from main import app
from models import Benchmark, BenchmarkRun, ComparisonCache


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _setup_schema() -> AsyncGenerator[None, None]:
    """Create tables once per test session."""
    await init_db()
    yield


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """A real async DB session. Cleans all rows at teardown."""
    async with AsyncSession(engine, expire_on_commit=False) as session:
        try:
            yield session
        finally:
            await session.rollback()
            # Delete children before parents.
            for model in (ComparisonCache, Benchmark, BenchmarkRun):
                await session.exec(delete(model))  # type: ignore[call-overload]
            await session.commit()


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Async HTTP client backed by the FastAPI app via ASGI transport.

    Unlike the sync TestClient, this keeps the whole stack in one event
    loop, which asyncpg requires. Endpoints use the real engine via
    get_session — no dependency overrides.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac
