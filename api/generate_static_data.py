import argparse
import asyncio
import json
import os
import re
import statistics
import subprocess
import tempfile
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import hpt
import httpx
import yaml

PATTERN = r"bm-(\d{8})-([\d\.a-z\+]+)-([a-f0-9]+)(?:-(JIT,TAILCALL|JIT|TAILCALL))?"
MAX_CONCURRENT_PAIRS = 3
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")

EXCLUDED_BENCHMARKS = {
    "aiohttp",
    "asyncio_tcp",
    "asyncio_tcp_ssl",
    "bench_mp_pool",
    "concurrent_imap",
    "deepcopy_reduce",
    "logging_silent",
    "pickle",
    "pickle_dict",
    "pickle_list",
    "unpack_sequence",
    "unpickle",
    "unpickle_list",
}


def github_headers() -> dict[str, str]:
    headers = {"Accept": "application/vnd.github.v3+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return headers


def is_benchmark_json_file(filename: str) -> bool:
    return (
        filename.endswith(".json")
        and not filename.endswith("-vs-base.json")
        and "pystats" not in filename
    )


def parse_run_flags(dir_name: str) -> tuple[bool, bool]:
    is_jit = "JIT" in dir_name.split("-")[-1]
    has_tailcall = "TAILCALL" in dir_name
    return is_jit, has_tailcall


def compute_benchmark_statistics(pyperf_benchmark: dict[str, Any]) -> dict[str, Any]:
    all_values: list[float] = []
    for run in pyperf_benchmark.get("runs", []):
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


def parse_pyperf_geomean(output: str) -> float | None:
    matches = re.findall(r"Geometric mean:\s*(\d+\.\d+)x\s+(faster|slower)", output)
    if not matches:
        return None

    value, direction = matches[-1]
    parsed = float(value)
    return 1.0 / parsed if direction == "slower" else parsed


def utc_timestamp() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_cache(cache_path: Path) -> list[dict[str, Any]]:
    if not cache_path.exists():
        return []

    with cache_path.open() as f:
        cache = json.load(f)

    if cache.get("version") != 1:
        return []
    return [run for run in cache.get("runs", []) if isinstance(run, dict)]


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")


def write_cache(path: Path, runs: list[dict[str, Any]], generated_at: str) -> None:
    write_json(path, {"version": 1, "generated_at": generated_at, "runs": runs})


def public_run(run: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in run.items() if not k.startswith("_")}


def load_machines(sources_path: Path) -> dict[str, Any]:
    with sources_path.open() as f:
        config = yaml.safe_load(f)

    machines: dict[str, Any] = {}
    for source in config["sources"]:
        repo = source.get("repo", "")
        owner = source.get("owner", "")
        owner_email = source.get("owner_email", "")
        for name, info in source.get("machines", {}).items():
            machines[name] = {
                "description": info.get("description", ""),
                "os": info.get("os", ""),
                "arch": info.get("arch", ""),
                "color": info.get("color", "#6b7280"),
                "repo": repo,
                "owner": owner,
                "owner_email": owner_email,
            }
    return machines


def load_perf_events(events_path: Path) -> list[dict[str, Any]]:
    if not events_path.exists():
        return []

    with events_path.open() as f:
        config = yaml.safe_load(f) or {}

    events: list[dict[str, Any]] = []
    for raw in config.get("events") or []:
        if not isinstance(raw, dict):
            continue
        date_value = raw.get("date")
        if hasattr(date_value, "isoformat"):
            date_str = date_value.isoformat()
        else:
            try:
                date_str = (
                    datetime.strptime(str(date_value), "%Y-%m-%d").date().isoformat()
                )
            except (TypeError, ValueError):
                continue

        events.append(
            {
                "date": date_str,
                "title": raw.get("title", ""),
                "link": raw.get("link"),
            }
        )

    return sorted(events, key=lambda e: e["date"], reverse=True)


class StaticDataLoader:
    def __init__(
        self,
        sources_path: Path,
        cached_runs: list[dict[str, Any]],
        cache_path: Path | None = None,
        max_pairs: int | None = None,
    ):
        self._sources_path = sources_path
        self._runs = cached_runs
        self._cache_path = cache_path
        self._max_pairs = max_pairs
        self._client: httpx.AsyncClient
        self._url = ""
        self._fork_filter = "python"
        self._source_repo = ""
        self._dir_contents_cache: dict[str, list[dict[str, Any]]] = {}

    async def run(self) -> list[dict[str, Any]]:
        transport = httpx.AsyncHTTPTransport(retries=3)
        async with httpx.AsyncClient(
            transport=transport,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            timeout=httpx.Timeout(60.0),
        ) as self._client:
            with self._sources_path.open() as f:
                config = yaml.safe_load(f)

            for source in config["sources"]:
                self._url = "https://api.github.com/repos/" + source["repo"]
                self._fork_filter = source.get("fork_filter", "python")
                self._source_repo = source["repo"]
                self._dir_contents_cache.clear()
                print(f"Processing source: {self._source_repo}")
                await self._process_source()

        return self._deduped_runs(self._runs)

    def _processed_dirs(self) -> set[str]:
        runs_by_dir: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for run in self._runs:
            if run.get("_source") == self._source_repo:
                runs_by_dir[run["directory_name"]].append(run)

        processed: set[str] = set()
        for dir_name, runs in runs_by_dir.items():
            jit_runs = [run for run in runs if run.get("is_jit")]
            if not jit_runs or all(run.get("speedup") is not None for run in jit_runs):
                processed.add(dir_name)
        return processed

    async def _process_source(self) -> None:
        pairs = await self._fetch_all_benchmark_pairs()
        if self._max_pairs is not None:
            pairs = [] if self._max_pairs <= 0 else pairs[-self._max_pairs :]
        if not pairs:
            print("No new complete benchmark pairs found.")
            return

        print(f"Processing {len(pairs)} benchmark pairs.")
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_PAIRS)

        async def process_pair(pair_data: tuple[int, tuple[str, str]]) -> None:
            index, (interpreter_dir, jit_dir) = pair_data
            async with semaphore:
                await self._process_pair(interpreter_dir, jit_dir, index, len(pairs))

        await asyncio.gather(
            *[process_pair((index, pair)) for index, pair in enumerate(pairs, 1)]
        )

    async def _get_dir_contents(self, dir_name: str) -> list[dict[str, Any]]:
        if dir_name in self._dir_contents_cache:
            return self._dir_contents_cache[dir_name]

        response = await self._client.get(
            f"{self._url}/contents/results/{dir_name}",
            headers=github_headers(),
        )
        response.raise_for_status()
        contents = response.json()
        self._dir_contents_cache[dir_name] = contents
        return contents

    async def _fetch_all_benchmark_pairs(self) -> list[tuple[str, str]]:
        existing_dirs = self._processed_dirs()
        if existing_dirs:
            print(
                f"Found {len(existing_dirs)} cached directories for {self._source_repo}."
            )

        root_response = await self._client.get(
            f"{self._url}/git/trees/main",
            headers=github_headers(),
        )
        root_response.raise_for_status()
        root_tree = root_response.json()
        results_entry = next(
            (
                entry
                for entry in root_tree["tree"]
                if entry["path"] == "results" and entry["type"] == "tree"
            ),
            None,
        )
        if results_entry is None:
            return []

        response = await self._client.get(
            f"{self._url}/git/trees/{results_entry['sha']}",
            headers=github_headers(),
        )
        response.raise_for_status()
        tree_data = response.json()
        if tree_data.get("truncated"):
            print(
                "WARNING: results tree response was truncated; some entries may be missing."
            )

        groups: dict[str, dict[str, Any]] = {}
        for entry in tree_data["tree"]:
            if entry["type"] != "tree":
                continue
            match = re.match(PATTERN, entry["path"])
            if not match:
                continue

            date_str, version, commit_hash, _ = match.groups()
            is_jit, has_tailcall = parse_run_flags(entry["path"])
            tailcall_key = "tailcall" if has_tailcall else "standard"
            key = f"{date_str}-{version}-{commit_hash}-{tailcall_key}"

            groups.setdefault(
                key,
                {
                    "interpreter": None,
                    "jit": None,
                    "date": date_str,
                    "has_tailcall": has_tailcall,
                },
            )
            groups[key]["jit" if is_jit else "interpreter"] = entry["path"]

        pairs_by_date_and_type: dict[str, dict[str, Any]] = {}
        for group in groups.values():
            if not group["interpreter"] or not group["jit"]:
                continue
            tailcall_type = "tailcall" if group["has_tailcall"] else "standard"
            key = f"{group['date']}-{tailcall_type}"
            if (
                key not in pairs_by_date_and_type
                or group["jit"] > pairs_by_date_and_type[key]["jit"]
            ):
                pairs_by_date_and_type[key] = group

        pairs_to_check: list[dict[str, Any]] = []
        for group in pairs_by_date_and_type.values():
            if group["interpreter"] in existing_dirs and group["jit"] in existing_dirs:
                continue
            pairs_to_check.append(group)

        async def check_pair_fork(group: dict[str, Any]) -> tuple[str, str] | None:
            interpreter_fork, jit_fork = await asyncio.gather(
                self._get_fork_from_directory(group["interpreter"]),
                self._get_fork_from_directory(group["jit"]),
            )
            if interpreter_fork == self._fork_filter and jit_fork == self._fork_filter:
                return (group["interpreter"], group["jit"])

            print(
                f"Skipping pair {group['interpreter']} / {group['jit']} "
                f"(fork: {interpreter_fork}/{jit_fork}, expected: {self._fork_filter})"
            )
            return None

        checked = await asyncio.gather(
            *[check_pair_fork(group) for group in pairs_to_check]
        )
        return sorted(pair for pair in checked if pair is not None)

    async def _get_fork_from_directory(self, dir_name: str) -> str | None:
        try:
            files = await self._get_dir_contents(dir_name)
            json_file = next(
                (
                    file
                    for file in files
                    if file["type"] == "file" and is_benchmark_json_file(file["name"])
                ),
                None,
            )
            if not json_file:
                return None
            parts = json_file["name"].split("-")
            return parts[4] if len(parts) >= 6 else None
        except Exception as exc:
            print(f"Error getting fork for {dir_name}: {exc}")
            return None

    async def _process_pair(
        self,
        interpreter_dir: str,
        jit_dir: str,
        pair_num: int,
        total_pairs: int,
    ) -> None:
        print(f"[{pair_num}/{total_pairs}] Processing {interpreter_dir} and {jit_dir}")
        interpreter_task = self._load_benchmark_run(interpreter_dir)
        geomean_task = self._compute_geometric_mean_per_machine(
            interpreter_dir, jit_dir
        )
        hpt_task = self._compute_hpt_comparison(interpreter_dir, jit_dir)

        results = await asyncio.gather(
            interpreter_task, geomean_task, hpt_task, return_exceptions=True
        )
        for name, result in zip(
            ["interpreter load", "geomean computation", "HPT comparison"], results
        ):
            if isinstance(result, Exception):
                print(f"[{pair_num}/{total_pairs}] {name} failed: {result}")

        geomeans = results[1] if isinstance(results[1], dict) else {}
        hpt_data = results[2] if isinstance(results[2], dict) else None
        try:
            await self._load_benchmark_run(
                jit_dir,
                hpt_data=hpt_data,
                geometric_mean_per_machine=geomeans,
            )
        except Exception as exc:
            print(f"[{pair_num}/{total_pairs}] JIT load failed: {exc}")
        self._write_checkpoint()

    async def _load_benchmark_run(
        self,
        dir_name: str,
        hpt_data: dict[str, float] | None = None,
        geometric_mean_per_machine: dict[str, float] | None = None,
    ) -> None:
        match = re.match(PATTERN, dir_name)
        if not match:
            print(f"Directory name {dir_name} does not match expected pattern.")
            return

        date_str, version, commit_hash, _ = match.groups()
        run_date = datetime.strptime(date_str, "%Y%m%d")
        is_jit, has_tailcall = parse_run_flags(dir_name)

        files = await self._get_dir_contents(dir_name)
        json_files = [file for file in files if is_benchmark_json_file(file["name"])]
        if not json_files:
            print(f"No JSON benchmark files found in {dir_name}.")
            return

        async def download_json(
            json_file: dict[str, Any],
        ) -> tuple[dict[str, Any], dict[str, Any]]:
            response = await self._client.get(json_file["download_url"])
            response.raise_for_status()
            return json_file, response.json()

        downloaded = await asyncio.gather(*[download_json(file) for file in json_files])
        new_runs: list[dict[str, Any]] = []
        for json_file, benchmark_data in downloaded:
            filename = json_file["name"]
            machine_match = re.search(r"-([^-]+)-[^-]+-python-", filename)
            machine = machine_match.group(1) if machine_match else "unknown"

            full_commit_hash = commit_hash
            hash_match = re.search(r"-python-([a-f0-9]{20,})-", filename)
            if hash_match:
                full_commit_hash = hash_match.group(1)

            benchmarks_json = {}
            for pyperf_benchmark in benchmark_data.get("benchmarks", []):
                metadata = pyperf_benchmark.get("metadata", {})
                benchmarks_json[metadata.get("name", "unknown")] = (
                    compute_benchmark_statistics(pyperf_benchmark)
                )

            run: dict[str, Any] = {
                "_source": self._source_repo,
                "date": run_date.isoformat(),
                "commit": full_commit_hash,
                "python_version": version,
                "is_jit": is_jit,
                "machine": machine,
                "directory_name": dir_name,
                "has_tailcall": has_tailcall,
                "created_at": datetime.now().isoformat(),
                "benchmarks": benchmarks_json,
            }

            if is_jit:
                run["hpt"] = {
                    "reliability": hpt_data.get("reliability") if hpt_data else None,
                    "percentile_90": hpt_data.get("percentile_90")
                    if hpt_data
                    else None,
                    "percentile_95": hpt_data.get("percentile_95")
                    if hpt_data
                    else None,
                    "percentile_99": hpt_data.get("percentile_99")
                    if hpt_data
                    else None,
                }
                run["speedup"] = (geometric_mean_per_machine or {}).get(machine)

            new_runs.append(run)

        existing_keys = {
            (run["_source"], run["directory_name"], run["machine"]) for run in new_runs
        }
        self._runs = [
            run
            for run in self._runs
            if (run.get("_source"), run.get("directory_name"), run.get("machine"))
            not in existing_keys
        ]
        self._runs.extend(new_runs)
        print(f"Loaded {len(new_runs)} machine runs from {dir_name}.")

    def _write_checkpoint(self) -> None:
        if self._cache_path is None:
            return
        runs = self._deduped_runs(self._runs)
        write_cache(self._cache_path, runs, utc_timestamp())

    async def _compute_geometric_mean_per_machine(
        self, interpreter_dir: str, jit_dir: str
    ) -> dict[str, float]:
        try:
            jit_files = await self._get_dir_contents(jit_dir)
            machines = []
            for file in jit_files:
                if is_benchmark_json_file(file["name"]):
                    machine_match = re.search(r"-([^-]+)-[^-]+-python-", file["name"])
                    if machine_match:
                        machines.append(machine_match.group(1))

            geomeans: dict[str, float] = {}
            for machine in machines:
                geomean = await self._compute_geomean_with_pyperf(
                    interpreter_dir, jit_dir, machine
                )
                if geomean is not None:
                    geomeans[machine] = geomean
            return geomeans
        except Exception as exc:
            print(f"Error computing geometric means: {exc}")
            return {}

    async def _compute_geomean_with_pyperf(
        self, interpreter_dir: str, jit_dir: str, machine: str
    ) -> float | None:
        try:
            interpreter_files, jit_files = await asyncio.gather(
                self._get_dir_contents(interpreter_dir),
                self._get_dir_contents(jit_dir),
            )
            interpreter_json_url = next(
                (
                    file["download_url"]
                    for file in interpreter_files
                    if is_benchmark_json_file(file["name"])
                    and f"-{machine}-" in file["name"]
                ),
                None,
            )
            jit_json_url = next(
                (
                    file["download_url"]
                    for file in jit_files
                    if is_benchmark_json_file(file["name"])
                    and f"-{machine}-" in file["name"]
                ),
                None,
            )
            if not interpreter_json_url or not jit_json_url:
                return None

            interpreter_response, jit_response = await asyncio.gather(
                self._client.get(interpreter_json_url),
                self._client.get(jit_json_url),
            )
            interpreter_response.raise_for_status()
            jit_response.raise_for_status()

            def filtered_json(raw: str) -> str:
                data = json.loads(raw)
                data["benchmarks"] = [
                    benchmark
                    for benchmark in data.get("benchmarks", [])
                    if benchmark.get("metadata", {}).get("name")
                    not in EXCLUDED_BENCHMARKS
                ]
                return json.dumps(data)

            with (
                tempfile.NamedTemporaryFile(
                    mode="w", suffix=".json", delete=False
                ) as base,
                tempfile.NamedTemporaryFile(
                    mode="w", suffix=".json", delete=False
                ) as head,
            ):
                base.write(filtered_json(interpreter_response.text))
                head.write(filtered_json(jit_response.text))
                base_path = base.name
                head_path = head.name

            try:
                result = subprocess.run(
                    ["pyperf", "compare_to", base_path, head_path],
                    capture_output=True,
                    text=True,
                    timeout=60,
                    check=False,
                )
                return parse_pyperf_geomean(result.stdout)
            finally:
                Path(base_path).unlink(missing_ok=True)
                Path(head_path).unlink(missing_ok=True)
        except Exception as exc:
            print(f"Error computing geomean for {machine}: {exc}")
            return None

    async def _compute_hpt_comparison(
        self, interpreter_dir: str, jit_dir: str
    ) -> dict[str, float] | None:
        try:
            interpreter_files, jit_files = await asyncio.gather(
                self._get_dir_contents(interpreter_dir),
                self._get_dir_contents(jit_dir),
            )
            interpreter_json_url = next(
                (
                    file["download_url"]
                    for file in interpreter_files
                    if is_benchmark_json_file(file["name"])
                ),
                None,
            )
            jit_json_url = next(
                (
                    file["download_url"]
                    for file in jit_files
                    if is_benchmark_json_file(file["name"])
                ),
                None,
            )
            if not interpreter_json_url or not jit_json_url:
                return None

            interpreter_response, jit_response = await asyncio.gather(
                self._client.get(interpreter_json_url),
                self._client.get(jit_json_url),
            )
            interpreter_response.raise_for_status()
            jit_response.raise_for_status()

            with tempfile.TemporaryDirectory() as tmpdir:
                tmp_path = Path(tmpdir)
                interpreter_path = tmp_path / "interpreter.json"
                jit_path = tmp_path / "jit.json"
                interpreter_path.write_text(interpreter_response.text)
                jit_path.write_text(jit_response.text)

                report = hpt.make_report(str(interpreter_path), str(jit_path))
                hpt_data: dict[str, float] = {}
                for line in report.strip().split("\n"):
                    if "Reliability score:" in line:
                        match = re.search(r"(\d+\.?\d*)%", line)
                        if match:
                            hpt_data["reliability"] = float(match.group(1))
                    elif "90% likely to have" in line:
                        match = re.search(r"(\d+\.?\d*)x", line)
                        if match:
                            hpt_data["percentile_90"] = float(match.group(1))
                    elif "95% likely to have" in line:
                        match = re.search(r"(\d+\.?\d*)x", line)
                        if match:
                            hpt_data["percentile_95"] = float(match.group(1))
                    elif "99% likely to have" in line:
                        match = re.search(r"(\d+\.?\d*)x", line)
                        if match:
                            hpt_data["percentile_99"] = float(match.group(1))
                return hpt_data
        except Exception as exc:
            print(f"Error running HPT comparison: {exc}")
            return None

    @staticmethod
    def _deduped_runs(runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        by_key: dict[tuple[Any, Any, Any], dict[str, Any]] = {}
        for run in runs:
            key = (run.get("_source"), run.get("directory_name"), run.get("machine"))
            by_key[key] = run
        return sorted(
            by_key.values(),
            key=lambda run: (
                run.get("date", ""),
                run.get("directory_name", ""),
                run.get("machine", ""),
                run.get("is_jit", False),
            ),
            reverse=True,
        )


def grouped_by_machine(runs: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    machines: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for run in runs:
        machines[run.get("machine", "unknown")].append(public_run(run))
    return dict(sorted(machines.items()))


def summary_run(run: dict[str, Any]) -> dict[str, Any]:
    data = {
        "date": run["date"],
        "commit": run["commit"],
        "python_version": run["python_version"],
        "is_jit": run["is_jit"],
        "machine": run["machine"],
        "directory_name": run["directory_name"],
        "has_tailcall": run["has_tailcall"],
    }
    if run.get("is_jit"):
        data["speedup"] = run.get("speedup")
    return data


def write_static_data(
    runs: list[dict[str, Any]],
    sources_path: Path,
    events_path: Path,
    out_dir: Path,
    generated_at: str,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for existing in out_dir.glob("summary-*.json"):
        existing.unlink()
    runs_dir = out_dir / "runs"
    if runs_dir.exists():
        for existing in runs_dir.glob("*.json"):
            existing.unlink()
    runs_dir.mkdir(parents=True, exist_ok=True)

    machines = load_machines(sources_path)
    events = load_perf_events(events_path)
    write_json(out_dir / "machines.json", {"machines": machines})
    write_json(out_dir / "events.json", {"events": events})

    dates = sorted({run["date"].split("T")[0] for run in runs})
    write_json(
        out_dir / "manifest.json",
        {
            "generated_at": generated_at,
            "dates": dates,
        },
    )

    today = date.today()
    for days in (7, 30):
        cutoff = today - timedelta(days=days)
        summary_runs = [
            summary_run(run)
            for run in runs
            if datetime.fromisoformat(run["date"]).date() >= cutoff
        ]
        write_json(
            out_dir / f"summary-{days}.json",
            {"days": days, "machines": grouped_by_machine(summary_runs)},
        )

    write_json(
        out_dir / "summary-all.json",
        {
            "days": "all",
            "machines": grouped_by_machine([summary_run(run) for run in runs]),
        },
    )

    runs_by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for run in runs:
        runs_by_date[run["date"].split("T")[0]].append(run)

    for date_str, date_runs in runs_by_date.items():
        write_json(
            runs_dir / f"{date_str}.json",
            {"date": date_str, "machines": grouped_by_machine(date_runs)},
        )


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", type=Path, default=Path("sources.yaml"))
    parser.add_argument("--events", type=Path, default=Path("perf_events.yaml"))
    parser.add_argument("--out", type=Path, default=Path("../frontend/public/data"))
    parser.add_argument("--cache", type=Path, default=Path(".static-data-cache.json"))
    parser.add_argument(
        "--max-pairs",
        type=int,
        default=None,
        help="Process only the newest N missing benchmark pairs. Useful for local smoke runs.",
    )
    parser.add_argument(
        "--skip-fetch",
        action="store_true",
        help="Only rewrite public static JSON from the existing cache blob.",
    )
    args = parser.parse_args()

    generated_at = utc_timestamp()
    cached_runs = load_cache(args.cache)
    if args.skip_fetch:
        runs = StaticDataLoader._deduped_runs(cached_runs)
    else:
        loader = StaticDataLoader(
            args.sources,
            cached_runs,
            cache_path=args.cache,
            max_pairs=args.max_pairs,
        )
        runs = await loader.run()

    write_static_data(runs, args.sources, args.events, args.out, generated_at)
    write_cache(args.cache, runs, generated_at)
    print(f"Wrote {len(runs)} runs to {args.out}")


if __name__ == "__main__":
    asyncio.run(main())
