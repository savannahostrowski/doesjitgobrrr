"""Tests for the annotation suggester. Run with:

uv run --with pyyaml pytest .github/scripts/test_suggest_annotations.py
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

# Make the script importable.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import suggest_annotations as sa  # noqa: E402  # ty: ignore[unresolved-import]


def make_commit(
    *,
    sha: str = "abc123",
    message: str = "JIT: do a thing",
    date: str = "2026-04-15",
    url: str = "https://github.com/python/cpython/commit/abc123",
) -> dict:
    return {"sha": sha, "message": message, "date": date, "url": url}


# ── PR URL derivation ───────────────────────────────────────────────────


class TestDerivePrUrl:
    def test_extracts_hash_pr_reference(self):
        c = make_commit(message="Fix the JIT (#143810)")
        assert sa.derive_pr_url(c) == "https://github.com/python/cpython/pull/143810"

    def test_extracts_gh_pr_reference(self):
        # Same merge format used elsewhere in CPython.
        c = make_commit(message="Fix the JIT (GH-148213)")
        assert sa.derive_pr_url(c) == "https://github.com/python/cpython/pull/148213"

    def test_falls_back_to_commit_url_without_pr_marker(self):
        c = make_commit(message="Direct commit without PR reference")
        assert sa.derive_pr_url(c) == c["url"]

    def test_only_matches_at_end_of_first_line(self):
        # "(#1)" mid-message shouldn't be picked up.
        c = make_commit(message="Note (#1) inline\n\nbody")
        # Falls back since the suffix marker isn't at end-of-line.
        assert sa.derive_pr_url(c) == c["url"]


# ── Title cleaning ──────────────────────────────────────────────────────


class TestTitleFrom:
    def test_strips_trailing_pr_reference(self):
        c = make_commit(message="JIT: optimize foo (#148789)")
        assert sa.title_from(c) == "JIT: optimize foo"

    def test_strips_leading_issue_prefix(self):
        c = make_commit(message="gh-131798: Add `_IS_NONE` to JIT (#148369)")
        assert sa.title_from(c) == "Add `_IS_NONE` to JIT"

    def test_strips_uppercase_gh_prefix(self):
        c = make_commit(message="GH-138245: Boolean guards (GH-143810)")
        assert sa.title_from(c) == "Boolean guards"

    def test_uses_first_line_only(self):
        c = make_commit(message="Title here\n\nLong commit body that should be ignored")
        assert sa.title_from(c) == "Title here"

    def test_handles_no_prefix_no_suffix(self):
        c = make_commit(message="Plain commit message")
        assert sa.title_from(c) == "Plain commit message"


# ── Existing-link dedup helpers ─────────────────────────────────────────


class TestExistingLinks:
    def test_collects_distinct_links(self):
        data = {
            "events": [
                {"link": "https://example.com/a"},
                {"link": "https://example.com/b"},
                {"link": "https://example.com/a"},
            ]
        }
        assert sa.existing_links(data) == {
            "https://example.com/a",
            "https://example.com/b",
        }

    def test_skips_entries_without_link(self):
        data = {"events": [{"title": "no link"}, {"link": None}]}
        assert sa.existing_links(data) == set()

    def test_handles_empty(self):
        assert sa.existing_links({"events": []}) == set()


# ── Newest-date scan ────────────────────────────────────────────────────


class TestNewestExistingDate:
    def test_returns_max_iso_date(self):
        data = {
            "events": [
                {"date": "2026-01-15"},
                {"date": "2026-04-03"},
                {"date": "2026-02-20"},
            ]
        }
        result = sa.newest_existing_date(data)
        assert result == datetime(2026, 4, 3)

    def test_returns_none_when_no_events(self):
        assert sa.newest_existing_date({"events": []}) is None

    def test_skips_unparseable_dates(self):
        data = {"events": [{"date": "not-a-date"}, {"date": "2026-04-03"}]}
        assert sa.newest_existing_date(data) == datetime(2026, 4, 3)


# ── Earliest-date floor ─────────────────────────────────────────────────


class TestEarliestDateConstant:
    def test_is_pre_first_benchmark_run(self):
        # Per project memory, first benchmark data starts 2025-11-13. The
        # floor must be on or before that day so day-of-bench changes can
        # be annotated.
        assert sa.EARLIEST_DATE <= datetime(2025, 11, 13, tzinfo=timezone.utc)
