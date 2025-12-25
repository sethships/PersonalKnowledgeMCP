# OIDC Security and Deployment Guide

This document provides security guidance for deploying Personal Knowledge MCP with OIDC authentication.

## Overview

OIDC (OpenID Connect) authentication enables enterprise SSO integration. When enabled, users authenticate via their identity provider (Microsoft Entra ID, Okta, Auth0, etc.) and receive session cookies for subsequent requests.

## Security Architecture

### Authentication Flow

1. User initiates login via `/api/v1/oidc/authorize`
2. Server generates PKCE challenge and stores state in session
3. User redirects to IdP for authentication
4. IdP redirects back to `/api/v1/oidc/callback` with authorization code
5. Server exchanges code for tokens using PKCE verifier
6. Session cookie set with user identity and tokens

### Security Measures

| Feature | Implementation |
|---------|---------------|
| PKCE (RFC 7636) | S256 challenge method prevents authorization code interception |
| State Parameter | Random state prevents CSRF attacks during OAuth flow |
| Cookie Security | HttpOnly, SameSite=Lax, Secure (configurable) |
| Open Redirect Protection | Origin-based validation, blocks protocol-relative URLs |
| Rate Limiting | OIDC endpoints protected by rate limiting middleware |
| Session Expiry | Configurable TTL with automatic cleanup |

## Session Storage Security

### File-Based Storage

OIDC sessions are stored in `{DATA_PATH}/oidc-sessions.json`. This file contains sensitive data:

- Access tokens
- Refresh tokens
- ID tokens
- User identifiers

### Linux/macOS (Recommended)

File permissions are automatically set to `0600` (owner read/write only):

```bash
# Verify permissions
ls -la data/oidc-sessions.json
# Should show: -rw------- 1 user user ... oidc-sessions.json
```

### Windows (Special Considerations)

**SECURITY WARNING:** The `chmod` command is ineffective on Windows. Default file permissions may allow other users to read session data.

**Mitigations:**

1. **Use NTFS ACLs** to restrict access:
   ```powershell
   # Remove inherited permissions and grant only to current user
   icacls data\oidc-sessions.json /inheritance:r /grant:r "%USERNAME%:F"
   ```

2. **Use a dedicated service account** with restricted permissions

3. **Deploy on Linux** for production environments

4. **Consider database-backed session storage** for multi-user systems (future enhancement)

### Automatic Session Cleanup

Expired sessions are automatically cleaned up every 5 minutes by default. Configure cleanup interval:

```typescript
const sessionStore = OidcSessionStoreImpl.getInstanceWithAutoCleanup(
  dataPath,
  sessionTtlSeconds,
  cleanupIntervalMs // default: 300000 (5 minutes)
);
```

## Production Deployment Checklist

### Required Settings

- [ ] `OIDC_ENABLED=true`
- [ ] `OIDC_ISSUER` - Your IdP issuer URL
- [ ] `OIDC_CLIENT_ID` - OAuth2 client ID
- [ ] `OIDC_CLIENT_SECRET` - OAuth2 client secret (keep secret!)
- [ ] `OIDC_REDIRECT_URI` - Must use HTTPS in production

### Recommended Settings

- [ ] `OIDC_COOKIE_SECURE=true` - Requires HTTPS
- [ ] `NODE_ENV=production` - Enables secure defaults
- [ ] Configure appropriate `OIDC_SESSION_TTL_SECONDS`
- [ ] Deploy behind reverse proxy with TLS termination

### IdP Configuration

Configure your identity provider with:

1. **Redirect URI**: `https://your-domain/api/v1/oidc/callback`
2. **Grant Type**: Authorization Code with PKCE
3. **Scopes**: `openid email profile`
4. **Response Type**: `code`

## Rate Limiting

OIDC endpoints are protected by rate limiting to prevent:

- Brute force attacks on authorization flow
- Session enumeration via callback endpoint
- Resource exhaustion

Default limits apply from the global rate limiting configuration.

## Monitoring and Logging

### Log Events

The following events are logged for security monitoring:

| Event | Level | Description |
|-------|-------|-------------|
| OIDC session created | DEBUG | New auth flow started |
| OIDC authentication successful | INFO | User authenticated |
| OIDC state mismatch | WARN | Potential CSRF attempt |
| Cross-origin redirect blocked | WARN | Open redirect attempt |
| Session cleanup | INFO | Expired sessions removed |
| Token refresh failed | ERROR | Token refresh error |

### Metrics

Key metrics to monitor:

- `oidc.discovery_ms` - OIDC provider discovery time
- `oidc.callback_ms` - Authorization callback processing time
- `oidc.refresh_ms` - Token refresh time
- `oidc_session_store.load_ms` - Session store load time
- `oidc_session_store.save_ms` - Session store save time

## Incident Response

### Session Compromise

If session tokens are compromised:

1. Delete `oidc-sessions.json` to invalidate all sessions
2. Users will need to re-authenticate
3. Review access logs for unauthorized activity
4. Rotate OAuth2 client credentials if necessary

### IdP Issues

If your identity provider is unavailable:

1. OIDC authentication will fail with discovery errors
2. Existing sessions remain valid until expiry
3. Bearer token authentication continues to work
4. Consider implementing fallback authentication

## Future Enhancements

Planned security improvements:

- Database-backed session storage (PostgreSQL)
- Token encryption at rest
- Session binding to client fingerprint
- Audit logging for compliance

## Related Documentation

- [Microsoft 365 (Entra ID) Integration Guide](./microsoft365-integration.md)
- [Multi-Client Configuration](../client-configuration.md)
- [Authentication Overview](../MCP_INTEGRATION_GUIDE.md)
- [Rate Limiting Configuration](../troubleshooting.md)
