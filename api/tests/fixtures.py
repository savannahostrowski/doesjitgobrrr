"""Helpers for building model instances in tests."""

from datetime import datetime

from models import BenchmarkRun


def make_run(
    *,
    machine: str = "blueberry",
    is_jit: bool = False,
    run_date: datetime | None = None,
    commit_hash: str = "abc123",
    directory_name: str | None = None,
    geometric_mean_speedup: float | None = None,
    has_tailcall: bool = False,
) -> BenchmarkRun:
    """Build a BenchmarkRun for seeding the test DB.

    Composite unique constraint on (directory_name, machine) requires
    directory_name to be distinct per machine within a test.
    """
    run_date = run_date or datetime(2026, 4, 1)
    directory_name = (
        directory_name
        or f"bm-{run_date.date().isoformat()}-{commit_hash[:7]}"
        f"-{machine}{'-jit' if is_jit else ''}"
    )
    return BenchmarkRun(
        directory_name=directory_name,
        run_date=run_date,
        python_version="3.15.0",
        commit_hash=commit_hash,
        is_jit=is_jit,
        machine=machine,
        has_tailcall=has_tailcall,
        hpt_reliability=0.95 if is_jit else None,
        hpt_percentile_90=1.05 if is_jit else None,
        hpt_percentile_95=1.07 if is_jit else None,
        hpt_percentile_99=1.10 if is_jit else None,
        geometric_mean_speedup=geometric_mean_speedup,
    )
