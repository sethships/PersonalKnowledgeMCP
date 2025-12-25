# Personal Knowledge MCP - Secret Management Guide

This guide covers secure handling of secrets in Kubernetes deployments.

## Required Secrets

The following secrets are required for Personal Knowledge MCP:

| Secret Key | Required | Description |
|------------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for embedding generation |
| `POSTGRES_PASSWORD` | Yes | PostgreSQL database password |
| `GITHUB_PAT` | No | GitHub PAT for private repository access |
| `CHROMADB_AUTH_TOKEN` | No | ChromaDB authentication token |

## Creating Secrets

### Development (Manual Creation)

For local development, create secrets manually:

```bash
# Create namespace if not exists
kubectl create namespace pk-mcp

# Create secret with all required values
kubectl -n pk-mcp create secret generic pk-mcp-secrets \
  --from-literal=OPENAI_API_KEY='sk-your-openai-key' \
  --from-literal=POSTGRES_PASSWORD='your-secure-password' \
  --from-literal=GITHUB_PAT='ghp_your-github-pat' \
  --from-literal=CHROMADB_AUTH_TOKEN='optional-token'
```

### From Environment File

Create a `.env.secrets` file (DO NOT commit to git):

```bash
OPENAI_API_KEY=sk-your-openai-key
POSTGRES_PASSWORD=your-secure-password
GITHUB_PAT=ghp_your-github-pat
CHROMADB_AUTH_TOKEN=
```

Create secret from file:

```bash
kubectl -n pk-mcp create secret generic pk-mcp-secrets \
  --from-env-file=.env.secrets
```

## Production: SealedSecrets

For GitOps workflows, use SealedSecrets to encrypt secrets in your repository.

### Install SealedSecrets

```bash
# Install the controller
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.24.0/controller.yaml

# Install kubeseal CLI
# macOS
brew install kubeseal

# Linux
wget https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.24.0/kubeseal-0.24.0-linux-amd64.tar.gz
tar -xvzf kubeseal-*.tar.gz
sudo install -m 755 kubeseal /usr/local/bin/kubeseal
```

### Create SealedSecret

```bash
# Create a regular secret manifest (don't apply it)
kubectl -n pk-mcp create secret generic pk-mcp-secrets \
  --from-literal=OPENAI_API_KEY='sk-your-key' \
  --from-literal=POSTGRES_PASSWORD='your-password' \
  --dry-run=client -o yaml > secret.yaml

# Seal the secret
kubeseal --format yaml < secret.yaml > sealed-secret.yaml

# Apply the sealed secret (safe to commit to git)
kubectl apply -f sealed-secret.yaml

# Remove the unencrypted file!
rm secret.yaml
```

### Store in Overlay

Place the sealed secret in your production overlay:

```
kubernetes/overlays/production/secrets/
└── sealed-secret.yaml
```

Update kustomization.yaml:

```yaml
resources:
  - ../../base
  - secrets/sealed-secret.yaml
```

## Production: External Secrets Operator

For integration with cloud secret managers (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault).

### Install External Secrets Operator

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace
```

### Example: AWS Secrets Manager

Create ExternalSecret resource:

```yaml
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
    - secretKey: POSTGRES_PASSWORD
      remoteRef:
        key: pk-mcp/postgres
        property: password
```

## Secret Rotation

### Rotating OpenAI API Key

1. Generate new API key at https://platform.openai.com/api-keys
2. Update the secret:

```bash
kubectl -n pk-mcp create secret generic pk-mcp-secrets \
  --from-literal=OPENAI_API_KEY='sk-new-key' \
  --from-literal=POSTGRES_PASSWORD='existing-password' \
  --from-literal=GITHUB_PAT='existing-pat' \
  --from-literal=CHROMADB_AUTH_TOKEN='existing-token' \
  --dry-run=client -o yaml | kubectl apply -f -
```

3. Restart the deployment to pick up new secret:

```bash
kubectl -n pk-mcp rollout restart deployment/pk-mcp-service
```

4. Revoke old API key

### Rotating PostgreSQL Password

1. Update secret with new password
2. Connect to PostgreSQL and change password:

```bash
kubectl -n pk-mcp exec -it postgres-0 -- psql -U pk_mcp -d personal_knowledge -c \
  "ALTER USER pk_mcp WITH PASSWORD 'new-secure-password';"
```

3. Restart MCP service

### Rotating ChromaDB Token

1. Update secret with new token
2. Restart both ChromaDB and MCP service:

```bash
kubectl -n pk-mcp rollout restart statefulset/chromadb
kubectl -n pk-mcp rollout restart deployment/pk-mcp-service
```

## Backup and Recovery

### Backup Secrets

```bash
# Export secrets (base64 encoded, still sensitive!)
kubectl -n pk-mcp get secret pk-mcp-secrets -o yaml > secrets-backup.yaml

# Store securely (encrypt with GPG, store in vault, etc.)
gpg --symmetric --cipher-algo AES256 secrets-backup.yaml
rm secrets-backup.yaml
```

### Restore Secrets

```bash
# Decrypt backup
gpg --decrypt secrets-backup.yaml.gpg > secrets-backup.yaml

# Apply
kubectl apply -f secrets-backup.yaml

# Clean up
rm secrets-backup.yaml
```

## Security Best Practices

### 1. Never Commit Secrets

Add to `.gitignore`:

```gitignore
# Secrets
*.secrets
.env.secrets
secrets-backup.yaml
secret.yaml
```

### 2. Use RBAC

Limit who can read secrets:

```yaml
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

### 3. Audit Secret Access

Enable Kubernetes audit logging for secret access:

```yaml
# audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets"]
```

### 4. Use Network Policies

Secrets are only useful if pods can use them. Network policies limit which pods can access services that use secrets.

### 5. Encrypt etcd

For production clusters, enable etcd encryption at rest:

```yaml
# encryption-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - aescbc:
          keys:
            - name: key1
              secret: <base64-encoded-secret>
      - identity: {}
```

## Troubleshooting

### Secret Not Found

```
Error: secret "pk-mcp-secrets" not found
```

Solution: Create the secret or check namespace:

```bash
kubectl get secrets -A | grep pk-mcp
```

### Secret Key Missing

```
Error: couldn't find key OPENAI_API_KEY in Secret pk-mcp-secrets
```

Solution: Verify secret contents:

```bash
kubectl -n pk-mcp get secret pk-mcp-secrets -o jsonpath='{.data}' | jq
```

### Permission Denied

```
Error: secrets "pk-mcp-secrets" is forbidden
```

Solution: Check RBAC permissions:

```bash
kubectl auth can-i get secrets -n pk-mcp --as=system:serviceaccount:pk-mcp:pk-mcp-service
```

## Next Steps

- [Deployment Guide](deployment-guide.md) - Full deployment instructions
- [Local Testing](local-testing.md) - Testing on local clusters
