import json
from datetime import datetime

from generate_static_data import (
    compute_benchmark_statistics,
    load_perf_events,
    parse_pyperf_geomean,
    write_static_data,
)


def test_compute_benchmark_statistics_flattens_values():
    result = compute_benchmark_statistics(
        {
            "runs": [
                {"values": [1.0, 2.0]},
                {"values": [3.0]},
            ]
        }
    )

    assert result["mean"] == 2.0
    assert result["median"] == 2.0
    assert result["min_value"] == 1.0
    assert result["max_value"] == 3.0


def test_parse_pyperf_geomean_uses_last_overall_value():
    output = """
Geometric mean: 1.01x faster
Geometric mean: 1.05x slower
"""

    assert parse_pyperf_geomean(output) == 1 / 1.05


def test_load_perf_events_sorts_and_drops_invalid_dates(tmp_path):
    events_path = tmp_path / "perf_events.yaml"
    events_path.write_text(
        """
events:
  - date: 2026-01-01
    title: Older
    link: https://example.com/old
  - date: "2026-13-01"
    title: Bad month
  - date: 2026-05-08
    title: Newest
"""
    )

    events = load_perf_events(events_path)

    assert [event["title"] for event in events] == ["Newest", "Older"]
    assert events[0]["link"] is None


def test_write_static_data_outputs_frontend_contract(tmp_path):
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        """
sources:
  - repo: owner/repo
    owner: Savannah
    owner_email: savannah@example.com
    machines:
      blueberry:
        description: Test box
        os: Linux
        arch: x86_64
        color: "#123456"
"""
    )
    events_path = tmp_path / "perf_events.yaml"
    events_path.write_text("events: []\n")
    out_dir = tmp_path / "data"

    runs = [
        {
            "_source": "owner/repo",
            "date": datetime.now().replace(microsecond=0).isoformat(),
            "commit": "abc123",
            "python_version": "3.15.0",
            "is_jit": False,
            "machine": "blueberry",
            "directory_name": "bm-interpreter",
            "has_tailcall": False,
            "created_at": "2026-01-01T00:00:00",
            "benchmarks": {
                "pidigits": {
                    "mean": 1.0,
                    "median": 1.0,
                    "stddev": 0.0,
                    "min_value": 1.0,
                    "max_value": 1.0,
                }
            },
        },
        {
            "_source": "owner/repo",
            "date": datetime.now().replace(microsecond=0).isoformat(),
            "commit": "abc123",
            "python_version": "3.15.0",
            "is_jit": True,
            "machine": "blueberry",
            "directory_name": "bm-jit",
            "has_tailcall": False,
            "created_at": "2026-01-01T00:00:00",
            "benchmarks": {},
            "speedup": 1.07,
            "hpt": {
                "reliability": 99.0,
                "percentile_90": 1.01,
                "percentile_95": 1.02,
                "percentile_99": 1.03,
            },
        },
    ]

    write_static_data(
        runs,
        sources_path,
        events_path,
        out_dir,
        "2026-01-01T00:00:00Z",
    )

    manifest = json.loads((out_dir / "manifest.json").read_text())
    machines = json.loads((out_dir / "machines.json").read_text())
    summary = json.loads((out_dir / "summary-30.json").read_text())
    all_summary = json.loads((out_dir / "summary-all.json").read_text())
    date_file = out_dir / "runs" / f"{runs[0]['date'].split('T')[0]}.json"
    detail = json.loads(date_file.read_text())

    assert manifest["dates"] == [runs[0]["date"].split("T")[0]]
    assert machines["machines"]["blueberry"]["repo"] == "owner/repo"
    assert summary["machines"]["blueberry"][1]["speedup"] == 1.07
    assert all_summary["days"] == "all"
    assert all_summary["machines"]["blueberry"][1]["speedup"] == 1.07
    assert "_source" not in detail["machines"]["blueberry"][0]
