# Personal Knowledge MCP - Kubernetes Deployment Guide

This guide covers deploying Personal Knowledge MCP to a Kubernetes cluster using kustomize.

## Prerequisites

- Kubernetes cluster (K3s, minikube, or cloud-managed)
- `kubectl` configured to access your cluster
- `kustomize` (bundled with kubectl 1.14+)
- Docker for building the MCP service image
- OpenAI API key for embeddings

## Quick Start

### 1. Build the MCP Service Image

```bash
# Build the Docker image
docker build -t pk-mcp:local .

# For K3s, import the image
docker save pk-mcp:local -o pk-mcp.tar
sudo k3s ctr images import pk-mcp.tar

# For minikube, load the image
minikube image load pk-mcp:local
```

### 2. Create Secrets

Create the required secrets before deploying:

```bash
# Create namespace first
kubectl create namespace pk-mcp

# Create secrets (replace with your actual values)
kubectl -n pk-mcp create secret generic pk-mcp-secrets \
  --from-literal=OPENAI_API_KEY='sk-your-actual-key' \
  --from-literal=GITHUB_PAT='ghp_your-pat-if-needed' \
  --from-literal=POSTGRES_PASSWORD='your-secure-password' \
  --from-literal=CHROMADB_AUTH_TOKEN=''
```

### 3. Deploy

```bash
# Deploy to local environment
kubectl apply -k kubernetes/overlays/local/

# Or deploy to production
kubectl apply -k kubernetes/overlays/production/
```

### 4. Verify Deployment

```bash
# Check pod status
kubectl -n pk-mcp get pods -w

# Check services
kubectl -n pk-mcp get svc

# View logs
kubectl -n pk-mcp logs -f deployment/pk-mcp-service
```

## Accessing the Service

### Port Forwarding (Development)

```bash
# Forward MCP service port
kubectl -n pk-mcp port-forward svc/pk-mcp-service 3001:3001

# Test health endpoint
curl http://localhost:3001/health
```

### Ingress (Production)

1. Ensure an ingress controller is installed (NGINX or Traefik)
2. Configure DNS to point to your cluster's ingress
3. Update the ingress host in your overlay

For K3s with Traefik (default):
```bash
# Add to /etc/hosts for local testing
echo "127.0.0.1 pk-mcp.local" | sudo tee -a /etc/hosts

# Access via ingress
curl http://pk-mcp.local/health
```

## Multi-Instance Deployment

Deploy isolated instances for different security tiers:

```bash
# Deploy private instance
kubectl apply -k kubernetes/multi-instance/private/

# Deploy work instance
kubectl apply -k kubernetes/multi-instance/work/

# Deploy public instance
kubectl apply -k kubernetes/multi-instance/public/

# Verify all namespaces
kubectl get namespaces | grep pk-mcp
```

Each instance has:
- Separate namespace (pk-mcp-private, pk-mcp-work, pk-mcp-public)
- Isolated storage (separate PVCs)
- Independent configuration

## Updating Deployments

### Rolling Update

```bash
# Update image tag
kubectl -n pk-mcp set image deployment/pk-mcp-service \
  mcp-service=pk-mcp:v1.1.0

# Watch rollout
kubectl -n pk-mcp rollout status deployment/pk-mcp-service
```

### ConfigMap Changes

```bash
# Reapply configuration
kubectl apply -k kubernetes/overlays/local/

# Restart pods to pick up changes
kubectl -n pk-mcp rollout restart deployment/pk-mcp-service
```

## Rollback

```bash
# View rollout history
kubectl -n pk-mcp rollout history deployment/pk-mcp-service

# Rollback to previous version
kubectl -n pk-mcp rollout undo deployment/pk-mcp-service

# Rollback to specific revision
kubectl -n pk-mcp rollout undo deployment/pk-mcp-service --to-revision=2
```

## Scaling

### Manual Scaling

```bash
# Scale MCP service
kubectl -n pk-mcp scale deployment/pk-mcp-service --replicas=3
```

### Enable Autoscaling

Add HPA to your overlay's kustomization.yaml:

```yaml
resources:
  - ../../base
  - ../../base/mcp-service/hpa.yaml
```

## Troubleshooting

### Pod Not Starting

```bash
# Check pod events
kubectl -n pk-mcp describe pod <pod-name>

# Check init container logs
kubectl -n pk-mcp logs <pod-name> -c wait-for-chromadb
```

### ChromaDB Connection Issues

```bash
# Verify ChromaDB is running
kubectl -n pk-mcp get pods -l app.kubernetes.io/component=chromadb

# Check ChromaDB health
kubectl -n pk-mcp exec -it chromadb-0 -- \
  wget -q -O- http://localhost:8000/api/v2/heartbeat
```

### Network Policy Issues

```bash
# Test connectivity from MCP to ChromaDB
kubectl -n pk-mcp exec deployment/pk-mcp-service -- \
  wget -q -O- http://chromadb:8000/api/v2/heartbeat
```

## Resource Requirements

| Component | CPU Request | CPU Limit | Memory Request | Memory Limit |
|-----------|-------------|-----------|----------------|--------------|
| MCP Service | 250m | 1 | 256Mi | 1Gi |
| ChromaDB | 500m | 2 | 512Mi | 2Gi |
| PostgreSQL | 250m | 2 | 256Mi | 1Gi |

## Backup and Restore

### Backup ChromaDB Data

```bash
# Create a backup pod
kubectl -n pk-mcp run backup --image=busybox --restart=Never \
  --overrides='{"spec":{"containers":[{"name":"backup","image":"busybox",
  "command":["tar","czf","/backup/chromadb-backup.tar.gz","/data"],
  "volumeMounts":[{"name":"data","mountPath":"/data"},
  {"name":"backup","mountPath":"/backup"}]}],
  "volumes":[{"name":"data","persistentVolumeClaim":
  {"claimName":"data-chromadb-0"}},
  {"name":"backup","hostPath":{"path":"/tmp/backups"}}]}}'
```

### Restore

See the [secret-management.md](secret-management.md) for backup procedures.

## Next Steps

- [Local Testing Guide](local-testing.md) - Testing on K3s/minikube
- [Secret Management](secret-management.md) - Production secret handling
