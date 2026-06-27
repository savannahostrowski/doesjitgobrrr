from pathlib import Path

from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


STATIC_DIR = Path(__file__).parent / "static"

# FastAPI serves built Vite/Solid assets from api/static. Browser navigation
# paths such as /run/2026-06-27 fall back to index.html for the Solid router.
app.frontend("/", directory=str(STATIC_DIR), fallback="index.html", check_dir=False)
