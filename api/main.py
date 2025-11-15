from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any
from fastapi.middleware.cors import CORSMiddleware
import pathlib
import fastapi
import httpx
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select, desc

from models import Benchmark, BenchmarkRun
from database import get_session, init_db


GITHUB_REPO_URL = "https://api.github.com/repos/savannahostrowski/pyperf_bench"

@asynccontextmanager
async def lifespan(app: fastapi.FastAPI) -> AsyncGenerator[None, None]:
    """FastAPI lifespan event to manage startup and shutdown tasks."""
    pathlib.Path("data").mkdir(exist_ok=True)
    await init_db()
    print("Database initialized.")
    yield
    print("Shutting down application.")

app = fastapi.FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "https://*.github.io",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def render_home():
    async with httpx.AsyncClient() as client:
        response = await client.get(GITHUB_REPO_URL,
                                    headers={"Accept": "application/vnd.github.v3+json"})
        response.raise_for_status()
        return response.json()

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.get("/api/latest")
async def get_latest_comparison(session: AsyncSession = fastapi.Depends(get_session)) -> dict[ str, Any]:
    result = await session.exec(
        select(BenchmarkRun).order_by(desc(BenchmarkRun.run_date)).limit(1)
    )
    latest_run: BenchmarkRun | None = result.one_or_none()

    if not latest_run:
        return {"error": "No benchmark runs found."}
    
    benchmark_result = await session.exec(
        select(Benchmark).where(Benchmark.run_id == latest_run.id)
    )
    benchmarks = benchmark_result.all()

    return_json = {}
    for bench in benchmarks:
        return_json[bench.name] = {
            "mean": bench.mean,
            "median": bench.median,
            "stddev": bench.stddev,
            "min_value": bench.min_value,
            "max_value": bench.max_value,
        }

    return {
        "date": latest_run.run_date.isoformat(),
        "commit": latest_run.commit_hash,
        "python_version": latest_run.python_version,
        "benchmarks": return_json,
    }


@app.get("/api/historical")
async def get_historical_comparison(days: int = 30,
                                  session: AsyncSession = fastapi.Depends(get_session)) -> dict[str, Any]:
        
    result = await session.exec(
        select(BenchmarkRun).order_by(desc(BenchmarkRun.run_date)).limit(days)
    )
    runs = result.all()
    historical_data: list[dict[str, Any]] = []
    for run in runs:
        benchmark_result = await session.exec(
            select(Benchmark).where(Benchmark.run_id == run.id)
        )
        benchmarks = benchmark_result.all()

        benchmarks_json = {}
        for bench in benchmarks:
            benchmarks_json[bench.name] = {
                "mean": bench.mean,
                "median": bench.median,
                "stddev": bench.stddev,
                "min_value": bench.min_value,
                "max_value": bench.max_value,
            }

        historical_data.append({
            "date": run.run_date.isoformat(),
            "commit": run.commit_hash,
            "python_version": run.python_version,
            "benchmarks": benchmarks_json,
        })

    return {
        "days": days,
        "historical_runs": historical_data
    }

@app.get("/api/benchmarks/{name}/trend")
async def get_benchmark_trend(name: str, days: int = 30, session: AsyncSession = fastapi.Depends(get_session)) -> dict[str, Any]:
    result = await session.exec(
        select(BenchmarkRun).order_by(desc(BenchmarkRun.run_date)).limit(days)
    )
    runs = result.all()
    trend_data: list[dict[str, Any]] = []
    for run in runs:
        benchmark_result = await session.exec(
            select(Benchmark).where(
                (Benchmark.run_id == run.id) & (Benchmark.name == name)
            )
        )
        benchmark = benchmark_result.one_or_none()
        if benchmark:
            trend_data.append({
                "date": run.run_date.isoformat(),
                "mean": benchmark.mean,
                "median": benchmark.median,
                "stddev": benchmark.stddev,
                "min_value": benchmark.min_value,
                "max_value": benchmark.max_value,
            })

    return {
        "benchmark_name": name,
        "days": days,
        "trend": trend_data
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)