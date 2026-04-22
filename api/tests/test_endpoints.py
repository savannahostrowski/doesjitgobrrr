"""API endpoint tests against a real Postgres database.

Every endpoint test seeds rows via `db_session`, then makes HTTP requests
via `client` (httpx.AsyncClient through ASGI transport). `db_session`
cleans up all rows at teardown.
"""

import pathlib
from datetime import datetime, timedelta

import pytest

from tests.fixtures import make_run


API_ROOT = pathlib.Path(__file__).resolve().parent.parent
STATIC_DIR = API_ROOT / "static"


class TestHealthCheck:
    async def test_returns_ok(self, client):
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


class TestMachines:
    async def test_returns_machines_dict(self, client):
        """Loads from sources.yaml (real filesystem, no DB)."""
        response = await client.get("/api/machines")
        assert response.status_code == 200
        data = response.json()
        assert "machines" in data
        assert len(data["machines"]) > 0, "sources.yaml must define machines"

    async def test_machine_entries_have_expected_shape(self, client):
        response = await client.get("/api/machines")
        machines = response.json()["machines"]
        assert len(machines) > 0
        first = next(iter(machines.values()))
        for key in ("description", "os", "arch", "color", "repo", "owner"):
            assert key in first, f"missing field {key}"

    async def test_sets_cache_headers(self, client):
        response = await client.get("/api/machines")
        assert "max-age=300" in response.headers.get("cache-control", "")


class TestLatest:
    async def test_returns_error_when_no_runs(self, client, db_session):
        response = await client.get("/api/latest")
        assert response.status_code == 200
        assert response.json() == {"error": "No benchmark runs found."}

    async def test_returns_run_data(self, client, db_session):
        db_session.add(make_run())
        await db_session.commit()

        response = await client.get("/api/latest")
        assert response.status_code == 200
        data = response.json()
        assert data["commit"] == "abc123"
        assert data["python_version"] == "3.15.0"
        assert "benchmarks" in data


class TestHistoricalSummary:
    async def test_returns_empty_when_no_runs(self, client, db_session):
        response = await client.get("/api/historical/summary")
        assert response.status_code == 200
        assert response.json() == {"days": 30, "machines": {}}

    async def test_respects_days_query_param(self, client, db_session):
        response = await client.get("/api/historical/summary?days=7")
        assert response.status_code == 200
        assert response.json()["days"] == 7

    async def test_groups_by_machine(self, client, db_session):
        db_session.add_all(
            [
                make_run(machine="blueberry", is_jit=False),
                make_run(machine="blueberry", is_jit=True, geometric_mean_speedup=1.07),
                make_run(machine="ripley", is_jit=False),
            ]
        )
        await db_session.commit()

        response = await client.get("/api/historical/summary")
        machines = response.json()["machines"]
        assert set(machines.keys()) == {"blueberry", "ripley"}
        blueberry_jit = next(r for r in machines["blueberry"] if r["is_jit"])
        assert blueberry_jit["speedup"] == 1.07

    async def test_respects_cutoff_date(self, client, db_session):
        """Runs older than the cutoff should not appear in the summary."""
        recent = datetime.now() - timedelta(days=5)
        old = datetime.now() - timedelta(days=100)
        db_session.add_all(
            [
                make_run(run_date=recent, directory_name="recent", commit_hash="aaa"),
                make_run(run_date=old, directory_name="old", commit_hash="bbb"),
            ]
        )
        await db_session.commit()

        response = await client.get("/api/historical/summary?days=30")
        machines = response.json()["machines"]
        all_dirs = [r["directory_name"] for runs in machines.values() for r in runs]
        assert "recent" in all_dirs
        assert "old" not in all_dirs

    async def test_sets_cache_headers(self, client):
        response = await client.get("/api/historical/summary")
        assert "max-age=300" in response.headers.get("cache-control", "")


class TestHistoricalByDate:
    async def test_rejects_invalid_date_format(self, client):
        response = await client.get("/api/historical/date/not-a-date")
        assert response.status_code == 400
        assert "Invalid date format" in response.json()["detail"]

    async def test_accepts_valid_date(self, client, db_session):
        response = await client.get("/api/historical/date/2026-04-01")
        assert response.status_code == 200
        assert response.json()["date"] == "2026-04-01"

    async def test_returns_only_runs_for_that_date(self, client, db_session):
        db_session.add_all(
            [
                make_run(
                    run_date=datetime(2026, 4, 1),
                    directory_name="d1",
                    commit_hash="aaa",
                ),
                make_run(
                    run_date=datetime(2026, 4, 2),
                    directory_name="d2",
                    commit_hash="bbb",
                ),
            ]
        )
        await db_session.commit()

        response = await client.get("/api/historical/date/2026-04-01")
        machines = response.json()["machines"]
        all_dirs = [r["directory_name"] for runs in machines.values() for r in runs]
        assert all_dirs == ["d1"]


class TestHistorical:
    """Bare /api/historical endpoint — distinct from /summary and /date/{date}."""

    async def test_returns_empty_when_no_runs(self, client, db_session):
        response = await client.get("/api/historical")
        assert response.status_code == 200
        assert response.json() == {"days": 30, "machines": {}}

    async def test_includes_benchmark_details(self, client, db_session):
        db_session.add(make_run())
        await db_session.commit()

        response = await client.get("/api/historical")
        machine_data = response.json()["machines"]["blueberry"][0]
        assert "benchmarks" in machine_data


class TestBenchmarkTrend:
    async def test_returns_trend_shape(self, client, db_session):
        response = await client.get("/api/benchmarks/pidigits/trend")
        assert response.status_code == 200
        data = response.json()
        assert data["benchmark_name"] == "pidigits"
        assert data["days"] == 30
        assert data["trend"] == []


class TestSpaFallback:
    @pytest.mark.skipif(
        not STATIC_DIR.exists(),
        reason="SPA fallback route only registered when api/static exists "
        "(frontend build step populates it)",
    )
    async def test_unknown_route_serves_index_html(self, client):
        response = await client.get("/some-frontend-only-route")
        assert response.status_code == 200
