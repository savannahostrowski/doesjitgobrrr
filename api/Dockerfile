FROM python:3.14-slim

WORKDIR /app

# Install build dependencies for asyncpg
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install uv

# Copy project files
COPY pyproject.toml .
COPY *.py .

# Sync dependencies
RUN uv sync

# Expose port
EXPOSE 8000

# Run the application with uv
CMD ["uv", "run", "main.py"]
