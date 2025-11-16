"""Support for the Hierarchical Performance Testing (HPT) method in this paper:

  T. Chen, Y. Chen, Q. Guo, O. Temam, Y. Wu and W. Hu,
  "Statistical performance comparisons of computers,"
  IEEE International Symposium on High-Performance Comp Architecture,
  New Orleans, LA, USA, 2012, pp. 1-12,
  doi: 10.1109/HPCA.2012.6169043.

This is largely a direct port of the bash implementation available here:

  https://github.com/cirosantilli/parsec-benchmark/tree/master/toolkit/hpt

This approach is a more robust way to measure overall effectiveness across a
number of benchmarks. It is still biased in that the benchmarks should be a
representative sample, but it accounts for the fact that some benchmarks are
more reproducible and reliable than others.

It has been modified so that each benchmark can have a different number of
samples (the original code assumed the matrix was rectangular, but there is
nothing about the method itself that should require that).

Vendored from: https://github.com/faster-cpython/bench_runner/blob/main/bench_runner/hpt.py

"""

from __future__ import annotations


import io
import functools
import json
from pathlib import Path
from typing import Any, Mapping


import numpy as np
from numpy.typing import NDArray

PathLike = str | Path

ACC_MAXSU = 2


def load_from_json(
    json_path: PathLike,
) -> dict[str, NDArray[np.float64]]:
    with Path(json_path).open() as fd:
        content = json.load(fd)

    return load_data(content)


def load_data(data: Mapping[str, Any]) -> dict[str, NDArray[np.float64]]:
    results = {}
    for benchmark in data["benchmarks"]:
        if "metadata" in benchmark:
            name = benchmark["metadata"]["name"]
        else:
            name = data["metadata"]["name"]
        values = []
        for run in benchmark["runs"]:
            values.extend(run.get("values", []))
        results[name] = np.array(values, dtype=np.float64)

    return results


def create_matrices(
    a: Mapping[str, NDArray[np.float64]],
    b: Mapping[str, NDArray[np.float64]],
    excluded_benchmarks: set[str] | None = None,
) -> tuple[dict[str, NDArray[np.float64]], dict[str, NDArray[np.float64]]]:
    """Create aligned matrices from two benchmark datasets."""
    if excluded_benchmarks is None:
        excluded_benchmarks = set()

    benchmarks = sorted(list(set(a.keys()) & set(b.keys())))
    benchmarks = [bm for bm in benchmarks if bm not in excluded_benchmarks]
    return {bm: a[bm] for bm in benchmarks}, {bm: b[bm] for bm in benchmarks}


def qnorm(p: float) -> float:
    """
    quantile function of standard norm distribution
    """

    if p <= 0.0 or p >= 1.0:
        raise ValueError(f"{p} is out of range 0, 1")

    if p == 0.5:
        return 0.0

    y = -np.log(4.0 * p * (1.0 - p))
    b = [
        1.570796288,
        0.03706987906,
        -0.0008364353589,
        -0.0002250947176,
        0.000006841218299,
        0.000005824238515,
        -0.00000104527497,
        0.00000008360937017,
        -0.000000003231081277,
        0.00000000003657763036,
        0.0000000000006936233982,
    ]
    u = 0.0
    pow = 1.0

    for b0 in b:
        pow *= y
        u += pow * b0

    u = np.sqrt(u)
    if p < 0.5:
        u *= -1.0

    return u


def cdfnorm(x: float) -> float:
    """
    an approximation of cumulative density function for standard norm distribution
    """

    a1 = 0.31938153
    a2 = -0.356563728
    a3 = 1.781477937
    a4 = -1.821255978
    a5 = 1.330274429

    L = x

    if L < 0.0:
        L *= -1.0

    K = 1.0 / (1.0 + 0.2316419 * L)
    tmp = ((((a5 * K + a4) * K + a3) * K + a2) * K + a1) * K
    tmp = np.exp(0.0 - L * L / 2.0) * tmp / np.sqrt(2.0 * np.pi)

    if x > 0.0:
        tmp = 1.0 - tmp

    return tmp


@functools.cache
def ranksum_table(n: int, alpha: float) -> tuple[float, float]:
    if n < 12:
        raise ValueError(f"Fewer than 12 samples, got {n}")

    q = qnorm(alpha)
    mu = n * (n * 2.0 + 1) / 2.0
    stddev = np.sqrt((2 * n + 1) / 3) * n / 2
    tmp = q * stddev
    return mu - tmp, mu + tmp


def get_rank(
    gr_x: NDArray[np.float64],
) -> tuple[NDArray[np.int64], NDArray[np.int64]]:
    rank = np.zeros((len(gr_x),), int)
    rep = np.zeros((len(gr_x),), int)

    for i in range(len(gr_x)):
        diff = gr_x - gr_x[i]
        less = np.sum(diff < 0)
        same = np.sum(diff == 0)
        rank[i] = less + 1
        rep[i] = same

    return rank, rep


