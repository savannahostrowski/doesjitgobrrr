import asyncio
import os
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
# Filter for benchmark result directories. Pattern: bm-YYYYMMDD-VERSION-HASH[-JIT]
PATTERN = r"bm-(\d{8})-([\d\.a-z\+]+)-([a-f0-9]+)(?:-JIT)?"

# Get GitHub token from environment if available
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")


def get_github_headers() -> dict[str, str]:
    """Get headers for GitHub API requests with optional authentication."""
    headers = {"Accept": "application/vnd.github.v3+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return headers


async def compute_geometric_mean_per_machine(jit_dir: str) -> dict[str, float]:
    """
    Extract per-machine geometric mean speedups from the README.md file.
    Returns a dict mapping machine name to geometric mean ratio.

    The README has sections like:
    linux aarch64 (blueberry)
    ...
    Geometric mean: 1.027x slower

    linux x86_64 (ripley)
    ...
    Geometric mean: 1.005x faster
    """
    async with httpx.AsyncClient() as client:
        try:
            # Get the JIT directory contents to find README.md
            jit_contents = await client.get(
                f"{PYPERF_BENCH_REPO}/contents/results/{jit_dir}",
                headers=get_github_headers(),
            )
            jit_contents.raise_for_status()

            # Find README.md file
            readme_url = None
            for file in jit_contents.json():
                if file["name"].upper() == "README.MD":
                    readme_url = file["download_url"]
                    break

            if not readme_url:
                print(f"Could not find README.md file in {jit_dir}")
                return {}

            # Download and parse the README
            readme_response = await client.get(readme_url)
            readme_response.raise_for_status()
            readme_text = readme_response.text

            # Parse per-machine geometric means
            # Look for pattern: "linux <arch> (machine_name)" followed by "Geometric mean: X.XXXx slower/faster"
            machine_geomeans = {}
            current_machine = None

            for line in readme_text.split("\n"):
                # Match machine header: "linux aarch64 (blueberry)", "darwin arm64 (macbook)", etc.
                # Pattern: <os> <arch> (machine_name)
                machine_match = re.search(r"(?:linux|darwin|windows)\s+[\w_]+\s+\((\w+)\)", line, re.IGNORECASE)
                if machine_match:
                    current_machine = machine_match.group(1)
                    continue

                # Match geometric mean line within a machine section
                if current_machine and "geometric mean:" in line.lower():
                    geomean_match = re.search(r"(\d+\.\d+)x\s+(slower|faster)", line, re.IGNORECASE)
                    if geomean_match:
                        value = float(geomean_match.group(1))
                        direction = geomean_match.group(2).lower()

                        # Convert to ratio (nonjit_time / jit_time)
                        if direction == "slower":
                            ratio = 1.0 - (value - 1.0)
                        else:  # faster
                            ratio = value

                        machine_geomeans[current_machine] = ratio
                        print(f"  {current_machine}: {value}x {direction} -> ratio {ratio:.3f}")
                        current_machine = None  # Reset after finding geomean

            return machine_geomeans

        except Exception as e:
            print(f"Error extracting per-machine geometric means: {e}")
            return {}


async def compute_hpt_comparison(
    interpreter_dir: str, jit_dir: str
) -> dict[str, float] | None:
    """
    Download JSON files for both runs and compute HPT comparison.
    Returns dict with reliability and percentiles, or None if comparison fails.
    """

    def get_valid_file(file: dict[str, Any]) -> bool:
        """Check if the file name matches the expected pattern."""
        return (
            file["name"].endswith(".json")
            and not file["name"].endswith("-vs-base.json")
            and "pystats" not in file["name"]
        )

    async with httpx.AsyncClient() as client:
        # Find JSON files for both runs
        interpreter_json_url = None
        jit_json_url = None

        # Get interpreter JSON file
        interpreter_contents = await client.get(
            f"{PYPERF_BENCH_REPO}/contents/results/{interpreter_dir}",
            headers=get_github_headers(),
        )
        interpreter_contents.raise_for_status()

        for file in interpreter_contents.json():
            if get_valid_file(file):
                interpreter_json_url = file["download_url"]
                break

        # Get JIT JSON file
        jit_contents = await client.get(
            f"{PYPERF_BENCH_REPO}/contents/results/{jit_dir}",
            headers=get_github_headers(),
        )
        jit_contents.raise_for_status()
        for file in jit_contents.json():
            if get_valid_file(file):
                jit_json_url = file["download_url"]
                break

        if not interpreter_json_url or not jit_json_url:
            print("Could not find JSON files for HPT comparison")
            return None

        # Download both JSON files to temporary files
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            interpreter_path = tmp_path / "interpreter.json"
            jit_path = tmp_path / "jit.json"

            # Download interpreter JSON
            interpreter_response = await client.get(interpreter_json_url)
            interpreter_response.raise_for_status()
            interpreter_path.write_text(interpreter_response.text)

            # Download JIT JSON
            jit_response = await client.get(jit_json_url)
            jit_response.raise_for_status()
            jit_path.write_text(jit_response.text)

            # Run HPT comparison
            try:
                report = hpt.make_report(str(interpreter_path), str(jit_path))

                # Parse the report to extract percentiles
                # Report format: "99.83% likely to be slow"
                # "90% likely to have a slowdown of 1.02x"
                # "95% likely to have a slowdown of 1.02x"
                # "99% likely to have a slowdown of 1.03x"

                lines = report.strip().split("\n")
                hpt_data: dict[str, float] = {}

                def extract_value(line: str, pattern: str) -> float | None:
                    """Extract a numeric value from a line using a regex pattern."""
                    match = re.search(pattern, line)
                    return float(match.group(1)) if match else None

                for line in lines:
                    if "Reliability score:" in line:
                        if value := extract_value(line, r"(\d+\.?\d*)%"):
                            hpt_data["reliability"] = value
                    elif "90% likely to have" in line:
                        if value := extract_value(line, r"(\d+\.?\d*)x"):
                            hpt_data["percentile_90"] = value
                    elif "95% likely to have" in line:
                        if value := extract_value(line, r"(\d+\.?\d*)x"):
                            hpt_data["percentile_95"] = value
                    elif "99% likely to have" in line:
                        if value := extract_value(line, r"(\d+\.?\d*)x"):
                            hpt_data["percentile_99"] = value

                print(f"HPT comparison complete: {hpt_data}")
                return hpt_data

            except Exception as e:
                print(f"Error running HPT comparison: {e}")
                return None


async def get_fork_from_directory(
    client: httpx.AsyncClient, dir_name: str
) -> str | None:
    """
    Get the fork name from a benchmark directory by checking the JSON filename.

    Returns the fork name (e.g., "python", "brandtbucher") or None if unable to parse.
    """
    try:
        dir_response = await client.get(
            f"{PYPERF_BENCH_REPO}/contents/results/{dir_name}",
            headers=get_github_headers(),
        )
        dir_response.raise_for_status()
        files = dir_response.json()

        # Find the benchmark JSON file
        json_file = None
        for file in files:
            if (
                file["type"] == "file"
                and file["name"].endswith(".json")
                and "vs-base" not in file["name"]
                and "pystats" not in file["name"]
            ):
                json_file = file
                break

        if not json_file:
            return None

        # Parse fork from filename
        # Format: bm-{date}-{machine}-{arch}-{fork}-{ref}-{version}-{commit}.json
        filename_parts = json_file["name"].split("-")
        if len(filename_parts) >= 6:
            return filename_parts[4]  # The fork is the 5th part (0-indexed: 4)

        return None
    except Exception as e:
        print(f"Error getting fork for {dir_name}: {e}")
        return None


async def fetch_all_benchmark_pairs() -> list[tuple[str, str]]:
    """
    Fetch all complete benchmark pairs (interpreter and JIT) from the repository.
    Only returns pairs where:
    - Both interpreter and JIT runs exist for the same commit
    - Both runs are from the 'python' fork (not other forks like brandtbucher, faster-cpython, etc.)

    Returns list of (interpreter_dir, jit_dir) tuples, sorted by date (oldest first).
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{PYPERF_BENCH_REPO}/contents/results",
            headers=get_github_headers(),
        )
        response.raise_for_status()
        dirs = response.json()

        print(f"Found {len(dirs)} entries in results directory.")

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
                        "interpreter": None,
                        "jit": None,
                        "date": date,
                    }

                if dir["name"].endswith("-JIT"):
                    groups[key]["jit"] = dir["name"]
                else:
                    groups[key]["interpreter"] = dir["name"]

        # Filter to only complete pairs from 'python' fork, sorted by date (oldest first)
        complete_pairs: list[tuple[str, str]] = []
        for key in sorted(groups.keys()):
            group = groups[key]
            if group["interpreter"] and group["jit"]:
                # Check if both directories are from the 'python' fork
                interpreter_fork = await get_fork_from_directory(
                    client, group["interpreter"]
                )
                jit_fork = await get_fork_from_directory(client, group["jit"])

                if interpreter_fork == "python" and jit_fork == "python":
                    complete_pairs.append((group["interpreter"], group["jit"]))
                else:
                    print(
                        f"Skipping pair {group['interpreter']} / {group['jit']} (fork: {interpreter_fork}/{jit_fork}, only ingesting 'python' fork)"
                    )

        print(
            f"Found {len(complete_pairs)} complete benchmark pairs from 'python' fork"
        )
        return complete_pairs


async def load_benchmark_run(
    dir_name: str,
    hpt_data: dict[str, float] | None = None,
    geometric_mean_per_machine: dict[str, float] | None = None,
):
    """Load a benchmark run from the given directory name into the database.

    Args:
        dir_name: The directory name of the benchmark run
        hpt_data: Optional HPT comparison data (only for JIT runs)
        geometric_mean_per_machine: Optional dict mapping machine name to geometric mean speedup (only for JIT runs)

    Note: Fork filtering is done during fetch phase, so this function assumes
    the directory is from the 'python' fork.
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
            contents_url, headers=get_github_headers()
        )
        response.raise_for_status()
        files = response.json()

        # Find ALL benchmark JSON files (not just the first one)
        json_files = []
        for file in files:
            if (
                file["name"].endswith(".json")
                and not file["name"].endswith("-vs-base.json")
                and "pystats" not in file["name"]
            ):
                json_files.append(file)

        if not json_files:
            print(f"No JSON benchmark files found in directory {dir_name}.")
            return

        # Process each JSON file (one per machine)
        for json_file in json_files:
            json_url = json_file["download_url"]
            json_response = await client.get(json_url)
            json_response.raise_for_status()
            benchmark_data = json_response.json()

            machine_match = re.search(r"-([^-]+)-[^-]+-python-", json_file["name"])
            machine = machine_match.group(1) if machine_match else "unknown"

            # Extract longer commit hash from JSON filename
            # Filename format: bm-{date}-{machine}-{arch}-python-{COMMIT_HASH}-{version}-{short_hash}.json
            # The commit hash is typically 20+ characters
            full_commit_hash = commit_hash  # Default to short hash from directory
            hash_match = re.search(r"-python-([a-f0-9]{20,})-", json_file["name"])
            if hash_match:
                full_commit_hash = hash_match.group(1)

            async with async_session_maker() as session:
                # Query by both directory_name and machine (composite unique key)
                existing_result = await session.exec(
                    select(BenchmarkRun).where(
                        BenchmarkRun.directory_name == dir_name,
                        BenchmarkRun.machine == machine
                    )
                )
                existing_run = existing_result.first()

                # If run exists, update it if needed
                if existing_run:
                    needs_update = False

                    # Update commit hash if it's short (< 20 chars) and we have a longer one
                    if len(existing_run.commit_hash) < 20 and len(full_commit_hash) >= 20:
                        print(
                            f"Updating commit hash for {dir_name} ({machine}): {existing_run.commit_hash} → {full_commit_hash}"
                        )
                        existing_run.commit_hash = full_commit_hash
                        needs_update = True

                    # Update geometric mean speedup (get from per-machine dict)
                    # Always update if we have new data, not just when it's None
                    machine_geometric_mean = geometric_mean_per_machine.get(machine) if geometric_mean_per_machine else None
                    if (
                        is_jit
                        and machine_geometric_mean is not None
                        and existing_run.geometric_mean_speedup != machine_geometric_mean
                    ):
                        print(
                            f"Updating geometric mean speedup for existing run {dir_name} ({machine}): {existing_run.geometric_mean_speedup} → {machine_geometric_mean}"
                        )
                        existing_run.geometric_mean_speedup = machine_geometric_mean
                        if hpt_data:
                            existing_run.hpt_reliability = hpt_data.get("reliability")
                            existing_run.hpt_percentile_90 = hpt_data.get("percentile_90")
                            existing_run.hpt_percentile_95 = hpt_data.get("percentile_95")
                            existing_run.hpt_percentile_99 = hpt_data.get("percentile_99")
                        needs_update = True

                    if needs_update:
                        session.add(existing_run)
                        await session.commit()
                        print(f"BenchmarkRun for {dir_name} ({machine}) updated.")
                    else:
                        print(
                            f"BenchmarkRun for {dir_name} ({machine}) already exists in the database."
                        )
                    continue  # Move to next JSON file

                # Get this machine's geometric mean from the per-machine dict
                machine_geometric_mean = geometric_mean_per_machine.get(machine) if geometric_mean_per_machine else None

                benchmark_run = BenchmarkRun(
                    directory_name=dir_name,
                    run_date=run_date,
                    python_version=version,
                    commit_hash=full_commit_hash,
                    is_jit=is_jit,
                    machine=machine,
                    hpt_reliability=hpt_data.get("reliability") if hpt_data else None,
                    hpt_percentile_90=hpt_data.get("percentile_90") if hpt_data else None,
                    hpt_percentile_95=hpt_data.get("percentile_95") if hpt_data else None,
                    hpt_percentile_99=hpt_data.get("percentile_99") if hpt_data else None,
                    geometric_mean_speedup=machine_geometric_mean,
                )
                session.add(benchmark_run)
                await session.flush()  # To get the ID assigned

                if not benchmark_run.id:
                    print(f"Failed to create BenchmarkRun for {dir_name} ({machine}).")
                    continue

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
                print(f"Loaded BenchmarkRun {dir_name} ({machine}) with {len(benchmarks)} benchmarks.")


