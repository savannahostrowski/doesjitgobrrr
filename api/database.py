from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlmodel import SQLModel

DATABASE_URL = "sqlite+aiosqlite:///./data/benchmarks.db"

engine = create_async_engine(
    DATABASE_URL, 
    echo=True,
    connect_args={"check_same_thread": False}
)

async_session_maker = async_sessionmaker(
    engine,
    expire_on_commit=False
)

async def init_db():
    from models import BenchmarkRun, Benchmark, ComparisonCache  # Import models here to register them
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)

async def get_session():
    async with async_session_maker() as session:
        yield session