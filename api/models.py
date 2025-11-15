import statistics
from datetime import datetime
from typing import Any

from sqlmodel import JSON, Column, Field, Relationship, SQLModel


class BenchmarkRun(SQLModel, table=True):
    """Represents a benchmark run with associated metadata and results."""

    __tablename__ = "benchmark_runs"
    id: int | None = Field(default=None, primary_key=True)
    directory_name: str = Field(index=True, nullable=False, unique=True)
    run_date: datetime = Field(index=True, nullable=False)
    python_version: str = Field(nullable=False)
    commit_hash: str = Field(nullable=False, index=True)
    is_jit: bool = Field(nullable=False, index=True)
    machine: str = Field(nullable=False)
    created_at: datetime = Field(default_factory=datetime.now, nullable=False)

    benchmarks: list["Benchmark"] = Relationship(back_populates="benchmark_run")


class Benchmark(SQLModel, table=True):
    """Represents individual benchmark results linked to a BenchmarkRun."""

    id: int | None = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="benchmark_runs.id", nullable=False, index=True)
    name: str = Field(nullable=False, index=True)
    mean: float | None = None
    median: float | None = None
    stddev: float | None = None
    min_value: float | None = None
    max_value: float | None = None
    raw_data: dict[str, Any] = Field(default={}, sa_column=Column(JSON))

    benchmark_run: BenchmarkRun = Relationship(back_populates="benchmarks")


class ComparisonCache(SQLModel, table=True):
    """Caches comparison results between JIT and non-JIT benchmark runs."""

    id: int | None = Field(default=None, primary_key=True)
    jit_run_id: int = Field(foreign_key="benchmark_runs.id", nullable=False, index=True)
    non_jit_run_id: int = Field(
        foreign_key="benchmark_runs.id", nullable=False, index=True
    )
    total_benchmarks: int = Field(nullable=False)
    jit_faster_count: int = Field(nullable=False)
    geometric_mean_speedup: float = Field(nullable=False)
    benchmark_comparisons: dict[str, Any] = Field(default={}, sa_column=Column(JSON))


def compute_benchmark_statistics(pyperf_benchmark: dict[str, Any]) -> dict[str, Any]:
    all_values: list[float] = []
    runs = pyperf_benchmark.get("runs", [])
    for run in runs:
        all_values.extend(run.get("values", []))

    if not all_values:
        return {
            "mean": None,
            "median": None,
            "stddev": None,
            "min_value": None,
            "max_value": None,
        }

    return {
        "mean": statistics.mean(all_values),
        "median": statistics.median(all_values),
        "stddev": statistics.stdev(all_values) if len(all_values) > 1 else 0.0,
        "min_value": min(all_values),
        "max_value": max(all_values),
    }
