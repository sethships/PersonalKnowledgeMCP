# User-to-Instance Authorization Mapping Configuration

This document provides comprehensive guidance on configuring user-to-instance authorization mapping for OIDC-authenticated users in the Personal Knowledge MCP.

## Overview

User mapping allows you to assign specific scopes and instance access based on user identity claims from your OIDC identity provider. Rules are evaluated in priority order (highest first), and the first matching rule determines the user's permissions.

## Configuration File

User mapping rules are stored in `{DATA_PATH}/user-mappings.json`. The file is created automatically with an empty rule set when the service starts.

### File Structure

```json
{
  "version": "1.0",
  "rules": [
    {
      "id": "uuid-string",
      "pattern": "match-pattern",
      "type": "email|email_wildcard|group|role|default",
      "scopes": ["read", "write", "admin"],
      "instanceAccess": ["private", "work", "public"],
      "priority": 100,
      "description": "Human-readable description",
      "enabled": true,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    }
  ],
  "lastModified": "2025-01-01T00:00:00.000Z"
}
```

## Rule Types

### Email (Exact Match)

Matches a specific email address exactly (case-insensitive).

```json
{
  "id": "admin-user",
  "pattern": "admin@company.com",
  "type": "email",
  "scopes": ["read", "write", "admin"],
  "instanceAccess": ["private", "work", "public"],
  "priority": 100,
  "description": "Full admin access for primary administrator",
  "enabled": true
}
```

### Email Wildcard

Matches all users from a specific email domain. The pattern must start with `*@`.

```json
{
  "id": "company-employees",
  "pattern": "*@company.com",
  "type": "email_wildcard",
  "scopes": ["read", "write"],
  "instanceAccess": ["work", "public"],
  "priority": 50,
  "description": "Standard access for company employees",
  "enabled": true
}
```

### Group

