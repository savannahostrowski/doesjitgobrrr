import statistics
from datetime import datetime
from typing import Any

from sqlalchemy import UniqueConstraint
from sqlmodel import JSON, Column, Field, Relationship, SQLModel  # pyright: ignore[reportUnknownVariableType]


class BenchmarkRun(SQLModel, table=True):
    """Represents a benchmark run with associated metadata and results."""

    __tablename__ = "benchmark_runs"  # pyright: ignore[reportAssignmentType]

    # Composite unique constraint: same directory can have multiple machines
    __table_args__ = (  # pyright: ignore[reportAssignmentType]
        UniqueConstraint("directory_name", "machine", name="uq_directory_machine"),
    )

    id: int | None = Field(default=None, primary_key=True)
    directory_name: str = Field(index=True, nullable=False)
    run_date: datetime = Field(index=True, nullable=False)
    python_version: str = Field(nullable=False)
    commit_hash: str = Field(nullable=False, index=True)
    is_jit: bool = Field(nullable=False, index=True)
    machine: str = Field(nullable=False, index=True)
    created_at: datetime = Field(default_factory=datetime.now, nullable=False)

    # HPT (Hypothesis Testing) data - only populated for JIT runs
    hpt_reliability: float | None = None  # Reliability score (e.g., 99.83%)
    hpt_percentile_90: float | None = None  # 90th percentile speedup/slowdown
    hpt_percentile_95: float | None = None  # 95th percentile speedup/slowdown
    hpt_percentile_99: float | None = None  # 99th percentile speedup/slowdown

    # Geometric mean speedup - only populated for JIT runs (ratio of nonjit/jit)
    # > 1.0 means JIT is faster, < 1.0 means JIT is slower
    geometric_mean_speedup: float | None = None

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
