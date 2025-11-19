import os
import pathlib
import subprocess
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

import fastapi
import httpx
from database import get_admin_token, get_session, init_db
from fastapi import BackgroundTasks, HTTPException, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from models import Benchmark, BenchmarkRun
from sqlmodel import desc, select
from sqlmodel.ext.asyncio.session import AsyncSession

GITHUB_REPO_URL = "https://api.github.com/repos/savannahostrowski/pyperf_bench"

# Security for admin endpoints
security = HTTPBearer()


def verify_admin_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    """Verify the admin token for protected endpoints."""
    admin_token = get_admin_token()
    if not admin_token:
        raise HTTPException(status_code=500, detail="Admin token not configured")
    if credentials.credentials != admin_token:
        raise HTTPException(status_code=403, detail="Invalid admin token")
    return credentials


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
        "https://api.doesjitgobrrr.com",
        "https://api.isthejitfasteryet.com",
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
    days: int = 30,
    session: AsyncSession = fastapi.Depends(get_session),
) -> JSONResponse:
    result = await session.exec(
        select(BenchmarkRun)
        .order_by(desc(BenchmarkRun.run_date))
        .limit(days * 2)  # Increased to account for multiple machines
    )
    runs = result.all()

    # Build list of all runs grouped by machine
    historical_data_by_machine: dict[str, list[dict[str, Any]]] = {}

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

        run_data: dict[str, Any] = {
            "date": run.run_date.isoformat(),
            "commit": run.commit_hash,
            "python_version": run.python_version,
            "is_jit": run.is_jit,
            "machine": run.machine,
            "directory_name": run.directory_name,
            "created_at": run.created_at.isoformat(),
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

        machine_key = run.machine
        if machine_key not in historical_data_by_machine:
            historical_data_by_machine[machine_key] = []

        historical_data_by_machine[machine_key].append(run_data)

    return JSONResponse(
        content={
            "days": days,
            "machines": historical_data_by_machine,
        },
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


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


def reload_data_task():
    """Background task to reload benchmark data."""
    try:
        result = subprocess.run(
            ["uv", "run", "python", "load_data.py"],
            cwd="/app",
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout
        )
        if result.returncode == 0:
            print("Data reload completed successfully")
            print(result.stdout)
        else:
            print(f"Data reload failed with return code {result.returncode}")
            print(f"STDOUT: {result.stdout}")
            print(f"STDERR: {result.stderr}")
    except subprocess.TimeoutExpired:
        print("Data reload timed out after 5 minutes")
    except Exception as e:
        print(f"Error during data reload: {e}")


@app.post("/api/admin/reload-data")
async def reload_data(
    background_tasks: BackgroundTasks,
    credentials: HTTPAuthorizationCredentials = Security(verify_admin_token),
):
    """Admin endpoint to trigger data reload from GitHub."""
    background_tasks.add_task(reload_data_task)
    return {
        "status": "Data reload triggered",
        "message": "Reload is running in the background",
    }


if __name__ == "__main__":
    import uvicorn
    import os

    # Only enable reload in development
    is_dev = os.getenv("ENVIRONMENT", "production") == "development"

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=is_dev,
        reload_excludes=["data/*", "*.db"] if is_dev else None,
    )
