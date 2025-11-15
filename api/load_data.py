import asyncio
import re
from datetime import datetime
from typing import Any

import httpx
from sqlmodel import select

from database import async_session_maker
from models import Benchmark, BenchmarkRun, compute_benchmark_statistics

PYPERF_BENCH_REPO="https://api.github.com/repos/savannahostrowski/pyperf_bench"
RAW_BASE_URL="https://raw.githubusercontent.com/savannahostrowski/pyperf_bench/main"
# Filter for benchmark result directories
# Pattern: bm-YYYYMMDD-VERSION-HASH[-JIT]
PATTERN = r"bm-(\d{8})-([\d\.a-z\+]+)-([a-f0-9]+)(?:-JIT)?"

async def fetch_latest_benchmark_pair() -> tuple[str, str] | None:
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{PYPERF_BENCH_REPO}/contents/results",
                                    headers={"Accept": "application/vnd.github.v3+json"}
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
                print(f"Found latest benchmark pair: {group['non_jit']} and {group['jit']}")
                return group["non_jit"], group["jit"]
        return None

async def load_benchmark_run(dir_name: str):
    """Load a benchmark run from the given directory name into the database."""
    match = re.match(PATTERN, dir_name)
    if not match:
        print(f"Directory name {dir_name} does not match expected pattern.")
        return
    date_str, version, commit_hash = match.groups()
    run_date = datetime.strptime(date_str, "%Y%m%d")
    is_jit = dir_name.endswith("-JIT")

    async with httpx.AsyncClient() as client:
        contents_url = f"{PYPERF_BENCH_REPO}/contents/results/{dir_name}"
        response = await client.get(contents_url,
                                    headers={"Accept": "application/vnd.github.v3+json"}
        )
        response.raise_for_status()
        files = response.json()

        json_file = None
        for file in files:
            if file["name"].endswith(".json") and not file["name"].endswith("-vs-base.json"):
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





async def main():
   from database import init_db
   await init_db()
   pair = await fetch_latest_benchmark_pair()
   if not pair:
       print("No benchmark pair found.")
       return
   non_jit_dir, jit_dir = pair
   print(f"Loading non-JIT run: {non_jit_dir}")
   print(f"Loading JIT run: {jit_dir}")
   await load_benchmark_run(non_jit_dir)
   await load_benchmark_run(jit_dir)

   print("Data loaded.")
   


if __name__ == "__main__":
    asyncio.run(main())