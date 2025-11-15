from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
import pathlib
import fastapi
import httpx

from database import init_db


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
async def get_latest_comparison():
    return {
        "date": "2024-06-01",
        "commit": "abc1234",
        "python_version": "3.11.4",
        "jit_run": {
            "directory": "2024-06-01-jit",
            "machine": "blueberry",
        },
        "non_jit_run": {
            "directory": "2024-06-01-non-jit",
            "machine": "blueberry",
        },
        "summary": {
            "total_benchmarks": 25,
            "jit_faster": 20,
            "non_jit_faster": 5,
            "no_change": 0,
            "geometric_mean_speedup": 1.45,
        },
        "benchmarks":[
            {
                "name": "benchmark_1",
                "jit_mean": 0.95,
                "non_jit_mean": 1.20,
                "speedup": 1.26,
                "faster": "JIT",
            },
            {
                "name": "benchmark_2",
                "jit_mean": 2.50,
                "non_jit_mean": 2.80,
                "speedup": 1.12,
                "faster": "JIT",
            },
        ]
    }

@app.get("/api/historical")
async def get_historical_comparison(days: int = 30):
    return {
        "days": days,
        "results":[
            {
                "date": "2024-05-31",
                "commit": "def5678",
                "jit_geometric_mean": 1.38,
                "non_jit_geometric_mean": 1.28,
            },
            {
                "date": "2024-05-30",
                "commit": "ghi9012",
                "jit_geometric_mean": 1.42,
                "non_jit_geometric_mean": 1.32,
            },
        ]
    }

@app.get("/api/benchmarks/{name}/trend")
async def get_benchmark_trend(name: str, days: int = 30):
    return {
        "benchmark_name": name,
        "days": days,
        "jit_trend": [
            {"date": "2024-05-31", "mean": 0.95, "stddev": 0.05},
            {"date": "2024-05-30", "mean": 0.97, "stddev": 0.04},
        ],
        "non_jit_trend": [
            {"date": "2024-05-31", "mean": 1.20, "stddev": 0.06},
            {"date": "2024-05-30", "mean": 1.18, "stddev": 0.05},
        ],
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)