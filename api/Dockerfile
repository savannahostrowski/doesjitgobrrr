FROM python:3.14-slim

WORKDIR /app

# Install uv
RUN pip install uv

# Copy project files
COPY pyproject.toml .
COPY *.py .

# Sync dependencies
RUN uv sync

# Create data directory and copy database
RUN mkdir -p data
COPY data/benchmarks.db data/benchmarks.db

# Expose port
EXPOSE 8000

# Run the application with uv
CMD ["uv", "run", "main.py"]
