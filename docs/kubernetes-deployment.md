# Kubernetes Deployment Guide

This comprehensive guide covers deploying Personal Knowledge MCP to a Kubernetes cluster using Helm charts.

## Overview

Personal Knowledge MCP can be deployed to Kubernetes for production workloads with features including:

- **High Availability**: Multiple replicas with pod disruption budgets
- **Auto-scaling**: Horizontal Pod Autoscaler (HPA) support
- **Security**: Network policies, RBAC, and secret management
- **Multi-instance**: Deploy isolated instances for different security tiers (private, work, public)
- **Observability**: Health endpoints, structured logging, and monitoring integration

### Deployment Options

| Method | Best For | Documentation |
|--------|----------|---------------|
| **Helm** (Recommended) | Production deployments with customization | This guide |
| **Kustomize** | GitOps workflows, minimal dependencies | [kubernetes/docs/deployment-guide.md](../kubernetes/docs/deployment-guide.md) |
| **Docker Compose** | Local development | [docs/docker-operations.md](docker-operations.md) |

### Related Documentation

- [Local Testing Guide](../kubernetes/docs/local-testing.md) - K3s and minikube setup
- [Secret Management Guide](../kubernetes/docs/secret-management.md) - Production secret handling
- [OIDC Deployment Guide](security/oidc-deployment.md) - Microsoft 365 authentication

---

## Prerequisites

### Kubernetes Cluster Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Kubernetes Version | 1.23+ | 1.28+ |
| Nodes | 1 | 3+ |
| Total CPU | 2 cores | 4+ cores |
| Total Memory | 4GB | 8GB+ |
| Storage | 20GB | 100GB+ (SSD) |

**Supported Environments:**
- Managed Kubernetes: AKS, EKS, GKE, DigitalOcean
- Self-hosted: K3s, kubeadm, Rancher
- Local: minikube, kind, Docker Desktop

### kubectl Setup

Install and configure kubectl to access your cluster:

```bash
# Verify kubectl is installed
kubectl version --client

# Verify cluster access
kubectl cluster-info
kubectl get nodes

# (Optional) Set default namespace
kubectl config set-context --current --namespace=pk-mcp
```

### Helm Installation

Helm 3.x is required for chart installation:

```bash
# macOS
brew install helm

# Windows (Chocolatey)
choco install kubernetes-helm

# Linux
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Verify installation
helm version
```

### Docker (for Building Images)

Docker is needed to build the MCP service image:

```bash
# Build the image
docker build -t pk-mcp:latest .

# For cloud registries, tag and push
docker tag pk-mcp:latest your-registry.io/pk-mcp:1.0.0
docker push your-registry.io/pk-mcp:1.0.0
```

### Required Secrets

Before deploying, prepare the following credentials:

| Secret | Required | Description |
|--------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for embedding generation |
| `POSTGRES_PASSWORD` | Yes | PostgreSQL database password |
| `GITHUB_PAT` | No | GitHub Personal Access Token for private repos |
| `CHROMADB_AUTH_TOKEN` | No | ChromaDB authentication token |

---

## Quick Start

Deploy Personal Knowledge MCP in 5 minutes with default settings:

### 1. Create Namespace and Secrets

```bash
# Create namespace
kubectl create namespace pk-mcp

# Create secrets (replace with your values)
kubectl -n pk-mcp create secret generic pk-mcp-secrets \
  --from-literal=OPENAI_API_KEY='sk-your-openai-api-key' \
  --from-literal=POSTGRES_PASSWORD='secure-password-here' \
  --from-literal=GITHUB_PAT='' \
  --from-literal=CHROMADB_AUTH_TOKEN=''
```

### 2. Install with Helm

```bash
# Install from local chart
helm install pk-mcp ./charts/personal-knowledge-mcp \
  --namespace pk-mcp \
  --set secrets.create=false \
  --set secrets.existingSecret=pk-mcp-secrets

# Wait for pods to be ready
kubectl -n pk-mcp wait --for=condition=ready pod --all --timeout=300s
```

### 3. Verify Deployment

```bash
# Check pod status
kubectl -n pk-mcp get pods

# Check services
kubectl -n pk-mcp get svc

# Port forward for testing
kubectl -n pk-mcp port-forward svc/pk-mcp-service 3001:3001 &

# Test health endpoint
curl http://localhost:3001/health
```

