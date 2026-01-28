# Personal Knowledge MCP - Production Dockerfile
#
# Build a production-ready container image for Kubernetes deployment.
# The MCP service runs with HTTP transport enabled for container networking.
#
# Build:
#   docker build -t pk-mcp:local .
#
# Run locally:
#   docker run -p 3001:3001 \
#     -e OPENAI_API_KEY=your-key \
#     -e CHROMADB_HOST=host.docker.internal \
#     pk-mcp:local

# =============================================================================
# Stage 1: Dependencies
# =============================================================================
FROM oven/bun:1.1-alpine AS deps

WORKDIR /app

# Copy dependency files
COPY package.json bun.lockb ./

# Install production dependencies only
RUN bun install --production --frozen-lockfile

# =============================================================================
# Stage 2: Build
# =============================================================================
FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Copy dependency files and install all dependencies (including dev)
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Build the application
RUN bun run build

# =============================================================================
# Stage 3: Production Runtime
# =============================================================================
FROM oven/bun:1.1-alpine AS runtime

# Add labels for container metadata
LABEL org.opencontainers.image.title="Personal Knowledge MCP"
LABEL org.opencontainers.image.description="AI-first knowledge management service built on Model Context Protocol"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.source="https://github.com/sethships/PersonalKnowledgeMCP"

# Create non-root user for security
RUN addgroup -g 1001 -S pkuser && \
    adduser -u 1001 -S pkuser -G pkuser

WORKDIR /app

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy configuration files
COPY config/ ./config/
COPY package.json ./

# Create data directory with proper permissions
RUN mkdir -p /app/data && chown -R pkuser:pkuser /app/data

# Switch to non-root user
USER pkuser

# Expose HTTP transport port
EXPOSE 3001

# Environment defaults for Kubernetes deployment
ENV NODE_ENV=production
ENV HTTP_TRANSPORT_ENABLED=true
ENV HTTP_HOST=0.0.0.0
ENV HTTP_PORT=3001
ENV LOG_LEVEL=info
ENV LOG_FORMAT=json
ENV DATA_PATH=/app/data

# Health check using the built-in health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget -q -O- http://localhost:3001/health || exit 1

# Run the MCP service
CMD ["bun", "run", "dist/index.js"]
