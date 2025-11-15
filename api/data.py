import json
from datetime import datetime
import httpx

PYPERF_BENCH_REPO="https:/api.github.com/repos/savannahostrowski/pyperf-bench"
RAW_BASE_URL="https://raw.githubusercontent.com/savannahostrowski/pyperf-bench/main"

async def get_latest_results():
    """Fetch the latest JIT and non-JIT benchmark results
    
    Returns:
        dict: {
            "date": "2024-06-01",
            "commit": "abc1234",
            "jit_results": {...},
            "non_jit_results": {...},
            "comparison": {...}
        }
    """

    async with httpx.AsyncClient() as client:
        # Fetch latest commit info
        response = await client.get(f"{PYPERF_BENCH_REPO}/contents/results",
                                    headers={"Accept": "application/vnd.github.v3+json"}
        )
        response.raise_for_status()
        dirs = response.json()

        # Filter for benchmark 