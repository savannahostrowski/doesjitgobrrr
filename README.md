# 🏎️ Does JIT Go Brrr?

A performance dashboard tracking Python's JIT compiler performance against non-JIT builds. 

View live at [doesjitgobrrr.com](https://doesjitgobrrr.com) or [isthejitfasteryet.com](https://isthejitfasteryet.com).

## What is this?

This project automatically tracks and visualizes the performance improvements from Python's experimental JIT compiler by running nightly benchmarks on dedicated hardware and displaying the results in an interactive dashboard.

## Development

### Prerequisites
- Docker and Docker Compose
- Node.js 20+ (for frontend development)
- Python 3.13+ with uv (for API development)

### Local Development with Docker Compose

The easiest way to run the full stack locally:

```bash
# Start all services (PostgreSQL, API, Frontend)
docker-compose -f docker-compose.dev.yml up
```

## Deployment

### Docker Images

Pre-built multi-platform images are available on Docker Hub:
- `savannahostrowski/doesjitgobrrr-api:latest`
- `savannahostrowski/doesjitgobrrr-frontend:latest`

## Data Loading

Benchmark data is automatically loaded via GitHub Actions via the `update-data.yml` workflow. This fetches benchmark results from [pyperf_bench](https://github.com/savannahostrowski/pyperf_bench), parses the JSON files, and stores them in the SQLite database.

## License

MIT
