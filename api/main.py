import json
from datetime import UTC, date, datetime
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.metrics import set_meter_provider
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader


set_meter_provider(
    MeterProvider(metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter())])
)

app = FastAPI()
FastAPIInstrumentor.instrument_app(app)


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


STATIC_DIR = Path(__file__).parent / "static"
MONITORED_MACHINES = ("blueberry", "jones", "prometheus", "ripley")


def _timestamp(value: str) -> float:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.timestamp()


def _date_timestamp(value: str) -> float:
    return datetime.combine(
        date.fromisoformat(value), datetime.min.time(), UTC
    ).timestamp()


@app.get("/metrics", response_class=PlainTextResponse)
async def metrics() -> PlainTextResponse:
    data_dir = STATIC_DIR / "data"
    manifest = json.loads((data_dir / "manifest.json").read_text())
    latest_date = manifest["dates"][-1]
    latest_run = json.loads((data_dir / "runs" / f"{latest_date}.json").read_text())
    present_machines = set(latest_run["machines"])

    lines = [
        "# HELP doesjitgobrrr_data_generated_timestamp_seconds Unix timestamp when the deployed dashboard data was generated.",
        "# TYPE doesjitgobrrr_data_generated_timestamp_seconds gauge",
        f"doesjitgobrrr_data_generated_timestamp_seconds {_timestamp(manifest['generated_at'])}",
        "# HELP doesjitgobrrr_latest_benchmark_timestamp_seconds Unix timestamp of the newest benchmark date in the deployed dashboard data.",
        "# TYPE doesjitgobrrr_latest_benchmark_timestamp_seconds gauge",
        f"doesjitgobrrr_latest_benchmark_timestamp_seconds {_date_timestamp(latest_date)}",
        "# HELP doesjitgobrrr_benchmark_dates_total Number of benchmark dates in the deployed dashboard data.",
        "# TYPE doesjitgobrrr_benchmark_dates_total gauge",
        f"doesjitgobrrr_benchmark_dates_total {len(manifest['dates'])}",
        "# HELP doesjitgobrrr_latest_benchmark_machine_present Whether a monitored "
        "machine has data for the newest benchmark date.",
        "# TYPE doesjitgobrrr_latest_benchmark_machine_present gauge",
    ]
    lines.extend(
        f'doesjitgobrrr_latest_benchmark_machine_present{{machine="{machine}"}} '
        f"{int(machine in present_machines)}"
        for machine in MONITORED_MACHINES
    )
    return PlainTextResponse("\n".join(lines) + "\n")


# FastAPI serves built Vite/Solid assets from api/static. Browser navigation
# paths such as /run/2026-06-27 fall back to index.html for the Solid router.
app.frontend("/", directory=str(STATIC_DIR), fallback="index.html", check_dir=False)
