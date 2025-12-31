# Personal Knowledge MCP Helm Chart

A Helm chart for deploying Personal Knowledge MCP - an AI-first knowledge management service built on the Model Context Protocol (MCP).

## Overview

This chart deploys:
- **MCP Service**: The main application providing semantic search via MCP
- **ChromaDB**: Vector database for semantic embeddings
- **PostgreSQL**: Document store for artifacts (Phase 2+)
- **Ingress**: Optional ingress for external access
- **Network Policies**: Security policies for pod communication

## Prerequisites

- Kubernetes 1.23+
- Helm 3.0+
- PV provisioner support in the cluster (for persistent storage)
- OpenAI API key for embeddings

## Installation

### Quick Start

```bash
# Add your secrets first
kubectl create namespace pk-mcp
kubectl -n pk-mcp create secret generic pk-mcp-secrets \
  --from-literal=OPENAI_API_KEY='sk-your-key' \
  --from-literal=POSTGRES_PASSWORD='secure-password'

# Install the chart
helm install pk-mcp ./charts/personal-knowledge-mcp \
  --namespace pk-mcp \
  --set secrets.create=false \
  --set secrets.existingSecret=pk-mcp-secrets
```

### Using Values Files

```bash
# Development
helm install pk-mcp ./charts/personal-knowledge-mcp \
  -f charts/personal-knowledge-mcp/examples/values-dev.yaml \
  --set secrets.openaiApiKey=sk-your-key

# Production
helm install pk-mcp ./charts/personal-knowledge-mcp \
  -f charts/personal-knowledge-mcp/examples/values-prod.yaml
```

## Multi-Instance Deployment

Deploy separate instances for different security tiers:

```bash
# Private instance (personal/sensitive)
helm install pk-mcp-private ./charts/personal-knowledge-mcp \
  -n pk-mcp-private --create-namespace \
  -f charts/personal-knowledge-mcp/examples/values-private.yaml

# Work instance (work-related)
helm install pk-mcp-work ./charts/personal-knowledge-mcp \
  -n pk-mcp-work --create-namespace \
  -f charts/personal-knowledge-mcp/examples/values-work.yaml

# Public instance (OSS/public)
helm install pk-mcp-public ./charts/personal-knowledge-mcp \
  -n pk-mcp-public --create-namespace \
  -f charts/personal-knowledge-mcp/examples/values-public.yaml
```

## Configuration

### Key Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.namespace.create` | Create namespace | `true` |
| `global.namespace.name` | Namespace name | Release namespace |
| `mcpService.enabled` | Enable MCP service | `true` |
| `mcpService.replicaCount` | Number of replicas | `1` |
| `mcpService.image.repository` | Image repository | `pk-mcp` |
| `mcpService.image.tag` | Image tag | `latest` |
| `mcpService.resources` | Resource requests/limits | See values.yaml |
| `mcpService.autoscaling.enabled` | Enable HPA | `false` |
| `chromadb.enabled` | Enable ChromaDB | `true` |
| `chromadb.persistence.size` | Storage size | `10Gi` |
| `postgres.enabled` | Enable PostgreSQL | `true` |
| `postgres.persistence.size` | Storage size | `5Gi` |
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.host` | Ingress hostname | `pk-mcp.local` |
| `ingress.tls.enabled` | Enable TLS | `false` |
| `networkPolicies.enabled` | Enable network policies | `true` |
| `secrets.create` | Create secrets from values | `true` |
| `secrets.existingSecret` | Use existing secret | `""` |

### Secrets

Required secrets:
- `OPENAI_API_KEY`: OpenAI API key for embeddings (required)
- `POSTGRES_PASSWORD`: PostgreSQL password (required)
- `GITHUB_PAT`: GitHub PAT for private repos (optional)
- `CHROMADB_AUTH_TOKEN`: ChromaDB auth token (optional)

**Option 1: Create from values (development)**
```bash
helm install pk-mcp ./charts/personal-knowledge-mcp \
  --set secrets.openaiApiKey=sk-xxx \
  --set secrets.postgresPassword=xxx
```

**Option 2: Use existing secret (production)**
```bash
kubectl -n pk-mcp create secret generic pk-mcp-secrets \
  --from-literal=OPENAI_API_KEY='sk-xxx' \
  --from-literal=POSTGRES_PASSWORD='xxx'

helm install pk-mcp ./charts/personal-knowledge-mcp \
  --set secrets.create=false \
  --set secrets.existingSecret=pk-mcp-secrets
```

## Testing

Run Helm tests after installation:

```bash
helm test pk-mcp -n pk-mcp
```

## Upgrading

```bash
# Update values and upgrade
helm upgrade pk-mcp ./charts/personal-knowledge-mcp \
  -f your-values.yaml

# View upgrade history
helm history pk-mcp -n pk-mcp

# Rollback if needed
helm rollback pk-mcp 1 -n pk-mcp
```

### Upgrade Notes

- **Storage**: PVC sizes cannot be decreased. Plan storage capacity upfront.
- **Secrets**: If switching from `secrets.create=true` to `existingSecret`, create the secret first.
- **Image tags**: Use specific tags (not `latest`) in production for reproducible deployments.

## Uninstalling

```bash
helm uninstall pk-mcp -n pk-mcp

# To also delete PVCs (DATA LOSS!)
kubectl -n pk-mcp delete pvc -l app.kubernetes.io/instance=pk-mcp
```

## Troubleshooting

### Pod not starting

```bash
# Check pod status
kubectl -n pk-mcp get pods

# View pod events
kubectl -n pk-mcp describe pod <pod-name>

# Check logs
kubectl -n pk-mcp logs <pod-name>
```

### ChromaDB connection issues

The MCP service waits for ChromaDB to be ready via init container. If it times out:

```bash
# Check ChromaDB status
kubectl -n pk-mcp get pods -l app.kubernetes.io/component=chromadb

# Check ChromaDB logs
kubectl -n pk-mcp logs -l app.kubernetes.io/component=chromadb
```

### Secret issues

```bash
# Verify secret exists
kubectl -n pk-mcp get secrets

# Check secret keys
kubectl -n pk-mcp get secret pk-mcp-secrets -o jsonpath='{.data}' | jq
```

## Development

### Linting

```bash
helm lint ./charts/personal-knowledge-mcp
```

### Template Rendering

```bash
# Default values
helm template pk-mcp ./charts/personal-knowledge-mcp

# With values file
helm template pk-mcp ./charts/personal-knowledge-mcp -f examples/values-dev.yaml

# Debug mode
helm template pk-mcp ./charts/personal-knowledge-mcp --debug
```

### Dry Run

```bash
helm install pk-mcp ./charts/personal-knowledge-mcp --dry-run --debug
```

## License

TBD - See project repository for license information.
