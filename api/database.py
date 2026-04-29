import os
import ssl
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import yaml
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession


def _prepare_database_url() -> tuple[str, dict[str, object]]:
    """Prepare the database URL and connect_args for asyncpg.

    Neon/FastAPI Cloud provides URLs like:
        postgresql://user:pass@host/db?sslmode=require&channel_binding=require

    asyncpg doesn't understand these query params. We strip ALL query
    params from the URL and handle SSL via connect_args instead.
    """
    raw_url = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://benchmarks:benchmarks@localhost:5432/benchmarks",
    )

    parsed = urlparse(raw_url)
    has_ssl = "sslmode" in (parsed.query or "") or "ssl" in (parsed.query or "")

    # Rewrite driver prefix for async
    scheme = parsed.scheme
    if scheme == "postgresql":
        scheme = "postgresql+asyncpg"

    # Strip all query params — asyncpg chokes on sslmode, channel_binding, etc.
    clean_url = urlunparse(parsed._replace(scheme=scheme, query=""))

    # If SSL was requested, pass it properly via connect_args
    connect_args: dict[str, object] = {}
    if has_ssl:
        connect_args["ssl"] = ssl.create_default_context()

    return clean_url, connect_args


def get_github_token() -> str | None:
    """Get GitHub token from environment variable."""
    return os.getenv("GITHUB_TOKEN")


DATABASE_URL, _connect_args = _prepare_database_url()

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=300,
    pool_size=5,
    max_overflow=10,
    connect_args=_connect_args,
)

async_session_maker = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


async def init_db():
    from models import (  # noqa: F401
        BenchmarkRun,  # pyright: ignore[reportUnusedImport]
        Benchmark,  # pyright: ignore[reportUnusedImport]
        ComparisonCache,  # pyright: ignore[reportUnusedImport]
    )  # Import models here to register them

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
        await _migrate_source_column(conn)


async def _migrate_source_column(conn) -> None:  # type: ignore[no-untyped-def]
    """Add source column + per-source unique constraint, backfill from sources.yaml.

    Runs every startup. All operations are idempotent (`IF [NOT] EXISTS`),
    so it's safe to call repeatedly. Once every row has a source and the
    new constraint exists, this is effectively a no-op.
    """
    await conn.execute(
        text("ALTER TABLE benchmark_runs ADD COLUMN IF NOT EXISTS source VARCHAR")
    )
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_benchmark_runs_source ON benchmark_runs (source)"
        )
    )

    # Backfill source from sources.yaml using machine → source repo mapping.
    # Pre-existing rows all came from savannahostrowski/pyperf_bench (only
    # source before this migration), but use the config to be safe.
    sources_path = Path(__file__).parent / "sources.yaml"
    if sources_path.exists():
        with open(sources_path) as f:
            config = yaml.safe_load(f)
        for source in config.get("sources", []):
            repo = source["repo"]
            for machine_name in (source.get("machines") or {}).keys():
                await conn.execute(
                    text(
                        "UPDATE benchmark_runs SET source = :repo "
                        "WHERE source IS NULL AND machine = :machine"
                    ),
                    {"repo": repo, "machine": machine_name},
                )

    # Swap unique constraint: drop old (dir, machine) and add (dir, machine, source).
    await conn.execute(
        text(
            "ALTER TABLE benchmark_runs DROP CONSTRAINT IF EXISTS uq_directory_machine"
        )
    )
    # Postgres has no `ADD CONSTRAINT IF NOT EXISTS`; check pg_constraint first.
    exists = await conn.execute(
        text(
            "SELECT 1 FROM pg_constraint WHERE conname = 'uq_directory_machine_source'"
        )
    )
    if exists.first() is None:
        await conn.execute(
            text(
                "ALTER TABLE benchmark_runs ADD CONSTRAINT uq_directory_machine_source "
                "UNIQUE (directory_name, machine, source)"
            )
        )


async def get_session():
    async with async_session_maker() as session:
        yield session
