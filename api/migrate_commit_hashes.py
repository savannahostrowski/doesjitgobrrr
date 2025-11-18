"""
Migration script to update short commit hashes to full hashes.

This script fetches the full commit hash from the JSON filename
and updates existing BenchmarkRun records.
"""

import asyncio
import re
import httpx
from sqlmodel import select
from database import async_session_maker
from models import BenchmarkRun

PYPERF_BENCH_REPO = "https://api.github.com/repos/savannahostrowski/pyperf_bench"


async def update_commit_hash(run: BenchmarkRun) -> bool:
    """Update a single BenchmarkRun's commit hash from short to longer hash."""
    # Skip if already looks like a longer hash (>= 20 chars)
    if len(run.commit_hash) >= 20:
        print(f"Skipping {run.directory_name} - already has longer hash")
        return False

    async with httpx.AsyncClient() as client:
        try:
            # Get directory contents
            contents_url = f"{PYPERF_BENCH_REPO}/contents/results/{run.directory_name}"
            response = await client.get(
                contents_url, headers={"Accept": "application/vnd.github.v3+json"}
            )
            response.raise_for_status()
            files = response.json()

            # Find JSON file
            json_file = None
            for file in files:
                if (
                    file["name"].endswith(".json")
                    and not file["name"].endswith("-vs-base.json")
                    and "pystats" not in file["name"]
                ):
                    json_file = file
                    break

            if not json_file:
                print(f"No JSON file found for {run.directory_name}")
                return False

            # Extract longer commit hash from filename
            # Filename format: bm-{date}-{machine}-{arch}-python-{COMMIT_HASH}-{version}-{short_hash}.json
            hash_match = re.search(r"-python-([a-f0-9]{20,})-", json_file["name"])
            if hash_match:
                full_commit_hash = hash_match.group(1)
                print(
                    f"Updating {run.directory_name}: {run.commit_hash} → {full_commit_hash}"
                )
                run.commit_hash = full_commit_hash
                return True
            else:
                print(f"Could not find longer commit hash in filename: {json_file['name']}")
                return False

        except Exception as e:
            print(f"Error updating {run.directory_name}: {e}")
            return False

    return False


async def main():
    async with async_session_maker() as session:
        # Get all benchmark runs
        result = await session.exec(select(BenchmarkRun))
        runs = result.all()

        print(f"Found {len(runs)} benchmark runs to check")

        updated_count = 0
        for i, run in enumerate(runs, 1):
            print(f"\n[{i}/{len(runs)}] Processing {run.directory_name}")
            if await update_commit_hash(run):
                session.add(run)
                updated_count += 1

        if updated_count > 0:
            await session.commit()
            print(f"\n✓ Updated {updated_count} benchmark runs")
        else:
            print("\n✓ No updates needed")


if __name__ == "__main__":
    asyncio.run(main())
