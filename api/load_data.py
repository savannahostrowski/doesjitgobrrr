import asyncio
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from sqlmodel import select

import hpt

from database import async_session_maker
from models import Benchmark, BenchmarkRun, compute_benchmark_statistics

PYPERF_BENCH_REPO = "https://api.github.com/repos/savannahostrowski/pyperf_bench"
RAW_BASE_URL = "https://raw.githubusercontent.com/savannahostrowski/pyperf_bench/main"
# Filter for benchmark result directories
# Pattern: bm-YYYYMMDD-VERSION-HASH[-JIT]
PATTERN = r"bm-(\d{8})-([\d\.a-z\+]+)-([a-f0-9]+)(?:-JIT)?"


async def compute_hpt_comparison(non_jit_dir: str, jit_dir: str) -> dict[str, float] | None:
    """
    Download JSON files for both runs and compute HPT comparison.
    Returns dict with reliability and percentiles, or None if comparison fails.
    """
    async with httpx.AsyncClient() as client:
        # Find JSON files for both runs
        non_jit_json_url = None
        jit_json_url = None

        # Get non-JIT JSON file
        non_jit_contents = await client.get(
            f"{PYPERF_BENCH_REPO}/contents/results/{non_jit_dir}",
            headers={"Accept": "application/vnd.github.v3+json"}
        )
        non_jit_contents.raise_for_status()
        for file in non_jit_contents.json():
            if (file["name"].endswith(".json")
                and not file["name"].endswith("-vs-base.json")
                and "pystats" not in file["name"]):
                non_jit_json_url = file["download_url"]
                break

        # Get JIT JSON file
        jit_contents = await client.get(
            f"{PYPERF_BENCH_REPO}/contents/results/{jit_dir}",
            headers={"Accept": "application/vnd.github.v3+json"}
        )
        jit_contents.raise_for_status()
        for file in jit_contents.json():
            if (file["name"].endswith(".json")
                and not file["name"].endswith("-vs-base.json")
                and "pystats" not in file["name"]):
                jit_json_url = file["download_url"]
                break

        if not non_jit_json_url or not jit_json_url:
            print("Could not find JSON files for HPT comparison")
            return None

        # Download both JSON files to temporary files
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            non_jit_path = tmp_path / "non_jit.json"
            jit_path = tmp_path / "jit.json"

            # Download non-JIT JSON
            non_jit_response = await client.get(non_jit_json_url)
            non_jit_response.raise_for_status()
            non_jit_path.write_text(non_jit_response.text)

            # Download JIT JSON
            jit_response = await client.get(jit_json_url)
            jit_response.raise_for_status()
            jit_path.write_text(jit_response.text)

            # Run HPT comparison (ref=non-jit, head=jit)
            try:
                report = hpt.make_report(str(non_jit_path), str(jit_path))

                # Parse the report to extract percentiles
                # Report format: "99.83% likely to be slow"
                # "90% likely to have a slowdown of 1.02x"
                # "95% likely to have a slowdown of 1.02x"
                # "99% likely to have a slowdown of 1.03x"

                lines = report.strip().split('\n')
                hpt_data = {}

                for line in lines:
                    if 'Reliability score:' in line:
                        # Extract percentage
                        match = re.search(r'(\d+\.?\d*)%', line)
                        if match:
                            hpt_data['reliability'] = float(match.group(1))
                    elif '90% likely to have' in line:
                        match = re.search(r'(\d+\.?\d*)x', line)
                        if match:
                            hpt_data['percentile_90'] = float(match.group(1))
                    elif '95% likely to have' in line:
                        match = re.search(r'(\d+\.?\d*)x', line)
                        if match:
                            hpt_data['percentile_95'] = float(match.group(1))
                    elif '99% likely to have' in line:
                        match = re.search(r'(\d+\.?\d*)x', line)
                        if match:
                            hpt_data['percentile_99'] = float(match.group(1))

                print(f"HPT comparison complete: {hpt_data}")
                return hpt_data

            except Exception as e:
                print(f"Error running HPT comparison: {e}")
                return None


async def fetch_latest_benchmark_pair() -> tuple[str, str] | None:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{PYPERF_BENCH_REPO}/contents/results",
            headers={"Accept": "application/vnd.github.v3+json"},
        )
        response.raise_for_status()
        dirs = response.json()

        print(f"Found {len(dirs)} entries in results directory.")
        for dir in dirs[:5]:
            if dir["type"] == "dir":
                print(f"  Directory: {dir['name']}")

        groups: dict[str, dict[str, Any]] = {}
        for dir in dirs:
            if dir["type"] != "dir":
                continue
            match = re.match(PATTERN, dir["name"])
            if match:
                date, version, commit_hash = match.groups()
                key = f"{date}-{version}-{commit_hash}"

                if key not in groups:
                    groups[key] = {
                        "non_jit": None,
                        "jit": None,
                        "date": date,
                    }

                if dir["name"].endswith("-JIT"):
                    groups[key]["jit"] = dir["name"]
                else:
                    groups[key]["non_jit"] = dir["name"]

        for key in sorted(groups.keys(), reverse=True):
            group = groups[key]
            if group["non_jit"] and group["jit"]:
                print(
                    f"Found latest benchmark pair: {group['non_jit']} and {group['jit']}"
                )
                return group["non_jit"], group["jit"]
        return None