def get_ranksum(rank: NDArray[np.int64], rep: NDArray[np.int64]) -> np.int64:
    return np.sum(rank + (rep - 1) // 2)


def prepare_one_row(
    por_x: NDArray[np.float64],
) -> tuple[np.int64, np.int64, np.float64, np.float64]:
    n = len(por_x) // 2
    rank, rep = get_rank(por_x)
    wl = get_ranksum(rank[:n], rep[:n])
    wr = get_ranksum(rank[n:], rep[n:])
    ml = np.float64(np.median(por_x[:n]))
    mr = np.float64(np.median(por_x[n:]))

    return wl, wr, ml, mr


def unibench(ub_x: NDArray[np.float64], alpha: float) -> np.float64:
    wl, _, ml, mr = prepare_one_row(ub_x)
    target = float(wl)

    rst_lower, rst_upper = ranksum_table(len(ub_x) // 2, alpha)
    if target <= rst_lower or target >= rst_upper:
        return np.subtract(ml, mr)
    return np.float64(np.nan)


def crossbench(cb_x: NDArray[np.float64]) -> tuple[float, float, float]:
    sign = np.sign(cb_x)
    cb_x[sign < 0] *= -1.0

    cb_rank, cb_rep = get_rank(cb_x)

    positive = sign == 1
    negative = sign == -1
    zero = sign == 0

    wz = np.sum(cb_rank[zero] / 2 + cb_rep[zero] / 4 - 1 / 4)
    wp = np.add(np.sum(cb_rank[positive] + cb_rep[positive] / 2 - 1 / 2), wz)
    wn = np.add(np.sum(cb_rank[negative] + cb_rep[negative] / 2 - 1 / 2), wz)

    n = len(cb_x)

    tmp1 = wp - n * (n + 1) / 4
    tmp2 = np.sqrt(n * (n + 1) * (2 * n + 1) / 24)
    tmp1 = tmp1 / tmp2

    cdf = cdfnorm(tmp1)

    return cdf, float(wp), float(wn)


def hpt_basic(
    mtx_a: Mapping[str, NDArray[np.float64]],
    mtx_b: Mapping[str, NDArray[np.float64]],
    alpha: float,
    multi: float = 1.0,
) -> tuple[float, float, float]:
    assert mtx_a.keys() == mtx_b.keys()

    meddiff = np.zeros((len(mtx_a),), float)

    for i, bm in enumerate(mtx_a.keys()):
        hpt_x = np.hstack((multi * mtx_a[bm], mtx_b[bm]), dtype=np.float64)
        meddiff[i] = unibench(hpt_x, alpha)

    return crossbench(meddiff)


def maxspeedup(
    reli: float,
    better: bool,
    alpha: float,
    mtx_a: Mapping[str, NDArray[np.float64]],
    mtx_b: Mapping[str, NDArray[np.float64]],
) -> float:
    if reli < 0.5:
        raise ValueError(
            f"The reliability value {reli}, which is less than 0.5, "
            "will lead to a meaningless conclusion"
        )

    if better:
        su = 10.0
        ret, _, _ = hpt_basic(mtx_a, mtx_b, alpha, su)
        if ret < 1.0 - reli:
            print("Overflow: the maximum speedup is beyond the upper bound 10")
            return -1.0
        else:
            step = -1
            myscale = 1.0
            minimum = 1
            maximum = 10
            base_su = 0.0
            while step < ACC_MAXSU:
                mid = (maximum - minimum) // 2 + minimum
                su = base_su + myscale * mid
                ret, _, _ = hpt_basic(mtx_a, mtx_b, alpha, su)
                if ret < 1 - reli:
                    minimum = mid
                else:
                    maximum = mid

                if minimum == maximum - 1:
                    base_su += minimum * myscale
                    myscale /= 10.0
                    step += 1
                    minimum = 0
                    maximum = 10

            return base_su
    else:
        su = 10.0
        reci = 1.0 / su
        ret, _, _ = hpt_basic(mtx_a, mtx_b, alpha, reci)
        if ret > reli:
            print("Overflow: the maximum speedup is beyond the upper bound 10")
            return -1
        else:
            step = -1
            myscale = 1.0
            minimum = 1
            maximum = 10
            base_su = 0.0
            while step < ACC_MAXSU:
                mid = (maximum - minimum) // 2 + minimum
                su = base_su + myscale * mid
                reci = 1.0 / su
                ret, _, _ = hpt_basic(mtx_a, mtx_b, alpha, reci)
                if ret > reli:
                    minimum = mid
                else:
                    maximum = mid

                if minimum == maximum - 1:
                    base_su += minimum * myscale
                    myscale /= 10.0
                    step += 1
                    minimum = 0
                    maximum = 10

            return base_su


def make_report(ref: PathLike, head: PathLike, alpha=0.1):
    # The original code inverted the inputs from the standard in bench_runner,
    # and it's easier to just flip them here.
    a, b = head, ref

    result = io.StringIO()

    a_data = load_from_json(a)
    b_data = load_from_json(b)

    mtx_a, mtx_b = create_matrices(a_data, b_data)

    ret, wp, wn = hpt_basic(mtx_a, mtx_b, alpha)

    if wp < wn:
        ret = 1.0 - ret
        relative = "faster"
        effect = "speedup"
        better = True
    else:
        relative = "slow"
        effect = "slowdown"
        better = False

    result.write("# HPT report\n\n")
    result.write(f"- Reliability score: {ret:.2%} likely to be {relative}\n")

    for reli in [0.9, 0.95, 0.99]:
        ret = maxspeedup(reli, better, alpha, mtx_a, mtx_b)
        if ret > 0:
            result.write(f"- {reli:.0%} likely to have a {effect} of {ret:.2f}x\n")

    return result.getvalue()