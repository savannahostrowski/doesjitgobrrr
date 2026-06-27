# 🏎️ does JIT go brrr?

A performance dashboard tracking CPython's JIT vs. Interpreter benchmarks.

View live at [doesjitgobrrr.com](https://doesjitgobrrr.com) or [isthejitfasteryet.com](https://isthejitfasteryet.com).


## Architecture

The dashboard is served by FastAPI Cloud, but the app is operationally static:

- FastAPI serves the built Solid/Vite frontend from `api/static`.
- Benchmark data is generated into JSON files under `frontend/public/data`.
- The frontend reads `/data/*.json` static assets directly. There is no runtime
  database query path.

New benchmark data enters the app through the existing nightly benchmark flow:
`pyperf_bench` finishes its nightly run, triggers this repository's
`Update Dashboard Data` workflow with a `benchmark_completed`
`repository_dispatch`, and this repo appends newly discovered benchmark runs to
the cached static data blob. The workflow then rewrites the public `/data` JSON
files, rebuilds the frontend, copies the build to `api/static`, and deploys the
refreshed static bundle to FastAPI Cloud. After that deployment, a dashboard
refresh revalidates the `/data` files.

## Development

### Prerequisites
- Node.js 20+ (for frontend development)
- Python 3.13+ with uv (for data generation and FastAPI Cloud deploys)

### Local Frontend Development

Generate static data, then run the frontend:

```bash
cd api
uv run python generate_static_data.py --out ../frontend/public/data

cd ../frontend
npm ci
npm run dev
```

For a faster local smoke run with real GitHub data, process only the newest
missing benchmark pairs:

```bash
cd api
uv run python generate_static_data.py --max-pairs 10 --out ../frontend/public/data
```

If you already have `api/.static-data-cache.json` and only need to rewrite the
public static assets from it:

```bash
cd api
uv run python generate_static_data.py --skip-fetch --out ../frontend/public/data
```

## Deployment

Deployment is handled by `.github/workflows/fastapicloud-deploy.yml`:

1. Generate static dashboard data into `frontend/public/data`.
2. Build the Solid/Vite frontend.
3. Copy `frontend/dist` to `api/static`.
4. Deploy the FastAPI app to FastAPI Cloud.

## Data Refresh

Benchmark data is refreshed via GitHub Actions in `.github/workflows/update-data.yml`.
The workflow keeps the existing external trigger: the nightly benchmark workflow
in `pyperf_bench` sends a `benchmark_completed` repository dispatch here when
new results are ready.

The generator restores `api/.static-data-cache.json` from the GitHub Actions
cache, treats it as the appendable source-of-truth blob, skips benchmark
directories already present in that blob, appends newly discovered runs, and
then writes public static JSON:

- `manifest.json` for available dates and metadata
- `machines.json` and `events.json`
- `summary-7.json`, `summary-30.json`, and `summary-all.json` for chart data
- `runs/YYYY-MM-DD.json` for detail pages

Change annotations remain authored in `api/perf_events.yaml`. The static data
generator validates and sorts that YAML on every data refresh or deploy, then
writes it to `/data/events.json` for the chart's Changes toggle. The existing
`Suggest annotations` workflow still opens PRs against `api/perf_events.yaml`;
merging one of those PRs to `main` triggers the normal FastAPI Cloud deploy,
which rebuilds `events.json`.

## Contributing

Want to contribute benchmark data from your own hardware? See [CONTRIBUTING.md](CONTRIBUTING.md) for instructions on adding your machines to the dashboard.

## License

MIT
