"""Generate candidate perf-event annotations from recent CPython JIT commits.

Looks at commits to selected JIT/optimizer paths in python/cpython since
the most-recent annotation in api/perf_events.yaml (with a small lookback
floor), groups them into PRs, and prepends new candidates to the YAML so
a PR can be opened for human review.

The schema header above `events:` in the YAML file is preserved verbatim;
only the events block is regenerated. This is intentionally lossy on the
existing entries' formatting since safe_dump rewrites them — that's
acceptable because the diff is reviewed in a PR before merge.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

REPO = "python/cpython"
ROOT = Path(__file__).resolve().parents[2]
YAML_PATH = ROOT / "api" / "perf_events.yaml"

# Files whose changes are most likely to cause visible JIT perf movement.
# Add/trim as the codebase evolves.
WATCHED_PATHS: list[str] = [
    "Tools/jit",
    "Python/optimizer.c",
    "Python/optimizer_bytecodes.c",
    "Python/optimizer_cases.c.h",
    "Python/optimizer_analysis.c",
    "Python/specialize.c",
    "Python/executor_cases.c.h",
    "Include/internal/pycore_optimizer.h",
    "Include/internal/pycore_jit.h",
    "Include/internal/pycore_uops.h",
]

# Look back this many days when there's no prior anchor date to use.
DEFAULT_LOOKBACK_DAYS = 14
# Hard floor on lookback even when prior annotations exist (catches missed runs).
MIN_LOOKBACK_DAYS = 3
# No annotations earlier than this — there's no benchmark data before it,
# so an annotation wouldn't have a chart row to sit on. First day of
# tracked CPython benchmarks across the machines.
EARLIEST_DATE = datetime(2025, 11, 13, tzinfo=timezone.utc)
# CPython uses both `(#143810)` and `(GH-143810)` to mark merge commits.
PR_NUMBER_RE = re.compile(r"\((?:#|GH-)(\d+)\)\s*$", re.MULTILINE | re.IGNORECASE)


def gh_get(path_or_url: str, token: str | None) -> object:
    if path_or_url.startswith("http"):
        url = path_or_url
    else:
        url = f"https://api.github.com{path_or_url}"
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "doesjitgobrrr-annotation-suggester",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def load_existing() -> dict:
    if not YAML_PATH.exists():
        return {"events": []}
    with open(YAML_PATH) as f:
        return yaml.safe_load(f) or {"events": []}


def existing_links(data: dict) -> set[str]:
    return {e.get("link") for e in data.get("events", []) if e.get("link")}


def newest_existing_date(data: dict) -> datetime | None:
    dates: list[datetime] = []
    for e in data.get("events", []):
        d = e.get("date")
        if not d:
            continue
        try:
            dates.append(datetime.fromisoformat(str(d)))
        except ValueError:
            continue
    return max(dates) if dates else None


def fetch_recent_commits(
    since: datetime, paths: list[str], token: str | None
) -> list[dict]:
    """Fetch commits since `since` touching any of `paths`. Dedupes by SHA."""
    seen: dict[str, dict] = {}
    since_iso = since.isoformat().replace("+00:00", "Z")
    for path in paths:
        page = 1
        while True:
            qs = urllib.parse.urlencode(
                {
                    "path": path,
                    "since": since_iso,
                    "per_page": 100,
                    "page": page,
                }
            )
            try:
                commits = gh_get(f"/repos/{REPO}/commits?{qs}", token)
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "replace")[:200]
                print(
                    f"  warn: {path} page={page} {e} body={body}",
                    file=sys.stderr,
                )
                break
            assert isinstance(commits, list)
            if not commits:
                break
            for c in commits:
                sha = c["sha"]
                if sha in seen:
                    continue
                msg = c["commit"]["message"]
                date = c["commit"]["committer"]["date"][:10]
                seen[sha] = {
                    "sha": sha,
                    "message": msg,
                    "date": date,
                    "url": c["html_url"],
                }
            if len(commits) < 100:
                break
            page += 1
    return list(seen.values())


def derive_pr_url(commit: dict) -> str:
    """Return the PR URL parsed from the commit message, else the commit URL."""
    m = PR_NUMBER_RE.search(commit["message"])
    if m:
        return f"https://github.com/{REPO}/pull/{m.group(1)}"
    return commit["url"]


# Leading "gh-NNNN: " or "GH-NNNN: " issue references — when many commits
# share the same issue number the prefix dominates and entries look like
# duplicates. Strip it; the link still points back to the PR.
ISSUE_PREFIX_RE = re.compile(r"^(?:gh|GH)-+\d+:\s*", re.IGNORECASE)


def title_from(commit: dict) -> str:
    first = commit["message"].split("\n", 1)[0]
    # strip trailing "(#12345)" reference and leading "gh-NNNN:" issue ref
    cleaned = PR_NUMBER_RE.sub("", first).strip()
    return ISSUE_PREFIX_RE.sub("", cleaned).strip()


def write_back(data: dict, raw_text: str | None) -> None:
    """Write events back, preserving the original schema-comment header."""
    body_yaml = yaml.safe_dump(
        {"events": data["events"]},
        sort_keys=False,
        default_flow_style=False,
        width=88,
        allow_unicode=True,
    )
    if raw_text:
        lines = raw_text.splitlines()
        events_idx = next(
            (i for i, line in enumerate(lines) if line.startswith("events:")),
            None,
        )
        if events_idx is not None:
            header = "\n".join(lines[:events_idx]).rstrip() + "\n\n"
            YAML_PATH.write_text(header + body_yaml)
            return
    YAML_PATH.write_text(body_yaml)


def main() -> int:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("warn: GITHUB_TOKEN not set — running unauthenticated (rate limited)")

    data = load_existing()
    raw_text = YAML_PATH.read_text() if YAML_PATH.exists() else None
    known = existing_links(data)

    newest = newest_existing_date(data)
    now = datetime.now(timezone.utc)
    if newest:
        # Look back from newest entry, with a min floor to catch overlap.
        anchor = max(
            newest.replace(tzinfo=timezone.utc) - timedelta(days=MIN_LOOKBACK_DAYS),
            now - timedelta(days=DEFAULT_LOOKBACK_DAYS),
        )
    else:
        anchor = now - timedelta(days=DEFAULT_LOOKBACK_DAYS)
    # Allow `--seed` (or SEED=1) to backfill from the earliest data date.
    if "--seed" in sys.argv or os.environ.get("SEED") == "1":
        anchor = EARLIEST_DATE
    # Never look further back than the first day of benchmark data.
    if anchor < EARLIEST_DATE:
        anchor = EARLIEST_DATE

    print(f"Fetching commits since {anchor.isoformat()} for {len(WATCHED_PATHS)} paths…")
    commits = fetch_recent_commits(anchor, WATCHED_PATHS, token)
    print(f"  → {len(commits)} unique commits")

    earliest_iso = EARLIEST_DATE.date().isoformat()
    # Group commits by PR URL — one annotation per PR.
    by_link: dict[str, dict] = {}
    for c in commits:
        if c["date"] < earliest_iso:
            continue
        link = derive_pr_url(c)
        if link in known:
            continue
        # Keep the most recent commit per PR for the date.
        existing = by_link.get(link)
        if existing is None or c["date"] > existing["date"]:
            by_link[link] = c

    if not by_link:
        print("No new annotations to suggest.")
        return 0

    new_events: list[dict] = []
    for link, c in by_link.items():
        title = title_from(c)
        if not title:
            continue
        new_events.append({"date": c["date"], "title": title, "link": link})

    new_events.sort(key=lambda e: e["date"], reverse=True)
    data["events"] = new_events + data.get("events", [])
    write_back(data, raw_text)
    print(f"Added {len(new_events)} candidate annotations.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
