# Getting Started with Personal Knowledge MCP

Welcome to the Personal Knowledge MCP project! This guide will help you get started with development.

## Project Status

**Current Phase:** Initial Setup Complete - Ready for Phase 1 Development

The repository structure is now in place with:
- Comprehensive documentation ([README.md](README.md), [CLAUDE.md](.claude/CLAUDE.md))
- Project configuration (pyproject.toml, requirements.txt)
- Docker deployment setup (Dockerfile, docker-compose.yml)
- Initial source code structure
- Testing infrastructure

## Quick Start

### Prerequisites

Ensure you have the following installed:

- **Python 3.11+**: Check with `python --version`
- **Docker & Docker Compose**: For containerized deployment
- **Git**: For version control
- **PowerShell 7+** (Windows): For scripts and automation

### Local Development Setup

1. **Clone the repository** (if not already done):
   ```bash
   git clone <repository-url>
   cd PersonalKnowledgeMCP
   ```

2. **Create a Python virtual environment**:
   ```bash
   python -m venv venv
   ```

3. **Activate the virtual environment**:
   - Windows (PowerShell): `.\venv\Scripts\Activate.ps1`
   - Windows (CMD): `.\venv\Scripts\activate.bat`
   - Linux/Mac: `source venv/bin/activate`

4. **Install dependencies**:
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

5. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your actual configuration
   ```

6. **Start the storage backends** (Phase 1 uses Qdrant):
   ```bash
   docker-compose up -d qdrant
   ```

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src --cov-report=html

# Run specific test types
pytest -m unit
pytest -m integration
pytest -m performance
```

### Code Quality

```bash
# Format code with Black
black src tests

# Lint with Ruff
ruff check src tests

# Type check with mypy
mypy src
```

### Docker Deployment

For containerized deployment:

```bash
# Build and start all services
docker-compose up --build

# Start in background
docker-compose up -d

# View logs
docker-compose logs -f mcp-service

# Stop services
docker-compose down
```

## Development Workflow

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the guidelines in [.claude/CLAUDE.md](.claude/CLAUDE.md)

3. **Write tests** (maintain 90% coverage minimum)

4. **Run tests and quality checks**:
   ```bash
   pytest
   black src tests
   ruff check src tests
   mypy src
   ```

5. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

6. **Push and create a PR**:
   ```bash
   git push origin feature/your-feature-name
   # Create PR on GitHub
   ```

## Project Structure

```
PersonalKnowledgeMCP/
├── .claude/                      # Claude Code configuration
│   └── CLAUDE.md                # Project-specific guidelines
├── docs/                        # Documentation
│   ├── High-level-Personal-Knowledge-MCP-PRD.md
│   └── architecture/            # Architecture docs and ADRs
├── src/                         # Source code
│   ├── mcp_service/            # MCP service implementation
│   ├── storage/                # Storage adapters
│   ├── ingestion/              # Ingestion pipelines
│   └── retrieval/              # Retrieval logic
├── tests/                       # Test suite
│   ├── unit/                   # Unit tests
│   ├── integration/            # Integration tests
│   └── performance/            # Performance tests
├── config/                      # Configuration files
├── kubernetes/                  # K8s manifests (future)
├── .env.example                # Environment template
├── docker-compose.yml          # Docker Compose config
├── Dockerfile                  # Container image definition
├── pyproject.toml              # Project metadata
├── requirements.txt            # Python dependencies
└── README.md                   # Project overview
```

## Next Steps for Phase 1 Development

Based on the [PRD](docs/High-level-Personal-Knowledge-MCP-PRD.md), Phase 1 focuses on:

1. **MCP Service Implementation**
   - [ ] Create FastAPI application structure
   - [ ] Implement MCP protocol interface
   - [ ] Add health check and metrics endpoints

2. **Vector Database Integration**
   - [ ] Qdrant client wrapper
   - [ ] Collection creation and management
   - [ ] Vector storage and retrieval operations

3. **Embeddings Generation**
   - [ ] OpenAI API integration
   - [ ] Text chunking and preprocessing
   - [ ] Embedding caching

4. **GitHub Repository Ingestion**
   - [ ] Repository cloner
   - [ ] File type filtering
   - [ ] Basic text extraction
   - [ ] Batch embedding generation

5. **Semantic Search**
   - [ ] Query preprocessing
   - [ ] Vector similarity search
   - [ ] Result ranking and formatting

## Key Resources

- [Product Requirements Document](docs/High-level-Personal-Knowledge-MCP-PRD.md) - Full vision and requirements
- [Project Configuration](.claude/CLAUDE.md) - Development guidelines
- [Architecture Documentation](docs/architecture/README.md) - Technical architecture
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP specification

## Getting Help

- Review the [PRD](docs/High-level-Personal-Knowledge-MCP-PRD.md) for product context
- Check [CLAUDE.md](.claude/CLAUDE.md) for development guidelines
- Consult the [architecture docs](docs/architecture/README.md) for technical decisions

## Performance Targets (Phase 1 MVP)

Keep these targets in mind during development:

- **Query Response**: <500ms (95th percentile)
- **Semantic Search**: <200ms for vector lookup
- **Small Repo Indexing**: <5 minutes (<1K files)
- **Test Coverage**: >90% minimum

## Contributing

This is currently a personal project. Follow the workflow in [.claude/CLAUDE.md](.claude/CLAUDE.md) for all contributions.

---

Happy coding! Let's build an AI-first knowledge management system that revolutionizes how AI assistants access project knowledge.
