import asyncio
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

import hpt
import httpx
from database import async_session_maker, get_github_token, init_db
from models import Benchmark, BenchmarkRun, compute_benchmark_statistics
from sqlmodel import select

PYPERF_BENCH_REPO = "https://api.github.com/repos/savannahostrowski/pyperf_bench"

# Filter for benchmark result directories. Pattern: bm-YYYYMMDD-VERSION-HASH[-JIT][,TAILCALL][-TAILCALL]
# Examples:
#   bm-20251215-3.15.0a2+-bef63d2          (interpreter only)
#   bm-20251215-3.15.0a2+-bef63d2-JIT      (JIT only)
#   bm-20251215-3.15.0a2+-bef63d2-TAILCALL (interpreter + tailcall)
#   bm-20251215-3.15.0a2+-bef63d2-JIT,TAILCALL (JIT + tailcall)
PATTERN = r"bm-(\d{8})-([\d\.a-z\+]+)-([a-f0-9]+)(?:-(JIT,TAILCALL|JIT|TAILCALL))?"

# Get GitHub token from Docker secret or environment variable
GITHUB_TOKEN = get_github_token()

# Limit concurrent pairs (with a GitHub token, 5000 req/hr is plenty)
MAX_CONCURRENT_PAIRS = 10

# Lock for thread-safe printing
print_lock = asyncio.Lock()


async def log(msg: str):
    """Thread-safe logging."""
    async with print_lock:
        print(msg)


def parse_run_flags(dir_name: str) -> tuple[bool, bool]:
    """
    Parse directory name to determine JIT and tailcall flags.
    Returns (is_jit, has_tailcall) tuple.
    """
    is_jit = "JIT" in dir_name.split("-")[-1]
    has_tailcall = "TAILCALL" in dir_name
    return is_jit, has_tailcall


