import json

import main


class TestHealthCheck:
    async def test_returns_ok(self, client):
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


class TestMetrics:
    async def test_reports_deployed_data_freshness_and_completeness(
        self, client, tmp_path, monkeypatch
    ):
        data_dir = tmp_path / "data"
        runs_dir = data_dir / "runs"
        runs_dir.mkdir(parents=True)
        (data_dir / "manifest.json").write_text(
            json.dumps(
                {
                    "generated_at": "2026-07-26T15:54:12Z",
                    "dates": ["2026-07-24", "2026-07-25"],
                }
            )
        )
        (runs_dir / "2026-07-25.json").write_text(
            json.dumps(
                {
                    "date": "2026-07-25",
                    "machines": {
                        "blueberry": [],
                        "jones": [],
                        "ripley": [],
                    },
                }
            )
        )
        monkeypatch.setattr(main, "STATIC_DIR", tmp_path)

        response = await client.get("/metrics")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/plain")
        assert (
            "doesjitgobrrr_data_generated_timestamp_seconds 1785081252.0"
            in response.text
        )
        assert (
            "doesjitgobrrr_latest_benchmark_timestamp_seconds 1784937600.0"
            in response.text
        )
        assert "doesjitgobrrr_benchmark_dates_total 2" in response.text
        assert (
            'doesjitgobrrr_latest_benchmark_machine_present{machine="blueberry"} 1'
            in response.text
        )
        assert (
            'doesjitgobrrr_latest_benchmark_machine_present{machine="prometheus"} 0'
            in response.text
        )
