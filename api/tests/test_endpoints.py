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


class TestPerfEvents:
    """Tests for /api/events. The endpoint reads from `PERF_EVENTS_PATH`, so
    we monkeypatch that constant to point at a temp YAML file per test."""

    @pytest.fixture
    def temp_events_file(self, tmp_path, monkeypatch):
        """Returns a callable that writes YAML to a temp file and patches
        `main.PERF_EVENTS_PATH` to point at it."""
        import main as main_mod

        def _write(yaml_text: str) -> pathlib.Path:
            p = tmp_path / "perf_events.yaml"
            p.write_text(yaml_text)
            monkeypatch.setattr(main_mod, "PERF_EVENTS_PATH", p)
            return p

        return _write

    async def test_returns_empty_when_file_missing(self, client, monkeypatch, tmp_path):
        import main as main_mod

        monkeypatch.setattr(
            main_mod, "PERF_EVENTS_PATH", tmp_path / "does-not-exist.yaml"
        )
        response = await client.get("/api/events")
        assert response.status_code == 200
        assert response.json() == {"events": []}

    async def test_returns_empty_when_no_events_key(self, client, temp_events_file):
        temp_events_file("# no events key here\n")
        response = await client.get("/api/events")
        assert response.json() == {"events": []}

    async def test_returns_events_sorted_newest_first(self, client, temp_events_file):
        temp_events_file(
            """
events:
  - date: 2026-01-01
    title: Older
    link: https://example.com/old
  - date: 2026-05-08
    title: Newest
    link: https://example.com/new
  - date: 2026-03-15
    title: Middle
    link: https://example.com/mid
"""
        )
        events = (await client.get("/api/events")).json()["events"]
        assert [e["title"] for e in events] == ["Newest", "Middle", "Older"]

    async def test_event_shape_is_minimal(self, client, temp_events_file):
        temp_events_file(
            """
events:
  - date: 2026-04-03
    title: Bench&nbsp;tail-call
    link: https://example.com/x
"""
        )
        ev = (await client.get("/api/events")).json()["events"][0]
        # Schema is intentionally narrow — only date / title / link.
        assert set(ev.keys()) == {"date", "title", "link"}
        assert ev["date"] == "2026-04-03"
        assert ev["title"] == "Bench&nbsp;tail-call"
        assert ev["link"] == "https://example.com/x"

    async def test_missing_link_becomes_null(self, client, temp_events_file):
        temp_events_file(
            """
events:
  - date: 2026-04-03
    title: No link here
"""
        )
        ev = (await client.get("/api/events")).json()["events"][0]
        assert ev["link"] is None

    async def test_missing_title_becomes_empty_string(self, client, temp_events_file):
        temp_events_file(
            """
events:
  - date: 2026-04-03
    link: https://example.com/x
"""
        )
        ev = (await client.get("/api/events")).json()["events"][0]
        assert ev["title"] == ""

    async def test_sets_cache_headers(self, client, temp_events_file):
        temp_events_file("events: []\n")
        response = await client.get("/api/events")
        assert "max-age=300" in response.headers.get("cache-control", "")

    async def test_drops_invalid_dates(self, client, temp_events_file):
        # Out-of-range / garbage dates are dropped instead of being
        # silently rolled forward by JS Date on the frontend.
        temp_events_file(
            """
events:
  - date: "2026-13-01"
    title: Bad month (rolls to Jan 2027 if not validated)
    link: https://example.com/bad-month
  - date: "2026-02-30"
    title: Bad day (rolls to Mar 2 if not validated)
    link: https://example.com/bad-day
  - date: "not-a-date"
    title: Garbage
    link: https://example.com/garbage
  - date: 2026-04-03
    title: Good entry
    link: https://example.com/good
"""
        )
        events = (await client.get("/api/events")).json()["events"]
        # Only the valid date survives.
        assert len(events) == 1
        assert events[0]["title"] == "Good entry"
        assert events[0]["date"] == "2026-04-03"
