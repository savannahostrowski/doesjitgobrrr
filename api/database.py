import os
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession


def get_postgres_password() -> str:
    """Get PostgreSQL password from Docker secret or environment variable."""
    secret_file = Path("/run/secrets/postgres_password")
    if secret_file.exists():
        return secret_file.read_text().strip()
    return os.getenv("POSTGRES_PASSWORD", "benchmarks")


def get_admin_token() -> str | None:
    """Get admin token from Docker secret or environment variable."""
    secret_file = Path("/run/secrets/admin_token")
    if secret_file.exists():
        return secret_file.read_text().strip()
    return os.getenv("ADMIN_TOKEN")


def get_github_token() -> str | None:
    """Get GitHub token from Docker secret or environment variable."""
    secret_file = Path("/run/secrets/github_token")
    if secret_file.exists():
        return secret_file.read_text().strip()
    return os.getenv("GITHUB_TOKEN")


def get_database_url() -> str:
    """Construct database URL with password from secret or environment."""
    if database_url := os.getenv("DATABASE_URL"):
        return database_url

    password = get_postgres_password()
    host = os.getenv("POSTGRES_HOST", "localhost")
    return f"postgresql+asyncpg://benchmarks:{password}@{host}:5432/benchmarks"


DATABASE_URL = get_database_url()

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,  # Test connections before using them to avoid stale connections
    pool_recycle=3600,  # Recycle connections after 1 hour
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
