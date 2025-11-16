import pathlib
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

import fastapi
import httpx
from database import get_session, init_db
from fastapi.middleware.cors import CORSMiddleware
from models import Benchmark, BenchmarkRun
from sqlmodel import desc, select
from sqlmodel.ext.asyncio.session import AsyncSession

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
        "http://localhost:8084",  # Frontend in Docker
        "https://*.github.io",
        "https://*.savannah.dev",  # Cloudflare tunnel
        "https://doesjitgobrrr.com",
        "https://www.doesjitgobrrr.com",
        "https://isthejitfasteryet.com",
        "https://www.isthejitfasteryet.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def render_home():
    async with httpx.AsyncClient() as client:
        response = await client.get(
            GITHUB_REPO_URL, headers={"Accept": "application/vnd.github.v3+json"}
        )
        response.raise_for_status()
        return response.json()


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/api/latest")
async def get_latest_comparison(
    session: AsyncSession = fastapi.Depends(get_session),
) -> dict[str, Any]:
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
async def get_historical_comparison(
    days: int = 30, session: AsyncSession = fastapi.Depends(get_session)
) -> dict[str, Any]:
    result = await session.exec(
        select(BenchmarkRun).order_by(desc(BenchmarkRun.run_date)).limit(days)
    )
    runs = result.all()

    # Group runs by date to calculate speedup ratios
    runs_by_date: dict[str, dict[str, Any]] = {}

    for run in runs:
        benchmark_result = await session.exec(
            select(Benchmark).where(Benchmark.run_id == run.id)
        )
        benchmarks = benchmark_result.all()

        benchmarks_json = {}
        benchmark_means: list[float] = []
        for bench in benchmarks:
            benchmarks_json[bench.name] = {
                "mean": bench.mean,
                "median": bench.median,
                "stddev": bench.stddev,
                "min_value": bench.min_value,
                "max_value": bench.max_value,
            }
            if bench.mean is not None and bench.mean > 0:
                benchmark_means.append(bench.mean)


        date_key = run.run_date.date().isoformat()
        if date_key not in runs_by_date:
            runs_by_date[date_key] = {}

        run_type = "jit" if run.is_jit else "nonjit"
        run_data: dict[str, Any] = {
            "date": run.run_date.isoformat(),
            "commit": run.commit_hash,
            "python_version": run.python_version,
            "is_jit": run.is_jit,
            "benchmarks": benchmarks_json,
        }

        # Add HPT data and geometric mean speedup for JIT runs
        if run.is_jit:
            run_data["hpt"] = {
                "reliability": run.hpt_reliability,
                "percentile_90": run.hpt_percentile_90,
                "percentile_95": run.hpt_percentile_95,
                "percentile_99": run.hpt_percentile_99,
            }
            # Use the pre-calculated geometric mean speedup from the database
            run_data["speedup"] = run.geometric_mean_speedup

        runs_by_date[date_key][run_type] = run_data

    # Build historical data
    historical_data: list[dict[str, Any]] = []
    for date_key, date_runs in runs_by_date.items():
        # Add non-JIT run if it exists
        if "nonjit" in date_runs:
            historical_data.append(date_runs["nonjit"])

        # Add JIT run if it exists (speedup already set from database)
        if "jit" in date_runs:
            historical_data.append(date_runs["jit"])

    return {"days": days, "historical_runs": historical_data}


@app.get("/api/benchmarks/{name}/trend")
async def get_benchmark_trend(
    name: str, days: int = 30, session: AsyncSession = fastapi.Depends(get_session)
) -> dict[str, Any]:
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
            trend_data.append(
                {
                    "date": run.run_date.isoformat(),
                    "mean": benchmark.mean,
                    "median": benchmark.median,
                    "stddev": benchmark.stddev,
                    "min_value": benchmark.min_value,
                    "max_value": benchmark.max_value,
                }
            )

    return {"benchmark_name": name, "days": days, "trend": trend_data}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_excludes=["data/*", "*.db"],
    )