Expected response:
```json
{"status":"healthy","version":"1.0.0","uptime":...,"checks":{"chromadb":"connected"}}
```

---

## Full Deployment Guide

### Namespace Setup

Create a dedicated namespace with optional resource quotas:

```bash
# Create namespace
kubectl create namespace pk-mcp

# (Optional) Apply resource quotas
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ResourceQuota
metadata:
  name: pk-mcp-quota
  namespace: pk-mcp
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "8"
    limits.memory: 16Gi
    persistentvolumeclaims: "10"
EOF

# (Optional) Apply limit ranges for default container resources
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: LimitRange
metadata:
  name: pk-mcp-limits
  namespace: pk-mcp
spec:
  limits:
  - default:
      cpu: "500m"
      memory: "512Mi"
    defaultRequest:
      cpu: "100m"
      memory: "128Mi"
    type: Container
EOF
```

### Secret Creation

#### Option A: Manual Creation (Development)

```bash
kubectl -n pk-mcp create secret generic pk-mcp-secrets \
  --from-literal=OPENAI_API_KEY='sk-your-key' \
  --from-literal=POSTGRES_PASSWORD='your-secure-password' \
  --from-literal=GITHUB_PAT='ghp_your-pat' \
  --from-literal=CHROMADB_AUTH_TOKEN=''
```

#### Option B: From Environment File

Create a `.env.secrets` file (DO NOT commit to git):

```bash
OPENAI_API_KEY=sk-your-openai-key
POSTGRES_PASSWORD=your-secure-password
GITHUB_PAT=ghp_your-github-pat
CHROMADB_AUTH_TOKEN=
```

Apply:
```bash
kubectl -n pk-mcp create secret generic pk-mcp-secrets \
  --from-env-file=.env.secrets
```

#### Option C: Production (SealedSecrets/External Secrets)

For production deployments, see [Secret Management Guide](../kubernetes/docs/secret-management.md) for:
- SealedSecrets for GitOps
- External Secrets Operator for cloud secret managers (AWS, Azure, HashiCorp Vault)

### Helm Installation

#### Default Installation

```bash
helm install pk-mcp ./charts/personal-knowledge-mcp \
  --namespace pk-mcp \
  --set secrets.create=false \
  --set secrets.existingSecret=pk-mcp-secrets
```

#### Installation with Custom Values

Create a `values-custom.yaml` file:

```yaml
# Custom values for production
global:
  namespace:
    name: pk-mcp

mcpService:
  replicaCount: 2
  image:
    repository: your-registry.io/pk-mcp
    tag: "1.0.0"
  resources:
    requests:
      memory: "512Mi"
      cpu: "500m"
    limits:
      memory: "2Gi"
      cpu: "2"
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 5

chromadb:
  persistence:
    size: 50Gi
    storageClass: "standard-ssd"

postgres:
  persistence:
    size: 20Gi

secrets:
  create: false
  existingSecret: "pk-mcp-secrets"

ingress:
  enabled: true
  className: nginx
  host: pk-mcp.example.com
  tls:
    enabled: true
    secretName: pk-mcp-tls
```

Install with custom values:

```bash
helm install pk-mcp ./charts/personal-knowledge-mcp \
  --namespace pk-mcp \
  -f values-custom.yaml
```

#### Multi-Instance Deployment

Deploy isolated instances for different security tiers:

```bash
# Private instance (personal projects)
helm install pk-mcp-private ./charts/personal-knowledge-mcp \
  --namespace pk-mcp-private --create-namespace \
  -f charts/personal-knowledge-mcp/examples/values-private.yaml \
  --set secrets.existingSecret=pk-mcp-secrets-private

# Work instance (work projects)
helm install pk-mcp-work ./charts/personal-knowledge-mcp \
  --namespace pk-mcp-work --create-namespace \
  -f charts/personal-knowledge-mcp/examples/values-work.yaml \
  --set secrets.existingSecret=pk-mcp-secrets-work

# Public instance (open source)
helm install pk-mcp-public ./charts/personal-knowledge-mcp \
  --namespace pk-mcp-public --create-namespace \
  -f charts/personal-knowledge-mcp/examples/values-public.yaml \
  --set secrets.existingSecret=pk-mcp-secrets-public

# Verify all instances
kubectl get pods -A | grep pk-mcp
```

