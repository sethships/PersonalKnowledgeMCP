# Multi-stage build for Personal Knowledge MCP Service
# Stage 1: Builder
FROM python:3.11-slim AS builder

# Set working directory
WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY requirements.txt pyproject.toml ./

# Create virtual environment and install dependencies
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# ============================================================================
# Stage 2: Runtime
# ============================================================================
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash mcp && \
    mkdir -p /var/log/personal-knowledge-mcp && \
    chown -R mcp:mcp /app /var/log/personal-knowledge-mcp

# Copy application code
COPY --chown=mcp:mcp src/ /app/src/
COPY --chown=mcp:mcp pyproject.toml /app/

# Switch to non-root user
USER mcp

# Environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/src \
    MCP_SERVICE_HOST=0.0.0.0 \
    MCP_SERVICE_PORT=8080

# Expose ports
EXPOSE 8080 9090

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run the application
# TODO: Update entrypoint once main service is implemented
CMD ["uvicorn", "mcp_service.main:app", "--host", "0.0.0.0", "--port", "8080"]
