"""Shared pytest fixtures.

Tests run against a *separate* test database (``benchmarks_test``) so the
local dev DB is never wiped by truncating fixtures. The test database is
created automatically the first time tests are run if it doesn't exist.

If you set ``DATABASE_URL`` explicitly before running pytest, that wins —
useful in CI where a dedicated DB is already provisioned.
"""

import os
import sys
from collections.abc import AsyncGenerator
from pathlib import Path
from urllib.parse import urlparse, urlunparse

# Make api/ importable regardless of where pytest is invoked from.
API_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_ROOT))

# Default to a *separate* test database on the docker-compose Postgres so
# tests never wipe the dev DB. CI / local devs can override DATABASE_URL.
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://benchmarks:benchmarks@localhost:5432/benchmarks_test",
)

import asyncpg
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlmodel.ext.asyncio.session import AsyncSession

from database import engine, init_db
from main import app
from models import Benchmark, BenchmarkRun, ComparisonCache


async def _ensure_test_database_exists() -> None:
    """Create the test database if it doesn't already exist.

    asyncpg can't `CREATE DATABASE` from inside a transaction, so we open
    a one-shot connection to the admin ``postgres`` DB and run it there.
    Idempotent — silently no-ops if the DB is already present.
    """
    raw = os.environ.get("DATABASE_URL", "")
    parsed = urlparse(raw)
    target_db = parsed.path.lstrip("/")
    if not target_db:
        return
    # `target_db` is interpolated into a CREATE DATABASE statement below
    # (Postgres can't parameterize identifiers). Cap the input to a safe
    # identifier shape — postgres-style: letters, digits, underscores.
    import re

    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", target_db):
        raise ValueError(f"Refusing to CREATE DATABASE with unsafe name: {target_db!r}")

    # Build admin URL: same host/credentials, hit `postgres` DB.
    admin = urlunparse(parsed._replace(path="/postgres", query=""))
    # asyncpg.connect doesn't understand the +asyncpg driver suffix.
    admin = admin.replace("postgresql+asyncpg://", "postgresql://")
    try:
        conn = await asyncpg.connect(admin)
    except Exception:
        # If we can't reach Postgres at all, leave the original error to
        # surface from init_db() with a clearer message.
        return
    try:
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1", target_db
        )
        if not exists:
            # Identifiers can't be parameterized; target_db comes from our
            # own DATABASE_URL so it's not user input.
            await conn.execute(f'CREATE DATABASE "{target_db}"')
    finally:
        await conn.close()


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _setup_schema() -> AsyncGenerator[None, None]:
    """Provision the test DB + create tables once per test session."""
    await _ensure_test_database_exists()
    await init_db()
    yield


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """A real async DB session. Truncates rows before and after each test
    (safe — runs against the dedicated test DB, not the dev DB)."""

    async def _truncate(session: AsyncSession) -> None:
        for model in (ComparisonCache, Benchmark, BenchmarkRun):
            await session.exec(delete(model))  # type: ignore[call-overload]
        await session.commit()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        await _truncate(session)
        try:
            yield session
        finally:
            await session.rollback()
            await _truncate(session)


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
