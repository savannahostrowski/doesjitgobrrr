# Contributing Benchmark Runners

Want to contribute benchmark data from your own hardware? You can add your machines to the dashboard by opening a PR that updates `api/sources.yaml`.

## Preamble

Benchmarks are run using [bench_runner](https://github.com/faster-cpython/bench_runner), a framework that handles running the [pyperformance](https://github.com/python/pyperformance) benchmark suite on self-hosted GitHub Actions runners. Each runner executes the suite twice per nightly run — once with the standard interpreter and once with the JIT enabled — then the results are compared to compute speedup metrics.

For more details on how the benchmarking infrastructure works, see [this blog post](https://savannah.dev/posts/i-run-a-server-farm-in-my-closet/).

## 1. Set up a self-hosted runner + results repo

Follow the instructions in [faster-cpython/bench_runner](https://github.com/faster-cpython/bench_runner) to set up a self-hosted runner. Your repo needs a `results/` directory containing [pyperformance](https://github.com/python/pyperformance) benchmark output organized in directories matching this naming convention:

```
results/
  bm-YYYYMMDD-<python_version>-<commit_hash>/               # Interpreter run
  bm-YYYYMMDD-<python_version>-<commit_hash>-JIT/           # JIT run
  bm-YYYYMMDD-<python_version>-<commit_hash>-TAILCALL/      # Tailcall run (optional)
  bm-YYYYMMDD-<python_version>-<commit_hash>-JIT,TAILCALL/  # JIT + Tailcall (optional)
```

Each directory should contain one or more pyperf JSON result files (one per machine). The loader pairs interpreter and JIT directories by date/version/commit to compute speedups. If you are contributing a macOS runner, note that tail calls should be enabled in your runs (i.e. we compare tailcall to tailcall + JIT since that's what ships in macOS binaries from python.org).

See [pyperf_bench](https://github.com/savannahostrowski/pyperf_bench) for a working example.

### Which commit to benchmark

To keep all machines benchmarking the same CPython commit each night, [pyperf_bench](https://github.com/savannahostrowski/pyperf_bench) writes to `commit.txt` file daily at 3pm PST (11pm UTC) containing the latest CPython `main` SHA. Your nightly workflow should read this file before starting benchmarks.
This ensures consistent cross-machine comparisons on the dashboard.

## 3. Add your source to `api/sources.yaml`

Add a new entry under `sources` with your repo, contact info, and machine metadata:

```yaml
sources:
  # ... existing sources ...
  - repo: "your-username/your-benchmark-repo"
    owner: "Your Name"
    owner_email: "you@example.com"
    fork_filter: "python"  # GitHub fork name used in benchmark runs
    machines:
      my-machine:
        description: "CPU model, RAM, storage"
        os: "Ubuntu 24.04"
        arch: "x86_64"        # or aarch64
        color: "#f59e0b"      # hex color for the chart line
```

Pick a `color` that's visually distinct from the existing machine colors listed in the file, and works well on both light and dark backgrounds.

## 4. Open a PR

Submit your changes and we'll review and merge. Once merged, your machines will appear on the dashboard automatically during the next data load. This typically happens at 6am PST as part of the nightly run in [my own results repo](https://github.com/savannahostrowski/pyperf_bench). 