### Ingress Configuration

#### NGINX Ingress Controller

Install NGINX Ingress Controller if not present:

```bash
# Using Helm
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace
```

Configure ingress in values:

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "120"
  host: pk-mcp.example.com
  paths:
    - path: /health
      pathType: Exact
    - path: /api/v1
      pathType: Prefix
```

#### Traefik (K3s Default)

For K3s clusters with Traefik:

```yaml
ingress:
  enabled: true
  className: traefik
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
    traefik.ingress.kubernetes.io/router.tls: "true"
  host: pk-mcp.example.com
```

#### Verify Ingress

```bash
# Check ingress status
kubectl -n pk-mcp get ingress

# Test via ingress (add to /etc/hosts if using local cluster)
curl http://pk-mcp.example.com/health
```

### TLS Certificate Setup

#### Option A: cert-manager with Let's Encrypt (Recommended)

Install cert-manager:

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml
```

Create ClusterIssuer for Let's Encrypt:

```yaml
# letsencrypt-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-prod-key
    solvers:
    - http01:
        ingress:
          class: nginx
```

```bash
kubectl apply -f letsencrypt-issuer.yaml
```

Configure ingress for automatic certificate:

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  host: pk-mcp.example.com
  tls:
    enabled: true
    secretName: pk-mcp-tls
```

#### Option B: Self-Signed (Development)

```bash
# Generate self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout tls.key -out tls.crt \
  -subj "/CN=pk-mcp.local"

# Create TLS secret
kubectl -n pk-mcp create secret tls pk-mcp-tls \
  --cert=tls.crt --key=tls.key
```

#### Option C: Manual Certificate

```bash
# Create secret from existing certificates
kubectl -n pk-mcp create secret tls pk-mcp-tls \
  --cert=/path/to/fullchain.pem \
  --key=/path/to/privkey.pem
```

---

## Operations

### Scaling Procedures

#### Manual Scaling

```bash
# Scale MCP service replicas
kubectl -n pk-mcp scale deployment/pk-mcp-service --replicas=3

# Verify scaling
kubectl -n pk-mcp get pods -l app.kubernetes.io/component=mcp-service
```

> **Note:** ChromaDB runs as a StatefulSet. Scaling it requires careful consideration of data replication strategies. For most deployments, a single ChromaDB instance with persistent storage is sufficient.

#### Enable Horizontal Pod Autoscaler

Configure in Helm values:

```yaml
mcpService:
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70
    targetMemoryUtilizationPercentage: 80
```

Or apply directly:

```bash
kubectl -n pk-mcp autoscale deployment/pk-mcp-service \
  --min=2 --max=10 --cpu-percent=70
```

Check HPA status:

```bash
kubectl -n pk-mcp get hpa
kubectl -n pk-mcp describe hpa pk-mcp-service
```

### Upgrade Procedures

#### Helm Upgrade Workflow

```bash
# Update values
# Edit values-custom.yaml or specify new values

# Dry-run to preview changes
helm upgrade pk-mcp ./charts/personal-knowledge-mcp \
  --namespace pk-mcp \
  -f values-custom.yaml \
  --dry-run

# Apply upgrade
helm upgrade pk-mcp ./charts/personal-knowledge-mcp \
  --namespace pk-mcp \
  -f values-custom.yaml

# Watch rollout
kubectl -n pk-mcp rollout status deployment/pk-mcp-service
```

#### Image Updates

```bash
# Update image tag in values
helm upgrade pk-mcp ./charts/personal-knowledge-mcp \
  --namespace pk-mcp \
  --set mcpService.image.tag=1.1.0

# Or update directly (not recommended for production)
kubectl -n pk-mcp set image deployment/pk-mcp-service \
  mcp-service=your-registry.io/pk-mcp:1.1.0
```

#### Configuration Changes

```bash
# Update configuration
helm upgrade pk-mcp ./charts/personal-knowledge-mcp \
  --namespace pk-mcp \
  --set mcpService.config.logLevel=debug

# Restart pods to pick up ConfigMap changes
kubectl -n pk-mcp rollout restart deployment/pk-mcp-service
```

#### Rollback Procedures

```bash
# View release history
helm history pk-mcp --namespace pk-mcp

