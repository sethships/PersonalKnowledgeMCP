# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

1. **Do NOT** create a public GitHub issue for security vulnerabilities
2. Email security concerns to the repository maintainer via GitHub's private vulnerability reporting feature
3. Or use GitHub's "Report a vulnerability" button in the Security tab

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Target**: Within 30 days for critical issues

### Scope

This security policy applies to:
- The Personal Knowledge MCP codebase
- Official container images
- CLI tools and MCP server

### Out of Scope

- Third-party dependencies (report to upstream maintainers)
- Self-hosted instances with custom modifications

## Security Best Practices

When deploying Personal Knowledge MCP:

1. **Never commit secrets**: Keep `.env` files out of version control
2. **Use authentication**: Enable bearer token auth for HTTP endpoints
3. **Localhost binding**: Keep services bound to 127.0.0.1 unless necessary
4. **Token rotation**: Rotate API tokens periodically
5. **Update regularly**: Keep dependencies and container images updated

## Data Handling

### External Services

When using OpenAI embeddings (optional):
- Code snippets are sent to OpenAI API for embedding generation
- The service sets `X-OpenAI-Data-Usage: off` to opt out of training
- Consider using local embedding providers (Transformers.js, Ollama) for sensitive code

### Local Processing

- All indexed data is stored locally in ChromaDB and Neo4j volumes
- No telemetry is collected by the application
- ChromaDB telemetry is disabled by default
