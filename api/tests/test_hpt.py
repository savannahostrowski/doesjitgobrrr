"""Unit tests for pure statistical functions in hpt.py."""

import numpy as np
import pytest

from hpt import (
    cdfnorm,
    create_matrices,
    get_rank,
    get_ranksum,
    hpt_basic,
    load_data,
    qnorm,
    ranksum_table,
)


class TestQnorm:
    def test_at_half_returns_zero(self):
        assert qnorm(0.5) == 0.0

    def test_rejects_zero(self):
        with pytest.raises(ValueError):
            qnorm(0.0)

    def test_rejects_one(self):
        with pytest.raises(ValueError):
            qnorm(1.0)

    def test_is_approximately_symmetric(self):
        # qnorm is the inverse CDF of the standard normal; it's odd-symmetric
        # around p=0.5 (z(p) = -z(1-p)).
        assert qnorm(0.1) == pytest.approx(-qnorm(0.9), rel=1e-3)
        assert qnorm(0.25) == pytest.approx(-qnorm(0.75), rel=1e-3)


class TestCdfnorm:
    def test_at_zero_is_half(self):
        assert cdfnorm(0.0) == pytest.approx(0.5, abs=1e-3)

    def test_symmetric_around_zero(self):
        # CDF(-x) + CDF(x) = 1 for a symmetric distribution.
        assert cdfnorm(1.0) + cdfnorm(-1.0) == pytest.approx(1.0, abs=1e-3)
        assert cdfnorm(2.5) + cdfnorm(-2.5) == pytest.approx(1.0, abs=1e-3)


class TestRanksumTable:
    def test_rejects_n_below_12(self):
        with pytest.raises(ValueError):
            ranksum_table(11, 0.1)

    def test_bounds_straddle_mean(self):
        # Bounds are mu ± q*stddev. With alpha < 0.5, q is negative, so
        # the first value is larger (mu - q*stddev) than the second
        # (mu + q*stddev). Either way, they must sum to 2 * mu.
        n = 20
        lower, upper = ranksum_table(n, 0.1)
        mu = n * (n * 2.0 + 1) / 2.0
        assert lower + upper == pytest.approx(2 * mu, rel=1e-9)
        assert lower != upper


class TestGetRank:
    def test_strictly_increasing(self):
        x = np.array([1.0, 2.0, 3.0, 4.0])
        rank, rep = get_rank(x)
        assert rank.tolist() == [1, 2, 3, 4]
        assert rep.tolist() == [1, 1, 1, 1]

    def test_handles_ties(self):
        x = np.array([1.0, 2.0, 2.0, 3.0])
        _rank, rep = get_rank(x)
        # Both 2.0 values share rep=2 (they're "same" as each other).
        assert rep.tolist() == [1, 2, 2, 1]


class TestGetRanksum:
    def test_sum_of_ranks_no_reps(self):
        rank = np.array([1, 2, 3, 4], dtype=np.int64)
        rep = np.array([1, 1, 1, 1], dtype=np.int64)
        # Formula: sum(rank + (rep - 1) // 2) = 1+2+3+4 + 0 = 10
        assert get_ranksum(rank, rep) == 10


class TestCreateMatrices:
    def test_intersection_only(self):
        a = {"bench1": np.array([1.0]), "bench2": np.array([2.0])}
        b = {"bench2": np.array([3.0]), "bench3": np.array([4.0])}
        mat_a, mat_b = create_matrices(a, b)
        assert set(mat_a.keys()) == {"bench2"}
        assert set(mat_b.keys()) == {"bench2"}

    def test_honors_excluded(self):
        a = {"bench1": np.array([1.0]), "bench2": np.array([2.0])}
        b = {"bench1": np.array([1.0]), "bench2": np.array([2.0])}
        mat_a, _ = create_matrices(a, b, excluded_benchmarks={"bench1"})
        assert set(mat_a.keys()) == {"bench2"}

    def test_empty_when_no_overlap(self):
        a = {"bench1": np.array([1.0])}
        b = {"bench2": np.array([2.0])}
        mat_a, mat_b = create_matrices(a, b)
        assert mat_a == {}
        assert mat_b == {}


class TestLoadData:
    def test_concatenates_values_across_runs(self):
        data = {
            "metadata": {"name": "overall"},
            "benchmarks": [
                {
                    "metadata": {"name": "bench1"},
                    "runs": [
                        {"values": [1.0, 2.0]},
                        {"values": [3.0]},
                    ],
                }
            ],
        }
        result = load_data(data)
        assert "bench1" in result
        assert result["bench1"].tolist() == [1.0, 2.0, 3.0]

    def test_falls_back_to_top_level_name(self):
        # When benchmark has no metadata.name, uses the top-level one.
        data = {
            "metadata": {"name": "top_name"},
            "benchmarks": [{"runs": [{"values": [1.0]}]}],
        }
        result = load_data(data)
        assert "top_name" in result


class TestHptBasic:
    """Integration smoke test for the full HPT pipeline.

    hpt_basic is what users actually call — it combines qnorm, cdfnorm,
    ranksum_table, get_rank, unibench, and crossbench. If any building
    block breaks, this catches it.
    """

    def _aligned_pair(
        self, a_vals: list[float], b_vals: list[float]
    ) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
        # Need ≥ 12 samples per side for ranksum_table. Produce three
        # benchmarks of 24 samples (12 in each half) to satisfy the checker.
        names = ["bench1", "bench2", "bench3"]
        return (
            {name: np.array(a_vals, dtype=np.float64) for name in names},
            {name: np.array(b_vals, dtype=np.float64) for name in names},
        )

    def test_returns_three_floats(self):
        mtx_a, mtx_b = self._aligned_pair([1.0] * 12, [2.0] * 12)
        cdf, wp, wn = hpt_basic(mtx_a, mtx_b, alpha=0.1)
        assert 0.0 <= cdf <= 1.0
        assert isinstance(wp, float)
        assert isinstance(wn, float)

    def test_identical_distributions_are_tied(self):
        # Same data on both sides: the signed-rank statistic is symmetric,
        # so wp == wn (no directional winner). Actual values are nonzero
        # because tied-zero contributions still show up in both sides.
        mtx_a, mtx_b = self._aligned_pair([1.0] * 12, [1.0] * 12)
        _, wp, wn = hpt_basic(mtx_a, mtx_b, alpha=0.1)
        assert wp == wn