# Rollback to previous release
helm rollback pk-mcp --namespace pk-mcp

# Rollback to specific revision
helm rollback pk-mcp 2 --namespace pk-mcp

# Alternative: kubectl rollback for deployments
kubectl -n pk-mcp rollout undo deployment/pk-mcp-service
kubectl -n pk-mcp rollout undo deployment/pk-mcp-service --to-revision=2
```

### Backup and Restore

#### ChromaDB Data Backup

**Option A: Volume Snapshot (Cloud providers)**

```bash
# Create VolumeSnapshot (requires CSI driver with snapshot support)
cat <<EOF | kubectl apply -f -
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: chromadb-snapshot-$(date +%Y%m%d)
  namespace: pk-mcp
spec:
  source:
    persistentVolumeClaimName: data-chromadb-0
EOF

# Verify snapshot
kubectl -n pk-mcp get volumesnapshot
```

**Option B: Pod-based backup**

```bash
# Create backup job
kubectl -n pk-mcp run chromadb-backup --rm -it --restart=Never \
  --image=busybox \
  --overrides='{
    "spec": {
      "containers": [{
        "name": "backup",
        "image": "busybox",
        "command": ["tar", "czf", "/backup/chromadb-backup.tar.gz", "-C", "/data", "."],
        "volumeMounts": [
          {"name": "data", "mountPath": "/data"},
          {"name": "backup", "mountPath": "/backup"}
        ]
      }],
      "volumes": [
        {"name": "data", "persistentVolumeClaim": {"claimName": "data-chromadb-0"}},
        {"name": "backup", "hostPath": {"path": "/tmp/backups"}}
      ]
    }
  }'
```

#### PostgreSQL Backup

```bash
# Create backup
kubectl -n pk-mcp exec -it postgres-0 -- \
  pg_dump -U pk_mcp personal_knowledge > backup-$(date +%Y%m%d).sql

# Restore
kubectl -n pk-mcp exec -i postgres-0 -- \
  psql -U pk_mcp personal_knowledge < backup.sql
```

#### Disaster Recovery

For full cluster recovery:

1. Recreate namespace and secrets
2. Restore PVC data from snapshots or backups
3. Reinstall Helm chart
4. Verify data integrity

```bash
# Restore from VolumeSnapshot
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data-chromadb-0
  namespace: pk-mcp
spec:
  dataSource:
    name: chromadb-snapshot-20250101
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 50Gi
EOF
```

### Monitoring Integration

#### Prometheus Metrics

The MCP service exposes health endpoints for monitoring:

```yaml
# ServiceMonitor for Prometheus Operator
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: pk-mcp-service
  namespace: pk-mcp
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: personal-knowledge-mcp
  endpoints:
  - port: http
    path: /health
    interval: 30s
```

#### Grafana Dashboard

Example dashboard queries:

```promql
# Pod CPU usage
sum(rate(container_cpu_usage_seconds_total{namespace="pk-mcp"}[5m])) by (pod)

# Pod memory usage
sum(container_memory_working_set_bytes{namespace="pk-mcp"}) by (pod)

# Request latency (if metrics exposed)
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{namespace="pk-mcp"}[5m])) by (le))
```

#### Alert Rules

```yaml
# PrometheusRule for alerting
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: pk-mcp-alerts
  namespace: pk-mcp
spec:
  groups:
  - name: pk-mcp
    rules:
    - alert: PKMCPPodNotReady
      expr: kube_pod_status_ready{namespace="pk-mcp", condition="true"} == 0
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "Pod {{ $labels.pod }} is not ready"
    - alert: PKMCPHighMemory
      expr: container_memory_working_set_bytes{namespace="pk-mcp"} / container_spec_memory_limit_bytes > 0.9
      for: 10m
      labels:
        severity: warning
      annotations:
        summary: "Pod {{ $labels.pod }} memory usage above 90%"
```

#### Log Aggregation

For centralized logging with Loki:

```yaml
# Add annotations for Promtail/Loki
mcpService:
  podAnnotations:
    loki.grafana.com/scrape: "true"
    loki.grafana.com/log-format: "json"
