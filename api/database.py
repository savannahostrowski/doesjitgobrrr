import os
import ssl
from urllib.parse import urlparse, urlunparse

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


async def get_session():
    async with async_session_maker() as session:
        yield session
