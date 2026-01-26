# Microsoft 365 (Entra ID) OIDC Integration Guide

This document provides step-by-step guidance for configuring Personal Knowledge MCP with Microsoft 365 Business Standard using Azure Active Directory (Entra ID) as the OIDC identity provider.

## Overview

Microsoft 365 Business Standard includes Azure Active Directory (now rebranded as Microsoft Entra ID) which supports OpenID Connect (OIDC) authentication. This enables Single Sign-On (SSO) for Personal Knowledge MCP users within your organization.

### Prerequisites

- Microsoft 365 Business Standard (or higher) subscription
- Global Administrator or Application Administrator role in your tenant
- Personal Knowledge MCP deployment with OIDC enabled
- HTTPS endpoint for production deployments (HTTP allowed for localhost development)

## Azure AD App Registration

### Step 1: Access Azure Portal

1. Navigate to [Azure Portal](https://portal.azure.com)
2. Sign in with your Microsoft 365 administrator account
3. Search for "App registrations" in the search bar
4. Select **App registrations** under Services

### Step 2: Create New Registration

1. Click **+ New registration**
2. Enter the following details:

| Field | Value |
|-------|-------|
| Name | `Personal Knowledge MCP` (or your preferred name) |
| Supported account types | **Accounts in this organizational directory only** (Single tenant) |
| Redirect URI | Web: `http://localhost:3001/api/v1/oidc/callback` |

3. Click **Register**

> **Note**: For production, you'll add HTTPS redirect URIs later. Start with localhost for testing.

### Step 3: Record Application Details

After registration, note these values from the **Overview** page:

| Value | Location | Example |
|-------|----------|---------|
| Application (client) ID | Overview page | `12345678-abcd-1234-efgh-123456789abc` |
| Directory (tenant) ID | Overview page | `87654321-dcba-4321-hgfe-987654321xyz` |

These are needed for your `.env` configuration.

### Step 4: Configure Authentication

1. Go to **Authentication** in the left menu
2. Under **Platform configurations**, verify your redirect URI is listed
3. Add additional redirect URIs as needed:
   - Development: `http://localhost:3001/api/v1/oidc/callback`
   - Production: `https://your-domain.com/api/v1/oidc/callback`

4. Under **Implicit grant and hybrid flows**, ensure these are **unchecked**:
   - Access tokens (not needed - we use authorization code flow)
   - ID tokens (not needed - we use authorization code flow)

5. Under **Advanced settings**:
   - Allow public client flows: **No**

6. Click **Save**

### Step 5: Configure API Permissions

1. Go to **API permissions** in the left menu
2. Click **+ Add a permission**
3. Select **Microsoft Graph**
4. Select **Delegated permissions**
5. Add these permissions:
   - `openid` - Sign users in
   - `profile` - View users' basic profile
   - `email` - View users' email address

6. Click **Add permissions**

Your permissions should look like:

| Permission | Type | Status |
|------------|------|--------|
| Microsoft Graph: email | Delegated | Granted for [tenant] |
| Microsoft Graph: openid | Delegated | Granted for [tenant] |
| Microsoft Graph: profile | Delegated | Granted for [tenant] |

> **Note**: These are low-privilege delegated permissions that typically don't require admin consent. However, if your tenant has consent restrictions, click **Grant admin consent for [tenant]**.

### Step 6: Create Client Secret

1. Go to **Certificates & secrets** in the left menu
2. Under **Client secrets**, click **+ New client secret**
3. Enter a description (e.g., `pk-mcp-production`)
4. Select expiration:
   - Development/Testing: 6 months
   - Production: 12-24 months (with rotation plan)
5. Click **Add**
6. **IMMEDIATELY** copy the secret **Value** (shown only once)

> **CRITICAL**: The secret value is only displayed once. If lost, you must create a new secret.

| Field | What to Copy |
|-------|--------------|
| Secret ID | For reference/rotation tracking |
| Value | **This is your OIDC_CLIENT_SECRET** |
| Expires | Note for rotation calendar |

## Environment Configuration

### Tenant-Specific Configuration

Microsoft 365 uses the following OIDC endpoints:

| Setting | Format |
|---------|--------|
| Issuer URL | `https://login.microsoftonline.com/{tenant-id}/v2.0` |
| Discovery Endpoint | `https://login.microsoftonline.com/{tenant-id}/v2.0/.well-known/openid-configuration` |
| Authorization Endpoint | `https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/authorize` |
| Token Endpoint | `https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token` |
| UserInfo Endpoint | `https://graph.microsoft.com/oidc/userinfo` |

Replace `{tenant-id}` with your actual Directory (tenant) ID.

### Environment Variables

Configure the following in your `.env` file:

```bash
# OIDC Configuration - Microsoft 365 / Entra ID
OIDC_ENABLED=true
OIDC_ISSUER=https://login.microsoftonline.com/{tenant-id}/v2.0
OIDC_CLIENT_ID={application-client-id}
OIDC_CLIENT_SECRET={client-secret-value}
OIDC_REDIRECT_URI=http://localhost:3001/api/v1/oidc/callback

# Session Configuration
OIDC_SESSION_TTL_SECONDS=3600
OIDC_REFRESH_BEFORE_EXPIRY_SECONDS=300

# Cookie Security (true for production HTTPS, false for localhost HTTP)
OIDC_COOKIE_SECURE=false

# Default permissions for authenticated users
OIDC_DEFAULT_SCOPES=read,write
OIDC_DEFAULT_INSTANCE_ACCESS=work
```

### Example Configuration (your-tenant.example.com tenant)

> **Note**: Replace all placeholder values (`YOUR-TENANT-ID-HERE`, `YOUR-CLIENT-ID-HERE`) with your actual Azure AD values from Step 3.

```bash
# Example for your-tenant.example.com Microsoft 365 tenant
OIDC_ENABLED=true
OIDC_ISSUER=https://login.microsoftonline.com/YOUR-TENANT-ID-HERE/v2.0
OIDC_CLIENT_ID=YOUR-CLIENT-ID-HERE
OIDC_CLIENT_SECRET=your-secret-value-here
OIDC_REDIRECT_URI=http://localhost:3001/api/v1/oidc/callback
OIDC_SESSION_TTL_SECONDS=3600
OIDC_COOKIE_SECURE=false
OIDC_DEFAULT_SCOPES=read,write
OIDC_DEFAULT_INSTANCE_ACCESS=work
```

## End-to-End Login Flow Testing

### Prerequisites for Testing

1. Ensure Personal Knowledge MCP is running with HTTP transport enabled
2. Verify ChromaDB container is running
3. Confirm `.env` file has correct OIDC configuration

### Test Procedure

#### Step 1: Start the Service

```bash
# Start ChromaDB
docker-compose up -d chromadb

# Start MCP service with HTTP transport
bun run dev
```

Verify the service shows:
```
HTTP transport enabled on port 3001
OIDC enabled
```

#### Step 2: Initiate Login Flow

Open a browser and navigate to:
```
http://localhost:3001/api/v1/oidc/authorize
```

**Expected behavior:**
1. Browser redirects to Microsoft login page
2. Login page shows your organization branding (if configured)
3. URL contains your tenant ID and application ID

#### Step 3: Authenticate

1. Enter your Microsoft 365 credentials
2. Complete MFA if prompted
3. Review permissions consent screen (first login only)
4. Click **Accept**

#### Step 4: Verify Callback

**Expected behavior:**
1. Browser redirects back to `http://localhost:3001/api/v1/oidc/callback`
2. Session cookie is set (`pk_mcp_oidc_session`)
3. User is redirected to success page or original URL

#### Step 5: Verify Session

Check the session is valid:
```bash
# Use curl with the session cookie
curl -v --cookie "pk_mcp_oidc_session=<session-id>" \
  http://localhost:3001/api/v1/oidc/userinfo
```

**Expected response:**
```json
{
  "sub": "AaBbCc123...",
  "email": "user@your-tenant.example.com",
  "name": "User Name"
}
```

### Testing Checklist

- [ ] Authorization redirect works correctly
- [ ] Microsoft login page displays
- [ ] MFA completes successfully (if enabled)
- [ ] Consent screen shows correct permissions
- [ ] Callback processes without errors
- [ ] Session cookie is set
- [ ] User info endpoint returns correct data
- [ ] Refresh endpoint works (`POST /api/v1/oidc/refresh`)
- [ ] Logout endpoint clears session

## Token Refresh Verification

### Automatic Refresh Behavior

Personal Knowledge MCP automatically refreshes tokens when:
- Access token is within `OIDC_REFRESH_BEFORE_EXPIRY_SECONDS` of expiry (default: 5 minutes)
- A valid refresh token exists

### Testing Token Refresh

#### Method 1: Wait for Natural Expiry

1. Set short session TTL for testing:
   ```bash
   OIDC_SESSION_TTL_SECONDS=120
   OIDC_REFRESH_BEFORE_EXPIRY_SECONDS=60
   ```
2. Login and wait ~60 seconds
3. Make an authenticated request
4. Check logs for refresh activity

#### Method 2: Check Logs

Monitor logs for refresh events:
```
[auth:oidc-provider] Token refreshed successfully (sessionId: xxx, metric: oidc.refresh_ms, value: 245)
```

### Refresh Token Notes

Microsoft 365 refresh tokens have specific behaviors:

| Setting | Value |
|---------|-------|
| Default refresh token lifetime | 90 days |
| Maximum refresh token lifetime | Configurable in Entra ID |
| Single-use refresh tokens | Disabled by default |

> **Note**: If using Conditional Access policies, refresh token behavior may vary. Check your Entra ID Token Lifetime policies.

## User Info Mapping

### Microsoft 365 Claims to Internal Format

Personal Knowledge MCP maps Microsoft 365 OIDC claims as follows:

| Microsoft Claim | Internal Field | Description |
|-----------------|----------------|-------------|
| `sub` | `sub` | Unique user identifier (immutable) |
| `email` | `email` | User's primary email |
| `name` | `name` | Display name |
| `picture` | `picture` | Profile photo URL (if available) |

### Claim Sources

Claims are retrieved from:
1. **ID Token** - Primary source for `sub`, `email`, `name`
2. **UserInfo Endpoint** - Fallback and additional claims

### Example User Object

```json
{
  "sub": "AaBbCcDdEeFf112233445566778899",
  "email": "john.doe@your-tenant.example.com",
  "name": "John Doe",
  "picture": null
}
```

> **Note**: Microsoft Graph's UserInfo endpoint may not return `picture`. Profile photos require additional Microsoft Graph API calls which are not currently implemented.

### Permission Mapping

OIDC-authenticated users receive default permissions:

```typescript
{
  mappedScopes: ["read", "write"],      // From OIDC_DEFAULT_SCOPES
  mappedInstanceAccess: ["work", "public"]  // From OIDC_DEFAULT_INSTANCE_ACCESS
}
```

## Error Handling

### Common Error Scenarios

#### 1. Consent Not Granted

**Symptom**: User sees "Need admin approval" or similar error.

**Causes**:
- Tenant requires admin consent for all apps
- User consent is disabled in Entra ID

**Resolution**:
1. In Azure Portal, go to **Enterprise applications** > Your app
2. Click **Permissions**
3. Click **Grant admin consent for [tenant]**

Or modify tenant settings:
1. Go to **Enterprise applications** > **Consent and permissions**
2. Review "User consent settings"

**Error in logs**:
```
[auth:oidc-provider] OIDC code exchange failed
  error: "AADSTS65004: User declined to consent to access the app"
```

#### 2. Token Expired / Invalid Grant

**Symptom**: API calls fail after period of inactivity.

**Causes**:
- Refresh token expired (>90 days inactive)
- User password changed
- User account disabled
- Conditional Access policy blocked refresh

**Resolution**: User must re-authenticate.

**Error in logs**:
```
[auth:oidc-provider] Token refresh failed (re-auth required)
  error: "invalid_grant: AADSTS700084"
  isRetryable: false
```

#### 3. Network Issues

**Symptom**: Login fails with timeout or connection error.

**Causes**:
- Network connectivity issues
- Azure AD service outage
- DNS resolution failure
- Proxy/firewall blocking

**Resolution**:
1. Check network connectivity to `login.microsoftonline.com`
2. Verify DNS resolution
3. Check [Azure Status](https://status.azure.com/) for outages

**Error in logs**:
```
[auth:oidc-provider] OIDC discovery failed
  error: "ETIMEDOUT" or "ENOTFOUND"
```

#### 4. State Mismatch (CSRF)

**Symptom**: "State mismatch" error during callback.

**Causes**:
- Session expired during login
- User opened multiple login tabs
- Browser cookies blocked

**Resolution**:
1. Clear browser cookies for the site
2. Start a fresh login flow
3. Ensure cookies are enabled

**Error in logs**:
```
[auth:oidc-provider] OIDC state mismatch
  expectedState: "abc12345..."
  receivedState: "xyz98765..."
```

#### 5. Redirect URI Mismatch

**Symptom**: "AADSTS50011: The redirect URI specified in the request does not match"

**Causes**:
- Redirect URI not registered in Azure AD
- Protocol mismatch (http vs https)
- Port mismatch

**Resolution**:
1. In Azure Portal, go to **Authentication**
2. Add the exact redirect URI shown in the error
3. Ensure protocol and port match exactly

### Error Response Handling

Personal Knowledge MCP returns structured error responses:

```json
{
  "error": "OIDC_CODE_EXCHANGE_FAILED",
  "message": "Authentication failed: consent required",
  "retryable": false
}
```

| Error Code | Description | Retry? |
|------------|-------------|--------|
| `OIDC_NOT_CONFIGURED` | OIDC not enabled | No |
| `OIDC_DISCOVERY_FAILED` | Cannot reach IdP | Yes |
| `OIDC_STATE_VALIDATION_FAILED` | CSRF validation failed | No (re-login) |
| `OIDC_CODE_EXCHANGE_FAILED` | Token exchange failed | Depends |
| `OIDC_TOKEN_REFRESH_FAILED` | Refresh failed | Depends |
| `OIDC_SESSION_NOT_FOUND` | Session expired | No (re-login) |

## Client Secret Management

### Secret Rotation Procedure

Rotate client secrets before expiration to avoid service disruption.

#### Step 1: Create New Secret (While Old is Active)

1. In Azure Portal, go to **Certificates & secrets**
2. Create a new client secret
3. Copy the new secret value immediately

#### Step 2: Update Application Configuration

1. Update `.env` with new secret:
   ```bash
   OIDC_CLIENT_SECRET=new-secret-value
   ```
2. Restart the MCP service
3. Verify login works with new secret

#### Step 3: Delete Old Secret

1. Wait 24-48 hours to ensure no issues
2. In Azure Portal, delete the old secret
3. Update rotation calendar for next rotation

### Rotation Schedule Recommendation

| Environment | Secret Lifetime | Rotation Schedule |
|-------------|-----------------|-------------------|
| Development | 6 months | Manual, as needed |
| Production | 12 months | Rotate at 10 months |
| High Security | 6 months | Rotate at 5 months |

### Automation with Azure Key Vault (Future Enhancement)

For automated secret rotation, consider:
1. Store secrets in Azure Key Vault
2. Use Key Vault secret rotation policies
3. Configure application to read from Key Vault

## Security Considerations

### Tenant Isolation

Personal Knowledge MCP uses **single-tenant** app registration:
- Only users from your organization can authenticate
- Prevents unauthorized access from other tenants
- Recommended for private/work knowledge bases

### Conditional Access Compatibility

Entra ID Conditional Access policies apply to Personal Knowledge MCP:
- MFA requirements are enforced
- Device compliance checks apply
- Location-based policies apply

Ensure your Conditional Access policies allow:
- Web browser sign-in
- Your deployment location (IP ranges)

### Token Security

| Token Type | Storage | Protection |
|------------|---------|------------|
| Access Token | Server-side session | Never exposed to client |
| Refresh Token | Server-side session | Never exposed to client |
| ID Token | Server-side session | Used for claims only |
| Session Cookie | Client cookie | HttpOnly, SameSite=Lax |

### Session Security

- Sessions are stored server-side in `oidc-sessions.json`
- Session IDs are cryptographically random UUIDs
- Session cookies use HttpOnly flag (prevents XSS access)
- SameSite=Lax prevents CSRF attacks
- Secure flag enabled in production (HTTPS only)

### Audit Logging

Key events are logged for security monitoring:

| Event | Log Level | Description |
|-------|-----------|-------------|
| OIDC discovery | INFO | Provider connection established |
| Authorization URL generated | DEBUG | Login flow started |
| Authentication successful | INFO | User logged in |
| State mismatch | WARN | Potential CSRF attempt |
| Token refresh | DEBUG | Token renewed |
| Token refresh failed | ERROR | Refresh failure |
| Session ended | INFO | User logged out |

### Recommendations

1. **Enable MFA** - Require multi-factor authentication in Entra ID
2. **Review sign-in logs** - Monitor Azure AD sign-in logs for anomalies
3. **Use Conditional Access** - Implement location and device policies
4. **Rotate secrets** - Follow rotation schedule
5. **Limit permissions** - Only request needed scopes
6. **HTTPS in production** - Never use HTTP in production
7. **Configure named locations** - Set up named locations in Entra ID for trusted networks
8. **Avoid application permissions** - Use only delegated permissions; avoid app-only permissions
9. **Enable audit log retention** - Configure extended audit log retention in Azure AD for compliance

## Troubleshooting

### Debug Mode

Enable verbose OIDC logging:

```bash
LOG_LEVEL=debug bun run dev
```

### Verify Discovery

Test OIDC discovery manually:

```bash
curl https://login.microsoftonline.com/{tenant-id}/v2.0/.well-known/openid-configuration | jq
```

Expected keys in response:
- `issuer`
- `authorization_endpoint`
- `token_endpoint`
- `userinfo_endpoint`
- `jwks_uri`

### Common Issues

| Issue | Check | Solution |
|-------|-------|----------|
| Discovery fails | Network connectivity | Check firewall/proxy |
| Login redirects fail | Redirect URI match | Verify exact URI in Azure |
| Token exchange fails | Client secret | Verify secret not expired |
| User info empty | Permissions | Grant profile/email permissions |
| Session not persisting | Cookie settings | Check OIDC_COOKIE_SECURE |

## Related Documentation

- [OIDC Security and Deployment Guide](./oidc-deployment.md)
- [Multi-Client Configuration](../client-configuration.md)
- [Docker Containerization PRD](../pm/Docker-Containerization-PRD.md)

## References

- [Microsoft identity platform documentation](https://learn.microsoft.com/en-us/entra/identity-platform/)
- [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
- [OpenID Connect on Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc)
- [Microsoft identity platform tokens](https://learn.microsoft.com/en-us/entra/identity-platform/security-tokens)