```

---

## Troubleshooting

### Common Issues

#### Pod Not Starting

**Symptoms:** Pod stuck in `Pending`, `ImagePullBackOff`, or `CrashLoopBackOff`

```bash
# Check pod status and events
kubectl -n pk-mcp describe pod <pod-name>

# Check events in namespace
kubectl -n pk-mcp get events --sort-by='.lastTimestamp'
```

**Common causes:**

| Error | Cause | Solution |
|-------|-------|----------|
| `ImagePullBackOff` | Image not found or auth required | Verify image name/tag, add imagePullSecrets |
| `Pending` (no events) | No nodes with enough resources | Check resource requests, add nodes |
| `Pending` (storage) | PVC not bound | Check storage class, PV availability |
| `CrashLoopBackOff` | Application crash | Check logs, verify secrets |

#### Secrets Missing

```bash
# Verify secret exists
kubectl -n pk-mcp get secret pk-mcp-secrets

# Check secret keys
kubectl -n pk-mcp get secret pk-mcp-secrets -o jsonpath='{.data}' | jq 'keys'

# Recreate if needed
kubectl -n pk-mcp delete secret pk-mcp-secrets
kubectl -n pk-mcp create secret generic pk-mcp-secrets \
  --from-literal=OPENAI_API_KEY='...' \
  --from-literal=POSTGRES_PASSWORD='...'
```

#### ChromaDB Connection Failures

```bash
# Check ChromaDB pod status
kubectl -n pk-mcp get pods -l app.kubernetes.io/component=chromadb

# Verify ChromaDB is healthy
kubectl -n pk-mcp exec -it chromadb-0 -- \
  wget -q -O- http://localhost:8000/api/v2/heartbeat

# Test connectivity from MCP service
kubectl -n pk-mcp exec deployment/pk-mcp-service -- \
  wget -q -O- http://chromadb:8000/api/v2/heartbeat
```

#### PostgreSQL Connection Issues

```bash
# Check PostgreSQL pod
kubectl -n pk-mcp get pods -l app.kubernetes.io/component=postgres

# Verify PostgreSQL is ready
kubectl -n pk-mcp exec -it postgres-0 -- \
  pg_isready -U pk_mcp -d personal_knowledge

# Check logs
kubectl -n pk-mcp logs postgres-0
```

#### Ingress Not Routing

```bash
# Check ingress status
kubectl -n pk-mcp get ingress
kubectl -n pk-mcp describe ingress pk-mcp-ingress

# Check ingress controller logs
kubectl -n ingress-nginx logs -l app.kubernetes.io/name=ingress-nginx

# Test backend directly
kubectl -n pk-mcp port-forward svc/pk-mcp-service 3001:3001
curl http://localhost:3001/health
```

#### TLS Certificate Problems

```bash
# Check certificate status (cert-manager)
kubectl -n pk-mcp get certificate
kubectl -n pk-mcp describe certificate pk-mcp-tls

# Check certificate secret
kubectl -n pk-mcp get secret pk-mcp-tls

# Verify certificate details
kubectl -n pk-mcp get secret pk-mcp-tls -o jsonpath='{.data.tls\.crt}' | \
  base64 -d | openssl x509 -noout -text
```

### Debug Commands

```bash
# Get all resources in namespace
kubectl -n pk-mcp get all

# Describe specific resource
kubectl -n pk-mcp describe deployment/pk-mcp-service
kubectl -n pk-mcp describe statefulset/chromadb
kubectl -n pk-mcp describe pvc/data-chromadb-0

# Get pod details with wide output
kubectl -n pk-mcp get pods -o wide

# Check resource usage
kubectl -n pk-mcp top pods
kubectl -n pk-mcp top nodes
```

#### Exec into Pods

```bash
# Shell into MCP service
kubectl -n pk-mcp exec -it deployment/pk-mcp-service -- /bin/sh

# Shell into ChromaDB
kubectl -n pk-mcp exec -it chromadb-0 -- /bin/bash

# Shell into PostgreSQL
kubectl -n pk-mcp exec -it postgres-0 -- /bin/bash
```

#### Port Forwarding

```bash
# Forward MCP service
kubectl -n pk-mcp port-forward svc/pk-mcp-service 3001:3001

# Forward ChromaDB
kubectl -n pk-mcp port-forward svc/chromadb 8000:8000

