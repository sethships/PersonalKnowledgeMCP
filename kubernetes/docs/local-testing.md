# Personal Knowledge MCP - Local Testing Guide

This guide covers testing Kubernetes deployments on local clusters (K3s, minikube).

## K3s Setup (Recommended)

K3s is lightweight and works well on Windows/WSL2.

### Install K3s on WSL2

```bash
# Install K3s
curl -sfL https://get.k3s.io | sh -

# Verify installation
sudo k3s kubectl get nodes

# Copy kubeconfig for kubectl access
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $USER:$USER ~/.kube/config
chmod 600 ~/.kube/config

# Verify kubectl works
kubectl get nodes
```

### K3s Features

- Includes Traefik ingress controller by default
- Includes local-path storage provisioner
- Low resource footprint
- Fast startup

## minikube Setup (Alternative)

```bash
# Install minikube
# Windows (chocolatey)
choco install minikube

# Start cluster
minikube start --driver=docker --memory=4096 --cpus=2

# Enable ingress
minikube addons enable ingress

# Verify
kubectl get nodes
```

## Building and Loading the Image

### For K3s

```bash
cd /path/to/PersonalKnowledgeMCP

# Build the image
docker build -t pk-mcp:local .

# Save to tarball
docker save pk-mcp:local -o pk-mcp.tar

# Import to K3s
sudo k3s ctr images import pk-mcp.tar

# Verify
sudo k3s ctr images list | grep pk-mcp
```

### For minikube

```bash
# Build and load directly
minikube image load pk-mcp:local

# Or use minikube's Docker daemon
eval $(minikube docker-env)
docker build -t pk-mcp:local .
```

## Deploying to Local Cluster

### Step 1: Create Namespace and Secrets

```bash
# Create namespace
kubectl create namespace pk-mcp

# Create secrets with test values
kubectl -n pk-mcp create secret generic pk-mcp-secrets \
  --from-literal=OPENAI_API_KEY='sk-test-key-replace-with-real' \
  --from-literal=GITHUB_PAT='' \
  --from-literal=POSTGRES_PASSWORD='localdevpassword' \
  --from-literal=CHROMADB_AUTH_TOKEN=''
```

### Step 2: Deploy Using Local Overlay

```bash
# Apply local overlay
kubectl apply -k kubernetes/overlays/local/

# Watch pods come up
kubectl -n pk-mcp get pods -w
```

### Step 3: Wait for Ready State

```bash
# Wait for all pods to be ready
kubectl -n pk-mcp wait --for=condition=ready pod --all --timeout=300s

# Check status
kubectl -n pk-mcp get all
```

## Testing the Deployment

### Health Check

```bash
# Port forward
kubectl -n pk-mcp port-forward svc/pk-mcp-service 3001:3001 &

# Test health endpoint
curl http://localhost:3001/health

# Expected response:
# {"status":"healthy","version":"1.0.0","uptime":...,"checks":{"chromadb":"connected"}}
```

### ChromaDB Direct Access

```bash
# Port forward ChromaDB
kubectl -n pk-mcp port-forward svc/chromadb 8000:8000 &

# Test heartbeat
curl http://localhost:8000/api/v2/heartbeat
```

### PostgreSQL Access

```bash
# Port forward PostgreSQL
kubectl -n pk-mcp port-forward svc/postgres 5432:5432 &

# Connect with psql (if installed)
PGPASSWORD=localdevpassword psql -h localhost -U pk_mcp -d personal_knowledge
```

## Testing Network Policies

Network policies isolate pods. Test that they work:

```bash
# Deploy a test pod (should not be able to access ChromaDB)
kubectl -n pk-mcp run test-pod --image=busybox --restart=Never -- sleep 3600

# Wait for pod
kubectl -n pk-mcp wait --for=condition=ready pod/test-pod --timeout=60s

# Try to access ChromaDB (should timeout/fail)
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

## Testing Ingress

### K3s with Traefik

```bash
# Add hosts entry
echo "127.0.0.1 pk-mcp.local" | sudo tee -a /etc/hosts

# Test via ingress
curl http://pk-mcp.local/health

# If using WSL2, you may need to use the Windows hosts file
# Add to C:\Windows\System32\drivers\etc\hosts:
# 127.0.0.1 pk-mcp.local
```

### minikube with NGINX

```bash
# Get minikube IP
minikube ip

# Add to /etc/hosts
echo "$(minikube ip) pk-mcp.local" | sudo tee -a /etc/hosts

# Test
curl http://pk-mcp.local/health
```

## Multi-Instance Testing

```bash
# Deploy all instances
kubectl apply -k kubernetes/multi-instance/private/
kubectl apply -k kubernetes/multi-instance/work/
kubectl apply -k kubernetes/multi-instance/public/

# Verify namespaces created
kubectl get namespaces | grep pk-mcp

# Check pods in each namespace
kubectl -n pk-mcp-private get pods
kubectl -n pk-mcp-work get pods
kubectl -n pk-mcp-public get pods

# Test isolation - each instance has its own ChromaDB
kubectl -n pk-mcp-private port-forward svc/chromadb-private 8000:8000 &
curl http://localhost:8000/api/v2/heartbeat
```

## Debugging

### View Logs

```bash
# MCP service logs
kubectl -n pk-mcp logs -f deployment/pk-mcp-service

# ChromaDB logs
kubectl -n pk-mcp logs -f statefulset/chromadb

# PostgreSQL logs
kubectl -n pk-mcp logs -f statefulset/postgres

# Init container logs
kubectl -n pk-mcp logs deployment/pk-mcp-service -c wait-for-chromadb
```

### Describe Resources

```bash
# Pod details
kubectl -n pk-mcp describe pod -l app.kubernetes.io/component=mcp-service

# Events
kubectl -n pk-mcp get events --sort-by='.lastTimestamp'
```

### Shell Access

```bash
# Shell into MCP service pod
kubectl -n pk-mcp exec -it deployment/pk-mcp-service -- /bin/sh

# Shell into ChromaDB pod
kubectl -n pk-mcp exec -it chromadb-0 -- /bin/bash
```

## Cleanup

```bash
# Delete single instance deployment
kubectl delete -k kubernetes/overlays/local/

# Delete multi-instance deployments
kubectl delete -k kubernetes/multi-instance/private/
kubectl delete -k kubernetes/multi-instance/work/
kubectl delete -k kubernetes/multi-instance/public/

# Delete persistent volume claims (data will be lost!)
kubectl -n pk-mcp delete pvc --all
```

## Common Issues

### Image Pull Errors

```
Error: ErrImageNeverPull
```

Solution: Ensure image is loaded into the cluster:
```bash
# K3s
sudo k3s ctr images import pk-mcp.tar

# minikube
minikube image load pk-mcp:local
```

### PVC Pending

```
PersistentVolumeClaim is stuck in Pending
```

Solution: Check storage class exists:
```bash
kubectl get storageclass
# For K3s, should see local-path
# For minikube, should see standard
```

### Init Container Timeout

```
Init container wait-for-chromadb not completing
```

Solution: Check ChromaDB pod status:
```bash
kubectl -n pk-mcp describe pod chromadb-0
kubectl -n pk-mcp logs chromadb-0
```

## Next Steps

- [Deployment Guide](deployment-guide.md) - Production deployment
- [Secret Management](secret-management.md) - Secure secret handling
