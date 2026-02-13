## Adding a new benchmark machine

> **Note:** This template is for contributing new benchmark machines. If your PR is for something else (bug fix, docs, etc.), feel free to clear this template and describe your changes instead.

### Nightly workflow run
<!-- Link to a successful run of your nightly benchmark job -->

### Contact
- **Discord handle:** <!-- Optional but appreciated! So I can reach you quickly about results or issues -->

### Hardware and environment checklist
- [ ] This machine is dedicated to running benchmarks (not a shared workstation, CI runner, etc.)
- [ ] I have taken steps to minimize system noise (disabled unnecessary services, background updates, turbo boost/frequency scaling where possible)
- [ ] Benchmarks are run using [bench_runner](https://github.com/faster-cpython/bench_runner) and results follow the expected directory naming convention
- [ ] My nightly workflow reads from [commit.txt](https://github.com/savannahostrowski/pyperf_bench/blob/main/commit.txt) to benchmark the same CPython commit as other machines
- [ ] I have at least a few days of benchmark results in my results repo

### Maintenance commitment
- [ ] I commit to keeping this machine running nightly benchmarks and investigating anomalous results
- [ ] I understand that machines may be removed from the dashboard if they are consistently offline or producing unreliable data without communication