# Forward PostgreSQL
kubectl -n pk-mcp port-forward svc/postgres 5432:5432
```

#### Network Connectivity Testing

```bash
# Test DNS resolution
kubectl -n pk-mcp run test-dns --rm -it --restart=Never --image=busybox -- \
  nslookup chromadb

# Test HTTP connectivity
kubectl -n pk-mcp run test-http --rm -it --restart=Never --image=curlimages/curl -- \
  curl -v http://chromadb:8000/api/v2/heartbeat

# Test TCP connectivity
kubectl -n pk-mcp run test-tcp --rm -it --restart=Never --image=busybox -- \
  nc -zv postgres 5432
```

### Log Access

#### Viewing Pod Logs

```bash
# Current logs
kubectl -n pk-mcp logs deployment/pk-mcp-service

# Follow logs
kubectl -n pk-mcp logs -f deployment/pk-mcp-service

# Previous container logs (after crash)
kubectl -n pk-mcp logs deployment/pk-mcp-service --previous

# Init container logs
kubectl -n pk-mcp logs deployment/pk-mcp-service -c wait-for-chromadb

# All containers in pod
kubectl -n pk-mcp logs <pod-name> --all-containers

# With timestamps
kubectl -n pk-mcp logs deployment/pk-mcp-service --timestamps

# Last N lines
kubectl -n pk-mcp logs deployment/pk-mcp-service --tail=100
```

#### Log Levels

Configure log level in values:

```yaml
mcpService:
  config:
    logLevel: "debug"  # Options: debug, info, warn, error
    logFormat: "json"  # Options: json, text
```

Apply change:

```bash
helm upgrade pk-mcp ./charts/personal-knowledge-mcp \
  --namespace pk-mcp \
  --set mcpService.config.logLevel=debug

kubectl -n pk-mcp rollout restart deployment/pk-mcp-service
```

---

## Security Considerations

### Network Policies

The Helm chart includes network policies that enforce:

1. **Default Deny**: All ingress and egress blocked by default
2. **Allowed Traffic**:
   - Ingress controller → MCP service
   - MCP service → ChromaDB
   - MCP service → PostgreSQL
   - DNS egress (kube-dns)
   - External HTTPS (OpenAI API)

#### Verify Network Policies

```bash
# List network policies
kubectl -n pk-mcp get networkpolicies

# Describe policies
kubectl -n pk-mcp describe networkpolicy default-deny
kubectl -n pk-mcp describe networkpolicy allow-mcp-to-chromadb
```

#### Test Policy Effectiveness

```bash
# Deploy test pod (should NOT be able to access ChromaDB)
kubectl -n pk-mcp run test-pod --image=busybox --restart=Never -- sleep 3600

# Wait for pod
kubectl -n pk-mcp wait --for=condition=ready pod/test-pod --timeout=60s

# Attempt to access ChromaDB (should timeout/fail)
kubectl -n pk-mcp exec test-pod -- \
  wget -q -O- --timeout=5 http://chromadb:8000/api/v2/heartbeat
# Expected: wget: download timed out

# Verify MCP service CAN access ChromaDB
kubectl -n pk-mcp exec deployment/pk-mcp-service -- \
  wget -q -O- http://chromadb:8000/api/v2/heartbeat
# Expected: {"nanosecond heartbeat":...}

# Cleanup
kubectl -n pk-mcp delete pod test-pod
```

#### Custom Network Policies

For custom ingress controllers, add labels:

```yaml
networkPolicies:
  enabled: true
  ingressControllerLabels:
    app: kong  # or your ingress controller labels
```

### Secret Management

#### In-Cluster Best Practices

1. **Never commit secrets to Git**
2. **Use RBAC to limit secret access**
3. **Enable encryption at rest for etcd**
4. **Rotate secrets regularly**

#### External Secrets Operator

For production, integrate with cloud secret managers:

```yaml
# ExternalSecret example for AWS Secrets Manager
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: pk-mcp-secrets
  namespace: pk-mcp
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: pk-mcp-secrets
  data:
    - secretKey: OPENAI_API_KEY
      remoteRef:
        key: pk-mcp/openai
        property: api_key