def get_github_headers() -> dict[str, str]:
    """Get headers for GitHub API requests with optional authentication."""
    headers = {"Accept": "application/vnd.github.v3+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return headers


def is_benchmark_json_file(filename: str) -> bool:
    """Check if a filename is a benchmark JSON file (not a comparison or pystats file)."""
    return (
        filename.endswith(".json")
        and not filename.endswith("-vs-base.json")
        and "pystats" not in filename
    )


async def compute_geometric_mean_per_machine(
    client: httpx.AsyncClient, jit_dir: str
) -> dict[str, float]:
    """
    Extract per-machine geometric mean speedups from the README.md file.
    We parse this out because there's a discrepancy between the overall geometric mean
    in the README and the per-machine geometric means computed from the JSON files as a
    result of skipping some benchmarks on some machines. In the future, I'll probably
    fix this discrepancy by ensuring all benchmarks are run on all machines, but for now
    we just extract the per-machine geometric means directly from the README.

    Returns a dict mapping machine name to geometric mean ratio.

    The README has sections like:
    linux aarch64 (blueberry)
    ...
    Geometric mean: 1.027x slower

    linux x86_64 (ripley)
    ...
    Geometric mean: 1.005x faster
    """
    try:
        # Get the JIT directory contents to find README.md
        jit_contents = await client.get(
            f"{PYPERF_BENCH_REPO}/contents/results/{jit_dir}",
            headers=get_github_headers(),
        )
        jit_contents.raise_for_status()

        # Find README.md file
        readme_url: str | None = None
        for file in jit_contents.json():
            if file["name"].upper() == "README.MD":
                readme_url = file["download_url"]
                break

        if not readme_url:
            await log(f"Could not find README.md file in {jit_dir}")
            return {}

        # Download and parse the README
        readme_response = await client.get(readme_url)
        readme_response.raise_for_status()
        readme_text = readme_response.text

        # Parse per-machine geometric means
        # Look for pattern: "linux <arch> (machine_name)" followed by "Geometric mean: X.XXXx slower/faster"
        machine_geomeans: dict[str, float] = {}
        current_machine: str | None = None

        for line in readme_text.split("\n"):
            # Match machine header: "linux aarch64 (blueberry)", "darwin arm64 (macbook)", etc.
            # Pattern: <os> <arch> (machine_name)
            machine_match = re.search(
                r"(?:linux|darwin|windows)\s+[\w_]+\s+\((\w+)\)",
                line,
                re.IGNORECASE,
            )
            if machine_match:
                current_machine = machine_match.group(1)
                continue

            # Match geometric mean line within a machine section
            if current_machine and "geometric mean:" in line.lower():
                geomean_match = re.search(
                    r"(\d+\.\d+)x\s+(slower|faster)", line, re.IGNORECASE
                )
                if geomean_match:
                    value = float(geomean_match.group(1))
                    direction = geomean_match.group(2).lower()

                    # Convert to ratio (nonjit_time / jit_time)
                    if direction == "slower":
                        ratio = 1.0 - (value - 1.0)
                    else:  # faster
                        ratio = value

                    machine_geomeans[current_machine] = ratio
                    current_machine = None  # Reset after finding geomean

        return machine_geomeans

    except Exception as e:
        await log(f"Error extracting per-machine geometric means: {e}")
        return {}


async def compute_hpt_comparison(
    client: httpx.AsyncClient, interpreter_dir: str, jit_dir: str
) -> dict[str, float] | None:
    """
    Download JSON files for both runs and compute HPT comparison.
    Returns dict with reliability and percentiles, or None if comparison fails.
    """
    try:
        # Get directory contents in parallel
        interpreter_contents, jit_contents = await asyncio.gather(
            client.get(
                f"{PYPERF_BENCH_REPO}/contents/results/{interpreter_dir}",
                headers=get_github_headers(),
            ),
            client.get(
                f"{PYPERF_BENCH_REPO}/contents/results/{jit_dir}",
                headers=get_github_headers(),
            ),
        )
        interpreter_contents.raise_for_status()
        jit_contents.raise_for_status()

        # Find JSON file URLs
        interpreter_json_url = None
        jit_json_url = None

        for file in interpreter_contents.json():
            if is_benchmark_json_file(file["name"]):
                interpreter_json_url = file["download_url"]
                break

        for file in jit_contents.json():
            if is_benchmark_json_file(file["name"]):
                jit_json_url = file["download_url"]
                break

        if not interpreter_json_url or not jit_json_url:
            await log("Could not find JSON files for HPT comparison")
            return None

        # Download both JSON files in parallel
        interpreter_response, jit_response = await asyncio.gather(
            client.get(interpreter_json_url),
            client.get(jit_json_url),
        )
        interpreter_response.raise_for_status()
        jit_response.raise_for_status()

        # Write to temporary files and run HPT comparison
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            interpreter_path = tmp_path / "interpreter.json"
            jit_path = tmp_path / "jit.json"

            interpreter_path.write_text(interpreter_response.text)
            jit_path.write_text(jit_response.text)

            report = hpt.make_report(str(interpreter_path), str(jit_path))

            # Parse the report to extract percentiles
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

            return hpt_data

    except Exception as e:
        await log(f"Error running HPT comparison: {e}")
        return None


async def get_fork_from_directory(
    client: httpx.AsyncClient, dir_name: str
) -> str | None:
    """
    Get the fork name from a benchmark directory by checking the JSON filename.
    For this site, we only ingest data from the "python" fork.

    Returns the fork name (e.g., "python", "savannahostrowski") or None if unable to parse.
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
            if file["type"] == "file" and is_benchmark_json_file(file["name"]):
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
        await log(f"Error getting fork for {dir_name}: {e}")
        return None


async def get_existing_directory_names() -> set[str]:
    """Get all directory names already in the database."""
    async with async_session_maker() as session:
        result = await session.exec(select(BenchmarkRun.directory_name).distinct())
        return set(result.all())


async def fetch_all_benchmark_pairs(
    client: httpx.AsyncClient,
    skip_existing: bool = True,
) -> list[tuple[str, str]]:
    """
    Fetch all complete benchmark pairs (interpreter and JIT) from the repository.
    Only returns pairs where:
    - Both interpreter and JIT runs exist for the same commit
    - Both runs are from the 'python' fork (not other forks like savannahostrowski, faster-cpython, etc.)
    - (if skip_existing=True) The pair hasn't already been fully processed

    Returns list of (interpreter_dir, jit_dir) tuples, sorted by date (oldest first).
    """
    # Get existing directories from database to skip already-processed pairs
    existing_dirs: set[str] = set()
    if skip_existing:
        existing_dirs = await get_existing_directory_names()
        await log(f"Found {len(existing_dirs)} existing directories in database.")

    response = await client.get(
        f"{PYPERF_BENCH_REPO}/contents/results",
        headers=get_github_headers(),
    )
    response.raise_for_status()
    dirs = response.json()

    await log(f"Found {len(dirs)} entries in results directory.")

    groups: dict[str, dict[str, Any]] = {}
    for dir in dirs:
        if dir["type"] != "dir":
            continue
        match = re.match(PATTERN, dir["name"])
        if match:
            date, version, commit_hash, _ = match.groups()
            is_jit, has_tailcall = parse_run_flags(dir["name"])

            # Create separate groups for tailcall vs non-tailcall runs
            # This ensures TAILCALL pairs with JIT,TAILCALL, and plain pairs with JIT
            tailcall_key = "tailcall" if has_tailcall else "standard"
            key = f"{date}-{version}-{commit_hash}-{tailcall_key}"

            if key not in groups:
                groups[key] = {
                    "interpreter": None,
                    "jit": None,
                    "date": date,
                    "has_tailcall": has_tailcall,
                }

            if is_jit:
                groups[key]["jit"] = dir["name"]
            else:
                groups[key]["interpreter"] = dir["name"]

    # Filter to only complete pairs from 'python' fork
    # Group by date+tailcall_type and keep only the latest pair per group
    # This allows both standard and tailcall pairs for the same date
    pairs_by_date_and_type: dict[str, dict[str, Any]] = {}
    for key in groups.keys():
        group = groups[key]
        if group["interpreter"] and group["jit"]:
            date = group["date"]
            tailcall_type = "tailcall" if group["has_tailcall"] else "standard"
            date_type_key = f"{date}-{tailcall_type}"
            # Keep the latest pair per date+type (directory names sort chronologically by commit)
            if (
                date_type_key not in pairs_by_date_and_type
                or group["jit"] > pairs_by_date_and_type[date_type_key]["jit"]
            ):
                pairs_by_date_and_type[date_type_key] = group

    # Filter pairs that need processing
    pairs_to_check: list[dict[str, Any]] = []
    skipped_existing = 0
    for date_type_key in sorted(pairs_by_date_and_type.keys()):
        group = pairs_by_date_and_type[date_type_key]
        # Skip if both directories already exist in database
        if (
            skip_existing
            and group["interpreter"] in existing_dirs
            and group["jit"] in existing_dirs
        ):
            skipped_existing += 1
            continue
        pairs_to_check.append(group)

    # Check forks in parallel
    async def check_pair_fork(group: dict[str, Any]) -> tuple[str, str] | None:
        interpreter_fork, jit_fork = await asyncio.gather(
            get_fork_from_directory(client, group["interpreter"]),
            get_fork_from_directory(client, group["jit"]),
        )
        if interpreter_fork == "python" and jit_fork == "python":
            return (group["interpreter"], group["jit"])
        else:
            await log(
                f"Skipping pair {group['interpreter']} / {group['jit']} (fork: {interpreter_fork}/{jit_fork})"
            )
            return None

    # Run fork checks in parallel
    results = await asyncio.gather(*[check_pair_fork(g) for g in pairs_to_check])
    complete_pairs = [r for r in results if r is not None]

    await log(
        f"Found {len(complete_pairs)} new benchmark pairs to process from 'python' fork"
    )
    if skipped_existing > 0:
        await log(f"Skipped {skipped_existing} pairs already in database")
    return complete_pairs


async def load_benchmark_run(
    client: httpx.AsyncClient,
    dir_name: str,
    hpt_data: dict[str, float] | None = None,
    geometric_mean_per_machine: dict[str, float] | None = None,
):
    """Load a benchmark run from the given directory name into the database.

    Args:
        client: Shared HTTP client
        dir_name: The directory name of the benchmark run
        hpt_data: Optional HPT comparison data (only for JIT runs)
        geometric_mean_per_machine: Optional dict mapping machine name to geometric mean speedup (only for JIT runs)

    Note: Fork filtering is done during fetch phase, so this function assumes
    the directory is from the 'python' fork.
    """
    match = re.match(PATTERN, dir_name)
    if not match:
        await log(f"Directory name {dir_name} does not match expected pattern.")
        return
    date_str, version, commit_hash, _ = match.groups()
    run_date = datetime.strptime(date_str, "%Y%m%d")
    is_jit, has_tailcall = parse_run_flags(dir_name)

    contents_url = f"{PYPERF_BENCH_REPO}/contents/results/{dir_name}"
    response = await client.get(contents_url, headers=get_github_headers())
    response.raise_for_status()
    files = response.json()

    # Find ALL benchmark JSON files (one per machine)
    json_files = [f for f in files if is_benchmark_json_file(f["name"])]

    if not json_files:
        await log(f"No JSON benchmark files found in directory {dir_name}.")
        return

    # Download all JSON files in parallel
    async def download_json(
        json_file: dict[str, Any],
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        json_url: str = json_file["download_url"]
        json_response = await client.get(json_url)
        json_response.raise_for_status()
        return json_file, json_response.json()

    downloaded: list[tuple[dict[str, Any], dict[str, Any]]] = await asyncio.gather(
        *[download_json(f) for f in json_files]
    )

    # Process each downloaded file
    for json_file, benchmark_data in downloaded:
        filename: str = json_file["name"]
        machine_match = re.search(r"-([^-]+)-[^-]+-python-", filename)
        machine = machine_match.group(1) if machine_match else "unknown"

        # Extract longer commit hash from JSON filename
        # Filename format: bm-{date}-{machine}-{arch}-python-{COMMIT_HASH}-{version}-{short_hash}.json
        # The commit hash is typically 20+ characters
        full_commit_hash = commit_hash  # Default to short hash from directory
        hash_match = re.search(r"-python-([a-f0-9]{20,})-", filename)
        if hash_match:
            full_commit_hash = hash_match.group(1)

        async with async_session_maker() as session:
            # Check if run already exists
            existing_result = await session.exec(
                select(BenchmarkRun).where(
                    BenchmarkRun.directory_name == dir_name,
                    BenchmarkRun.machine == machine,
                )
            )
            if existing_result.first():
                await log(
                    f"BenchmarkRun for {dir_name} ({machine}) already exists, skipping."
                )
                continue

            # Get this machine's geometric mean from the per-machine dict
            machine_geometric_mean = (geometric_mean_per_machine or {}).get(machine)

            benchmark_run = BenchmarkRun(
                directory_name=dir_name,
                run_date=run_date,
                python_version=version,
                commit_hash=full_commit_hash,
                is_jit=is_jit,
                machine=machine,
                has_tailcall=has_tailcall,
                hpt_reliability=hpt_data.get("reliability") if hpt_data else None,
                hpt_percentile_90=hpt_data.get("percentile_90") if hpt_data else None,
                hpt_percentile_95=hpt_data.get("percentile_95") if hpt_data else None,
                hpt_percentile_99=hpt_data.get("percentile_99") if hpt_data else None,
                geometric_mean_speedup=machine_geometric_mean,
            )
            session.add(benchmark_run)
            await session.flush()  # To get the ID assigned

            if not benchmark_run.id:
                await log(f"Failed to create BenchmarkRun for {dir_name} ({machine}).")
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
            await log(
                f"Loaded BenchmarkRun {dir_name} ({machine}) with {len(benchmarks)} benchmarks."
            )


async def process_pair(
    client: httpx.AsyncClient,
    interpreter_dir: str,
    jit_dir: str,
    pair_num: int,
    total_pairs: int,
):
    """Process a single interpreter/JIT pair."""
    await log(
        f"\n[{pair_num}/{total_pairs}] Processing pair: {interpreter_dir} and {jit_dir}"
    )

    # Run interpreter load, geometric mean extraction, and HPT comparison in parallel
    # (interpreter load doesn't depend on the other two)
    interpreter_task = load_benchmark_run(client, interpreter_dir)
    geomean_task = compute_geometric_mean_per_machine(client, jit_dir)
    hpt_task = compute_hpt_comparison(client, interpreter_dir, jit_dir)

    # Wait for all three to complete
    _, geometric_mean_per_machine, hpt_data = await asyncio.gather(
        interpreter_task, geomean_task, hpt_task
    )

    # Load JIT run with the computed data
    await load_benchmark_run(
        client,
        jit_dir,
        hpt_data=hpt_data,
        geometric_mean_per_machine=geometric_mean_per_machine,
    )


async def main():
    await init_db()

    # Use a single shared HTTP client with connection pooling
    async with httpx.AsyncClient(
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        timeout=httpx.Timeout(60.0),
    ) as client:
        # Fetch all complete benchmark pairs (both interpreter and JIT)
        pairs = await fetch_all_benchmark_pairs(client)
        if not pairs:
            await log("No complete benchmark pairs found.")
            return

        await log(
            f"\nProcessing {len(pairs)} benchmark pairs (max {MAX_CONCURRENT_PAIRS} concurrent)..."
        )

        # Process pairs with limited concurrency using a semaphore
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_PAIRS)

        async def process_with_semaphore(pair_data: tuple[int, tuple[str, str]]):
            i, (interpreter_dir, jit_dir) = pair_data
            async with semaphore:
                await process_pair(client, interpreter_dir, jit_dir, i, len(pairs))

        # Process all pairs concurrently (limited by semaphore)
        await asyncio.gather(
            *[process_with_semaphore((i, pair)) for i, pair in enumerate(pairs, 1)]
        )

    await log(f"\nCompleted! Processed {len(pairs)} benchmark pairs.")


if __name__ == "__main__":
    asyncio.run(main())