async def fetch_latest_run():
    """Fetch the latest interpreter run"""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{PYPERF_BENCH_REPO}/contents/results",
            headers=get_github_headers(),
        )
        response.raise_for_status()
        dirs = response.json()

        latest_interpreter = None
        for dir in sorted(dirs, key=lambda d: d["name"], reverse=True):
            if dir["type"] != "dir":
                continue
            match = re.match(PATTERN, dir["name"])
            if match and not dir["name"].endswith("-JIT"):
                latest_interpreter = dir["name"]
                print(f"Latest interpreter benchmark run found: {latest_interpreter}")
                break
        return latest_interpreter


async def main():
    from database import init_db

    await init_db()

    # Fetch all complete benchmark pairs (both interpreter and JIT)
    pairs = await fetch_all_benchmark_pairs()
    if not pairs:
        print("No complete benchmark pairs found.")
        return

    print(f"\nProcessing {len(pairs)} benchmark pairs...")

    for i, (interpreter_dir, jit_dir) in enumerate(pairs, 1):
        print(f"\n[{i}/{len(pairs)}] Processing pair: {interpreter_dir} and {jit_dir}")

        # Load interpreter run first
        print(f"  Loading interpreter run: {interpreter_dir}")
        await load_benchmark_run(interpreter_dir)

        # Compute per-machine geometric mean speedups from README
        print("  Computing per-machine geometric mean speedups...")
        geometric_mean_per_machine = await compute_geometric_mean_per_machine(jit_dir)

        # Compute HPT comparison between interpreter and JIT
        print("  Computing HPT comparison...")
        hpt_data = await compute_hpt_comparison(interpreter_dir, jit_dir)

        # Load JIT run with HPT data and per-machine geometric mean speedups
        print(f"  Loading JIT run: {jit_dir}")
        await load_benchmark_run(
            jit_dir, hpt_data=hpt_data, geometric_mean_per_machine=geometric_mean_per_machine
        )

    print(f"\nCompleted! Processed {len(pairs)} benchmark pairs.")


if __name__ == "__main__":
    asyncio.run(main())