```

#### Secret Rotation

```bash
# Update secret value
kubectl -n pk-mcp create secret generic pk-mcp-secrets \
  --from-literal=OPENAI_API_KEY='sk-new-key' \
  --from-literal=POSTGRES_PASSWORD='same-password' \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart pods to pick up new secrets
kubectl -n pk-mcp rollout restart deployment/pk-mcp-service
```

For detailed secret management, see [Secret Management Guide](../kubernetes/docs/secret-management.md).

### RBAC Configuration

The Helm chart creates a ServiceAccount with minimal permissions.

#### Service Account Setup

```yaml
# Verify service account
kubectl -n pk-mcp get serviceaccount pk-mcp-service

# Check permissions
kubectl auth can-i get secrets \
  --as=system:serviceaccount:pk-mcp:pk-mcp-service \
  -n pk-mcp
```

#### Custom RBAC for Secret Access

```yaml
# Role for reading specific secrets
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: secret-reader
  namespace: pk-mcp
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["pk-mcp-secrets"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pk-mcp-service-secret-reader
  namespace: pk-mcp
subjects:
  - kind: ServiceAccount
    name: pk-mcp-service
roleRef:
  kind: Role
  name: secret-reader
  apiGroup: rbac.authorization.k8s.io
```

#### Pod Security Standards

The Helm chart enforces security contexts:

```yaml
mcpService:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1001
    runAsGroup: 1001
    fsGroup: 1001
  containerSecurityContext:
    allowPrivilegeEscalation: false
    readOnlyRootFilesystem: true
    capabilities:
      drop:
        - ALL
```

---

## Appendix

### Resource Requirements

| Component | CPU Request | CPU Limit | Memory Request | Memory Limit | Storage |
|-----------|-------------|-----------|----------------|--------------|---------|
| MCP Service | 250m | 1 | 256Mi | 1Gi | - |
| ChromaDB | 500m | 2 | 512Mi | 2Gi | 10-50Gi |
| Neo4j | 500m | 2 | 512Mi | 2Gi | 10Gi |
| PostgreSQL | 250m | 2 | 256Mi | 1Gi | 5-20Gi |

**Scaling Recommendations:**

| Workload | MCP Replicas | ChromaDB Storage | PostgreSQL Storage |
|----------|--------------|------------------|-------------------|
| Development | 1 | 10Gi | 5Gi |
| Small (< 10 repos) | 1-2 | 20Gi | 10Gi |
| Medium (10-50 repos) | 2-3 | 50Gi | 20Gi |
| Large (50+ repos) | 3-5 | 100Gi+ | 50Gi+ |

### Configuration Reference

#### Helm Values Reference

See full configuration options:
- [charts/personal-knowledge-mcp/values.yaml](../charts/personal-knowledge-mcp/values.yaml)

#### Example Value Files

- [values-dev.yaml](../charts/personal-knowledge-mcp/examples/values-dev.yaml) - Development settings
- [values-prod.yaml](../charts/personal-knowledge-mcp/examples/values-prod.yaml) - Production settings
- [values-private.yaml](../charts/personal-knowledge-mcp/examples/values-private.yaml) - Private instance
- [values-work.yaml](../charts/personal-knowledge-mcp/examples/values-work.yaml) - Work instance
- [values-public.yaml](../charts/personal-knowledge-mcp/examples/values-public.yaml) - Public instance

#### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging verbosity | `info` |
| `LOG_FORMAT` | Log format (json/text) | `json` |
| `NODE_ENV` | Environment mode | `production` |
| `HTTP_HOST` | HTTP bind address | `0.0.0.0` |
| `HTTP_PORT` | HTTP port | `3001` |
| `CHROMADB_HOST` | ChromaDB hostname | `chromadb` |
| `CHROMADB_PORT` | ChromaDB port | `8000` |
| `EMBEDDING_MODEL` | OpenAI embedding model | `text-embedding-3-small` |

### Related Documentation

- [Kustomize Deployment Guide](../kubernetes/docs/deployment-guide.md) - Alternative to Helm
- [Local Testing Guide](../kubernetes/docs/local-testing.md) - K3s/minikube setup
- [Secret Management Guide](../kubernetes/docs/secret-management.md) - Production secrets
- [Docker Operations Guide](docker-operations.md) - Local development
- [OIDC Deployment Guide](security/oidc-deployment.md) - Enterprise authentication