async def load_benchmark_run(dir_name: str, hpt_data: dict[str, float] | None = None):
    """Load a benchmark run from the given directory name into the database.

    Args:
        dir_name: The directory name of the benchmark run
        hpt_data: Optional HPT comparison data (only for JIT runs)
    """
    match = re.match(PATTERN, dir_name)
    if not match:
        print(f"Directory name {dir_name} does not match expected pattern.")
        return
    date_str, version, commit_hash = match.groups()
    run_date = datetime.strptime(date_str, "%Y%m%d")
    is_jit = dir_name.endswith("-JIT")

    async with httpx.AsyncClient() as client:
        contents_url = f"{PYPERF_BENCH_REPO}/contents/results/{dir_name}"
        response = await client.get(
            contents_url, headers={"Accept": "application/vnd.github.v3+json"}
        )
        response.raise_for_status()
        files = response.json()

        json_file = None
        for file in files:
            if (file["name"].endswith(".json")
                and not file["name"].endswith("-vs-base.json")
                and "pystats" not in file["name"]):
                json_file = file
                break
        if not json_file:
            print(f"No JSON benchmark file found in directory {dir_name}.")
            return
        json_url = json_file["download_url"]
        json_response = await client.get(json_url)
        json_response.raise_for_status()
        benchmark_data = json_response.json()

        machine_match = re.search(r"-([^-]+)-[^-]+-python-", json_file["name"])
        machine = machine_match.group(1) if machine_match else "unknown"

        async with async_session_maker() as session:
            result = await session.execute(
                select(BenchmarkRun).where(BenchmarkRun.directory_name == dir_name)
            )
            existing = result.first()
            if existing:
                print(f"BenchmarkRun for {dir_name} already exists in the database.")
                return
            benchmark_run = BenchmarkRun(
                directory_name=dir_name,
                run_date=run_date,
                python_version=version,
                commit_hash=commit_hash,
                is_jit=is_jit,
                machine=machine,
                hpt_reliability=hpt_data.get("reliability") if hpt_data else None,
                hpt_percentile_90=hpt_data.get("percentile_90") if hpt_data else None,
                hpt_percentile_95=hpt_data.get("percentile_95") if hpt_data else None,
                hpt_percentile_99=hpt_data.get("percentile_99") if hpt_data else None,
            )
            session.add(benchmark_run)
            await session.flush()  # To get the ID assigned

            if not benchmark_run.id:
                print(f"Failed to create BenchmarkRun for {dir_name}.")
                return

            benchmarks = benchmark_data.get("benchmarks", [])
            for pyperf_benchmark in benchmarks:
                bench_metadata = pyperf_benchmark.get("metadata", {})
                stats = compute_benchmark_statistics(pyperf_benchmark)

                benchmark = Benchmark(
                    run_id=benchmark_run.id,
                    name=bench_metadata.get("name", "unknown"),
                    mean=stats["mean"],
                    median=stats["median"],
                    stddev=stats["stddev"],
                    min_value=stats["min_value"],
                    max_value=stats["max_value"],
                    raw_data=pyperf_benchmark,
                )
                session.add(benchmark)
            await session.commit()
            print(f"Loaded BenchmarkRun {dir_name} with {len(benchmarks)} benchmarks.")


async def fetch_latest_run():
    """Fetch the latest non-JIT run"""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{PYPERF_BENCH_REPO}/contents/results",
            headers={"Accept": "application/vnd.github.v3+json"},
        )
        response.raise_for_status()
        dirs = response.json()

        latest_non_jit = None
        for dir in sorted(dirs, key=lambda d: d["name"], reverse=True):
            if dir["type"] != "dir":
                continue
            match = re.match(PATTERN, dir["name"])
            if match and not dir["name"].endswith("-JIT"):
                latest_non_jit = dir["name"]
                print(f"Latest non-JIT benchmark run found: {latest_non_jit}")
                break
        return latest_non_jit


async def main():
    from database import init_db

    await init_db()

    # Fetch the latest benchmark pair (non-JIT and JIT)
    pair = await fetch_latest_benchmark_pair()
    if not pair:
        print("No benchmark pair found.")
        return

    non_jit_dir, jit_dir = pair

    # Load non-JIT run first
    print(f"Loading non-JIT run: {non_jit_dir}")
    await load_benchmark_run(non_jit_dir)

    # Compute HPT comparison between non-JIT and JIT
    print(f"Computing HPT comparison between {non_jit_dir} and {jit_dir}")
    hpt_data = await compute_hpt_comparison(non_jit_dir, jit_dir)

    # Load JIT run with HPT data
    print(f"Loading JIT run: {jit_dir}")
    await load_benchmark_run(jit_dir, hpt_data=hpt_data)

    print("Data loaded.")


if __name__ == "__main__":
    asyncio.run(main())