Matches users who belong to a specific group (from the IdP's group claims). The pattern uses the format `group:group-name`.

```json
{
  "id": "developers-group",
  "pattern": "group:engineering",
  "type": "group",
  "scopes": ["read", "write"],
  "instanceAccess": ["work", "public"],
  "priority": 60,
  "description": "Engineering team members",
  "enabled": true
}
```

### Role

Matches users who have a specific role assigned (from the IdP's role claims). The pattern uses the format `role:role-name`.

```json
{
  "id": "admin-role",
  "pattern": "role:admin",
  "type": "role",
  "scopes": ["read", "write", "admin"],
  "instanceAccess": ["private", "work", "public"],
  "priority": 80,
  "description": "Users with admin role",
  "enabled": true
}
```

### Default

Matches any authenticated user. Used as a fallback when no other rules match. The pattern must be `*`.

```json
{
  "id": "default-access",
  "pattern": "*",
  "type": "default",
  "scopes": ["read"],
  "instanceAccess": ["public"],
  "priority": 0,
  "description": "Default minimal access for authenticated users",
  "enabled": true
}
```

## Priority Ordering

Rules are evaluated in descending priority order. The first matching rule wins. Recommended priority ranges:

| Priority Range | Use Case |
|----------------|----------|
| 90-100 | Specific user overrides (exact email matches) |
| 70-89 | Role-based access |
| 50-69 | Group-based access |
| 30-49 | Domain-wide rules (email wildcards) |
| 0-29 | Default fallback rules |

## Scopes

Available scopes that can be assigned:

| Scope | Description |
|-------|-------------|
| `read` | Read-only access to search and retrieve knowledge |
| `write` | Can add, update, and manage repositories |
| `admin` | Full administrative access including token management |

## Instance Access

Available instances that users can access:

| Instance | Description |
|----------|-------------|
| `private` | Personal/sensitive knowledge (most restricted) |
| `work` | Work-related repositories |
| `public` | Public/OSS repositories (least restricted) |

## Environment Variables

Configure user mapping behavior via environment variables:

```bash
# Enable/disable user mapping (default: true when OIDC enabled)
USER_MAPPING_ENABLED=true

# Identity provider type for claims extraction
# Options: azure-ad, auth0, generic
OIDC_IDP_TYPE=generic

# Custom claim names (used by generic extractor)
OIDC_GROUP_CLAIM_NAME=groups
OIDC_ROLE_CLAIM_NAME=roles

# File watcher for live configuration updates
USER_MAPPING_FILE_WATCHER=true
USER_MAPPING_DEBOUNCE_MS=500
```

## Identity Provider Configuration

### Azure AD / Entra ID

Set `OIDC_IDP_TYPE=azure-ad` for Microsoft Entra ID. The Azure AD extractor handles:

- `groups` claim (array of group GUIDs or names)
- `wids` claim (directory role GUIDs)
- `roles` claim (application roles)
- `oid` as fallback for `sub` claim
- `upn` and `preferred_username` as fallback for email

**Note**: Azure AD limits group claims to 200 groups in tokens. If users belong to more than 200 groups, you may need to use the Microsoft Graph API to retrieve full group membership.

### Auth0

Set `OIDC_IDP_TYPE=auth0` for Auth0. The Auth0 extractor handles:

- Standard `groups` and `roles` claims
- Namespaced claims (e.g., `https://myapp.com/groups`)
- `permissions` claim as fallback for roles

### Generic / Other IdPs

Set `OIDC_IDP_TYPE=generic` for other OIDC providers. Configure claim names:

```bash
OIDC_GROUP_CLAIM_NAME=custom_groups_claim
OIDC_ROLE_CLAIM_NAME=custom_roles_claim
```

## Example Configuration

Here's a complete example for a typical organization:

```json
{
  "version": "1.0",
  "rules": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "pattern": "admin@company.com",
      "type": "email",
      "scopes": ["read", "write", "admin"],
      "instanceAccess": ["private", "work", "public"],
      "priority": 100,
      "description": "Primary administrator - full access",
      "enabled": true,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440002",
      "pattern": "role:admin",
      "type": "role",
      "scopes": ["read", "write", "admin"],
      "instanceAccess": ["private", "work", "public"],
      "priority": 90,
      "description": "Admin role holders - full access",
      "enabled": true,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440003",
      "pattern": "group:engineering",
      "type": "group",
      "scopes": ["read", "write"],
      "instanceAccess": ["work", "public"],
      "priority": 60,
      "description": "Engineering team - work and public repos",
      "enabled": true,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440004",
      "pattern": "*@company.com",
      "type": "email_wildcard",
      "scopes": ["read"],
      "instanceAccess": ["work", "public"],
      "priority": 40,
      "description": "All company employees - read access",
      "enabled": true,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440005",
      "pattern": "*",
      "type": "default",
      "scopes": ["read"],
      "instanceAccess": ["public"],
      "priority": 0,
      "description": "Default - public read-only",
      "enabled": true,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    }
  ],
  "lastModified": "2025-01-01T00:00:00.000Z"
}
```

## Runtime Updates

When `USER_MAPPING_FILE_WATCHER=true` (default), changes to `user-mappings.json` take effect without restarting the service:

1. Edit the `user-mappings.json` file
2. Save the file
3. Changes are detected within `USER_MAPPING_DEBOUNCE_MS` milliseconds (default: 500ms)
4. New mapping rules apply to subsequent authentications

**Note**: Existing sessions retain their original permissions until they re-authenticate.

## Troubleshooting

### Rules Not Matching

1. **Check priority order**: Higher priority rules are evaluated first
2. **Verify pattern syntax**: Group patterns must be `group:name`, role patterns must be `role:name`
3. **Check enabled flag**: Disabled rules are skipped
4. **Check case sensitivity**: Email matching is case-insensitive, group/role matching is also case-insensitive

### Missing Groups or Roles

1. **Verify IdP type**: Ensure `OIDC_IDP_TYPE` matches your identity provider
2. **Check claim names**: For generic IdP, verify `OIDC_GROUP_CLAIM_NAME` and `OIDC_ROLE_CLAIM_NAME`
3. **Check token claims**: Use a JWT debugger to inspect the actual claims in your tokens
4. **Azure AD limitation**: If using Azure AD with >200 groups, groups may be truncated

### File Watcher Issues

1. **Check permissions**: Ensure the service has read access to the data directory
2. **Check debounce timing**: Rapid edits may be debounced
3. **Restart if needed**: If file watcher fails, restart the service

## Security Considerations

1. **Principle of Least Privilege**: Default rules should grant minimal access
2. **Priority Hierarchy**: Ensure specific overrides have higher priority than broad rules
3. **Regular Audits**: Periodically review mapping rules for accuracy
4. **Disable Unused Rules**: Use `enabled: false` rather than deleting rules for audit trails
5. **Case-Insensitive Matching**: All email and identity matching is case-insensitive to prevent bypass
