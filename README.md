# 🏎️ Does JIT Go Brrr?

A performance dashboard tracking Python's JIT compiler performance against non-JIT builds. 

View live at [doesjitgobrrr.com](https://doesjitgobrrr.com) or [isthejitfasteryet.com](https://isthejitfasteryet.com).

## What is this?

This project automatically tracks and visualizes the performance improvements from Python's experimental JIT compiler by running nightly benchmarks on dedicated hardware and displaying the results in an interactive dashboard.

## Development

### Prerequisites
- Node.js 20+
- Python 3.14+
- Docker (optional)

### Local Development

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# Visit http://localhost:5173
```

**Backend:**
```bash
cd api
uv sync
uv run main.py
# API at http://localhost:8000
# API docs at http://localhost:8000/docs
```

### Environment Variables

**Frontend (.env):**
```bash
VITE_API_URL=http://localhost:8000
```

## Deployment

### Docker Images

Pre-built multi-platform images are available on Docker Hub:
- `savannahostrowski/doesjitgobrrr-api:latest`
- `savannahostrowski/doesjitgobrrr-frontend:latest`

### Docker Swarm

The production deployment runs on a 3-node Raspberry Pi 5 cluster with Docker Swarm:

```bash
docker stack deploy --compose-file docker-compose.yml arrakis
```

## Data Loading

Benchmark data is automatically loaded via GitHub Actions via the `update-data.yml` workflow. This fetches benchmark results from [pyperf_bench](https://github.com/savannahostrowski/pyperf_bench), parses the JSON files, and stores them in the SQLite database.

## License

MIT
