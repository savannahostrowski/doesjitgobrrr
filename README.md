# 🏎️ does JIT go brrr?

A performance dashboard tracking CPython's JIT vs. Interpreter benchmarks.

View live at [doesjitgobrrr.com](https://doesjitgobrrr.com) or [isthejitfasteryet.com](https://isthejitfasteryet.com).


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

Benchmark data is automatically loaded via GitHub Actions via the `update-data.yml` workflow. This fetches benchmark results from configured sources, parses the JSON files, and stores them in the PostgreSQL database.

## Contributing

Want to contribute benchmark data from your own hardware? See [CONTRIBUTING.md](CONTRIBUTING.md) for instructions on adding your machines to the dashboard.

## License

MIT
