# Docker Containerization Implementation Roadmap

**Date:** 2025-12-21
**Status:** Planning
**Parent PRD:** [Docker-Containerization-PRD.md](./Docker-Containerization-PRD.md)
**Repository:** sethships/PersonalKnowledgeMCP

---

## Executive Summary

This roadmap defines the implementation plan for containerizing and hardening the Personal Knowledge MCP system. The initiative spans three phases, progressing from Docker Compose hardening through multi-transport MCP support with authentication to enterprise-ready Kubernetes deployment.

**Key Deliverables:**
- **Phase 2**: Production-hardened Docker Compose with ChromaDB security, backup automation, and PostgreSQL preparation
- **Phase 3**: Multi-transport MCP (stdio + HTTP/SSE), bearer token authentication, multi-instance support
- **Phase 4**: OIDC integration with Microsoft 365, Kubernetes manifests, and high-availability deployment

**Decision Summary:**
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Docker MCP Toolkit | **Not Used** | Architectural mismatch with stateful service |
| Primary Deployment | Docker Compose | Appropriate for persistent storage needs |
| Multi-Client Support | HTTP/SSE Transport | Protocol-native solution for cross-client compatibility |
| Authentication | Bearer Token (Phase 3), OIDC (Phase 4) | Progressive security model |
| Kubernetes | Phase 4+ | Deferred until multi-instance scaling required |

---

## Phase Breakdown

### Phase 2: Docker Compose Hardening

**Goal:** Production-harden the existing Docker Compose deployment with security, observability, and data protection.

**Target Timeline:** Q1 2026 (estimated 3-4 weeks of development effort)

**Deliverables:**

| Deliverable | Description | Priority |
|-------------|-------------|----------|
| ChromaDB Hardening | Resource limits, health checks, authentication | P0 |
| Backup Automation | Scripted backup/restore with retention policies | P0 |
| Localhost Binding | Bind all ports to 127.0.0.1 only | P0 |
| Logging Configuration | Structured logging with rotation | P1 |
| PostgreSQL Preparation | Container config for Phase 2 document store | P1 |
| Operational Documentation | Runbooks for common operations | P1 |

**Issues:**
- [Infrastructure] ChromaDB Container Hardening
- [Infrastructure] Volume Backup and Restore Automation
- [Security] ChromaDB Authentication Configuration
- [Infrastructure] PostgreSQL Container Configuration
- [Documentation] Docker Operations Runbook Update

### Phase 3: Multi-Transport + Authentication

**Goal:** Enable cross-client compatibility with HTTP/SSE transport and implement bearer token security.

**Target Timeline:** Q2 2026 (estimated 4-6 weeks of development effort)

**Deliverables:**

| Deliverable | Description | Priority |
|-------------|-------------|----------|
| HTTP/SSE Transport | Streamable HTTP per MCP 2025-03-26 spec | P0 |
| Bearer Token Auth | Token service, middleware, CLI management | P0 |
| Multi-Instance Routing | Instance-aware request handling | P0 |
| Rate Limiting | Protect HTTP endpoints from abuse | P1 |
| CORS Configuration | Support browser-based clients | P1 |
| Client Configuration Guides | Cursor, VS Code, generic HTTP | P1 |

**Issues:**
- [Feature] HTTP/SSE Transport Implementation
- [Feature] Streamable HTTP Transport Support
- [Security] Bearer Token Authentication Service
- [Security] Authentication Middleware
- [Feature] Token Management CLI Commands
- [Feature] Multi-Instance Routing and Configuration
- [Infrastructure] Rate Limiting for HTTP Endpoints
- [Feature] CORS Configuration for HTTP Transport
- [Documentation] Multi-Client Configuration Guide

### Phase 4: OIDC + Kubernetes

**Goal:** Enterprise-ready deployment with OIDC authentication and Kubernetes orchestration.

**Target Timeline:** Q3-Q4 2026 (estimated 6-8 weeks of development effort)

**Deliverables:**

| Deliverable | Description | Priority |
|-------------|-------------|----------|
| OIDC Integration | Microsoft 365 authentication | P0 |
| Kubernetes Manifests | Deployments, services, ingress | P0 |
| Helm Charts | Parameterized K8s deployment | P1 |
| Neo4j Container | Graph database for relationships | P1 |
| High Availability | Replication and failover patterns | P2 |
| Audit Logging | Security event tracking | P1 |

**Issues:**
- [Security] OIDC Provider Implementation
- [Security] Microsoft 365 Integration
- [Infrastructure] Kubernetes Deployment Manifests
- [Infrastructure] Helm Chart Development
- [Infrastructure] Neo4j Container Configuration
- [Feature] User-to-Instance Authorization Mapping
- [Security] Audit Logging Implementation
- [Documentation] Kubernetes Deployment Guide

---

## Issue Dependency Graph

### Phase 2 Dependencies

```
[EPIC] Docker Containerization
        |
        +-- Phase 2: Docker Compose Hardening
                |
                +-- ChromaDB Container Hardening (P0)
                |       |
                |       +-- ChromaDB Authentication Configuration (P0)
                |
                +-- Volume Backup and Restore Automation (P0)
                |
                +-- PostgreSQL Container Configuration (P1)
                |       |
                |       +-- (blocks Phase 3/4 document store work)
                |
                +-- Docker Operations Runbook Update (P1)
                        |
                        +-- (depends on all Phase 2 implementation)
```

### Phase 3 Dependencies

```
Phase 2 Complete
        |
        +-- Phase 3: Multi-Transport + Authentication
                |
                +-- HTTP/SSE Transport Implementation (P0)
                |       |
                |       +-- Streamable HTTP Transport Support (P0)
                |       |
                |       +-- CORS Configuration (P1)
                |       |
                |       +-- Rate Limiting (P1)
                |
                +-- Bearer Token Authentication Service (P0)
                |       |
                |       +-- Authentication Middleware (P0)
                |       |       |
                |       |       +-- (blocks: Rate Limiting, Multi-Instance Routing)
                |       |
                |       +-- Token Management CLI Commands (P0)
                |
                +-- Multi-Instance Routing (P0)
                |       |
                |       +-- (depends on: Auth Middleware, HTTP Transport)
                |
                +-- Multi-Client Configuration Guide (P1)
                        |
                        +-- (depends on all Phase 3 features)
```

### Phase 4 Dependencies

```
Phase 3 Complete
        |
        +-- Phase 4: OIDC + Kubernetes
                |
                +-- OIDC Provider Implementation (P0)
                |       |
                |       +-- Microsoft 365 Integration (P0)
                |       |
                |       +-- User-to-Instance Authorization Mapping (P0)
                |       |
                |       +-- Audit Logging Implementation (P1)
                |
                +-- Kubernetes Deployment Manifests (P0)
                |       |
                |       +-- Helm Chart Development (P1)
                |
                +-- Neo4j Container Configuration (P1)
                |
                +-- Kubernetes Deployment Guide (P1)
                        |
                        +-- (depends on all Phase 4 features)
```

### Cross-Phase Dependencies

```
Phase 1 (Complete)
        |
        +-- Phase 2: Docker Compose Hardening
        |       |
        |       +-- ChromaDB Hardening blocks all Phase 3 work
        |       +-- PostgreSQL Config blocks Phase 4 Neo4j patterns
        |
        +-- Phase 3: Multi-Transport + Authentication
        |       |
        |       +-- HTTP Transport blocks OIDC implementation
        |       +-- Auth Middleware blocks OIDC middleware
        |       +-- Multi-Instance Routing blocks K8s instance management
        |
        +-- Phase 4: OIDC + Kubernetes
```

---

## Risk Assessment

### High Impact Risks

| Risk | Impact | Probability | Mitigation | Phase |
|------|--------|-------------|------------|-------|
| HTTP transport latency exceeds targets | High | Medium | Benchmark early; optimize connection pooling; keep stdio primary for Claude Code | Phase 3 |
| Token security breach | High | Low | Hash tokens at rest; implement rotation; audit logging; short expiration | Phase 3 |
| OIDC integration complexity | High | Medium | Use well-tested openid-client library; extensive testing with test tenant | Phase 4 |
| Backup data corruption | High | Low | Verify backups periodically; multiple retention copies; restore testing | Phase 2 |

### Medium Impact Risks

| Risk | Impact | Probability | Mitigation | Phase |
|------|--------|-------------|------------|-------|
| Multi-instance complexity | Medium | Medium | Start with single instance; add isolation incrementally | Phase 3 |
| Kubernetes learning curve | Medium | Medium | Use managed K8s initially; leverage existing Helm patterns | Phase 4 |
| ChromaDB version upgrades break compatibility | Medium | Medium | Pin versions; test upgrades in staging; backup before upgrade | Phase 2 |
| MCP SDK transport API changes | Medium | Low | Pin SDK version; monitor changelog; adapt as needed | Phase 3 |

### Low Impact Risks

| Risk | Impact | Probability | Mitigation | Phase |
|------|--------|-------------|------------|-------|
| Rate limiting blocks legitimate use | Low | Medium | Start with generous limits; monitor and adjust | Phase 3 |
| Neo4j resource consumption | Low | Medium | Set appropriate resource limits; monitor usage | Phase 4 |

---

## Success Criteria Per Phase

### Phase 2 Success Criteria

| Criteria | Target | Measurement Method |
|----------|--------|-------------------|
| Container uptime | 99.9% over 30 days | Docker stats monitoring |
| Backup success rate | 100% | Automated backup logs |
| Restore time | < 5 minutes | Manual testing with timer |
| Resource utilization | < 80% of limits | Docker stats during peak load |
| ChromaDB auth enabled | Token required for access | Manual verification |
| All ports localhost-bound | No external access | netstat/port scan verification |
| Health checks passing | Continuous green | Docker health status |

### Phase 3 Success Criteria

| Criteria | Target | Measurement Method |
|----------|--------|-------------------|
| HTTP query latency (p95) | < 600ms | Response time monitoring |
| HTTP query latency (p50) | < 300ms | Response time monitoring |
| Authentication success rate | > 99.9% | Auth middleware logs |
| Multi-client compatibility | 3+ clients tested | Manual testing matrix |
| Token generation/validation | < 10ms | Unit test benchmarks |
| stdio transport unaffected | < 500ms p95 | Existing performance tests |
| Instance isolation verified | 100% | Security test suite |

### Phase 4 Success Criteria

| Criteria | Target | Measurement Method |
|----------|--------|-------------------|
| OIDC login success rate | > 99% | Auth provider logs |
| Kubernetes deployment time | < 30 minutes from scratch | Timed deployment exercise |
| Pod restart recovery | < 60 seconds | Kubernetes events monitoring |
| Cross-instance isolation | 100% verified | Security audit |
| Helm chart parameterization | All configs externalized | Template review |
| Audit log completeness | All auth events captured | Log analysis |

---

## Timeline Considerations

### Sequencing Requirements

1. **Phase 2 must complete before Phase 3** - HTTP transport requires hardened infrastructure
2. **ChromaDB auth must precede HTTP transport** - Security foundation required
3. **Bearer token auth must precede OIDC** - Progressive complexity approach
4. **HTTP transport must precede OIDC** - OIDC flows require HTTP callbacks

### Parallelization Opportunities

**Within Phase 2:**
- ChromaDB hardening and PostgreSQL config can proceed in parallel
- Backup automation can start after basic hardening complete
- Documentation can proceed alongside implementation

**Within Phase 3:**
- HTTP transport and token service can be developed in parallel initially
- Auth middleware depends on token service
- Client guides depend on all other Phase 3 work

**Within Phase 4:**
- OIDC and Kubernetes work can largely proceed in parallel
- Helm charts depend on base Kubernetes manifests
- Audit logging can proceed with OIDC implementation

### Effort Estimates

| Phase | Development Effort | Calendar Time (Solo Dev) | Calendar Time (2 Devs) |
|-------|-------------------|--------------------------|------------------------|
| Phase 2 | 3-4 weeks | 4-6 weeks | 2-3 weeks |
| Phase 3 | 4-6 weeks | 6-8 weeks | 3-4 weeks |
| Phase 4 | 6-8 weeks | 8-12 weeks | 4-6 weeks |

*Note: Calendar time includes testing, code review, and documentation.*

---

## Issue Summary

### Phase 2 Issues (5 total)

| Issue Title | Priority | Labels | Dependencies |
|-------------|----------|--------|--------------|
| [Infrastructure] ChromaDB Container Hardening | P0 | phase-2, infrastructure, security | None |
| [Security] ChromaDB Authentication Configuration | P0 | phase-2, security | ChromaDB Hardening |
| [Infrastructure] Volume Backup and Restore Automation | P0 | phase-2, infrastructure | ChromaDB Hardening |
| [Infrastructure] PostgreSQL Container Configuration | P1 | phase-2, infrastructure | None |
| [Documentation] Docker Operations Runbook Update | P1 | phase-2, documentation | All Phase 2 impl |

### Phase 3 Issues (9 total)

| Issue Title | Priority | Labels | Dependencies |
|-------------|----------|--------|--------------|
| [Feature] HTTP/SSE Transport Implementation | P0 | phase-3, feature | Phase 2 Complete |
| [Feature] Streamable HTTP Transport Support | P0 | phase-3, feature | HTTP/SSE Transport |
| [Security] Bearer Token Authentication Service | P0 | phase-3, security | Phase 2 Complete |
| [Security] Authentication Middleware | P0 | phase-3, security | Token Service |
| [Feature] Token Management CLI Commands | P0 | phase-3, feature | Token Service |
| [Feature] Multi-Instance Routing and Configuration | P0 | phase-3, feature | Auth Middleware, HTTP Transport |
| [Infrastructure] Rate Limiting for HTTP Endpoints | P1 | phase-3, infrastructure, security | Auth Middleware |
| [Feature] CORS Configuration for HTTP Transport | P1 | phase-3, feature | HTTP Transport |
| [Documentation] Multi-Client Configuration Guide | P1 | phase-3, documentation | All Phase 3 features |

### Phase 4 Issues (8 total)

| Issue Title | Priority | Labels | Dependencies |
|-------------|----------|--------|--------------|
| [Security] OIDC Provider Implementation | P0 | phase-4, security | Phase 3 Complete |
| [Security] Microsoft 365 Integration | P0 | phase-4, security | OIDC Provider |
| [Infrastructure] Kubernetes Deployment Manifests | P0 | phase-4, infrastructure | Phase 3 Complete |
| [Infrastructure] Helm Chart Development | P1 | phase-4, infrastructure | K8s Manifests |
| [Infrastructure] Neo4j Container Configuration | P1 | phase-4, infrastructure | PostgreSQL patterns |
| [Feature] User-to-Instance Authorization Mapping | P0 | phase-4, feature, security | OIDC Provider, Multi-Instance |
| [Security] Audit Logging Implementation | P1 | phase-4, security | Auth services |
| [Documentation] Kubernetes Deployment Guide | P1 | phase-4, documentation | All Phase 4 features |

**Total: 22 issues + 1 EPIC**

---

## Open Questions

### To Be Resolved Before Phase 3

1. **Remote access strategy** - VPN vs Tailscale vs CloudFlare Tunnel?
   - Current recommendation: Tailscale for simplicity
   - Decision owner: Project lead
   - Decision deadline: Before HTTP transport implementation

### To Be Resolved Before Phase 4

2. **Kubernetes managed vs self-hosted** - Which approach?
   - Options: Home lab K3s, cloud-managed (AKS, EKS), hybrid
   - Decision owner: Project lead
   - Decision deadline: Before Kubernetes work begins

3. **ChromaDB clustering maturity** - Is it production-ready?
   - Monitor ChromaDB roadmap throughout Phases 2-3
   - May need to evaluate alternatives (Qdrant, Weaviate)
   - Decision deadline: Before Phase 4 HA implementation

---

## References

### Internal Documents
- [Docker Containerization PRD](./Docker-Containerization-PRD.md) - Full requirements
- [Phase 1 Implementation Roadmap](./phase1-implementation-roadmap.md) - Prior phase pattern
- [High-level Personal Knowledge MCP PRD](../High-level-Personal-Knowledge-MCP-PRD.md) - Product vision

### External References
- [MCP Transports Specification (2025-03-26)](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
- [MCP Streamable HTTP Transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http)
- [ChromaDB Docker Documentation](https://docs.trychroma.com/deployment/docker)
- [OpenID Connect Core Specification](https://openid.net/specs/openid-connect-core-1_0.html)

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-21 | Program Manager | Initial roadmap from PRD analysis |

---

*This roadmap will be updated as issues are created and implementation progresses.*

---

## AMENDMENT: Phase 4.0 - Graph Database Migration (Added 2026-01-26)

**Priority**: FIRST - Before all other Phase 4 work
**Rationale**: Neo4j Community Edition uses GPLv3 (copyleft), incompatible with project's MIT license goals

### Decision

Migrate from Neo4j to **FalkorDB (Apache 2.0)** - see [ADR-0004](../architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md)

### Work Breakdown

| Work Item | Size | Effort | Dependencies |
|-----------|------|--------|--------------|
| Create GraphStorageAdapter Interface | M | 2-3 days | None |
| Implement FalkorDBAdapter | M | 3-4 days | Adapter Interface |
| Data Migration Tooling | S | 1-2 days | FalkorDBAdapter |
| Docker Compose Update (FalkorDB) | S | 1 day | FalkorDBAdapter |
| Test Suite Migration | M | 3-5 days | FalkorDBAdapter |
| MCP Tool Verification | S | 1-2 days | Tests passing |
| Documentation Updates | S | 1 day | All above |
| Remove neo4j-driver Dependency | S | 0.5 days | All above |

**Total Estimated Effort**: 12-18 days

### Updated Phase 4 Sequence

1. **Phase 4.0: Graph Database Migration** (NEW - this section)
2. Phase 4.1: OIDC Provider Implementation
3. Phase 4.2: Microsoft 365 Integration
4. Phase 4.3: Kubernetes Deployment Manifests
5. Phase 4.4: Helm Chart Development
6. Phase 4.5: User-to-Instance Authorization Mapping
7. Phase 4.6: Audit Logging Implementation
8. Phase 4.7: Kubernetes Deployment Guide

### Files Requiring Modification

**Core Graph Implementation:**
- `src/graph/Neo4jClient.ts` → Refactor to adapter pattern
- `src/graph/types.ts` → Add adapter interface
- `src/graph/errors.ts` → Generalize error handling
- `src/services/graph-service.ts` → Use adapter interface

**New Files:**
- `src/graph/adapters/types.ts` - Adapter interface
- `src/graph/adapters/FalkorDBAdapter.ts` - FalkorDB implementation
- `src/graph/adapters/index.ts` - Adapter factory
- `scripts/migrate-neo4j-to-falkordb.ts` - Migration script

**Infrastructure:**
- `docker-compose.yml` - Replace Neo4j with FalkorDB
- `charts/personal-knowledge-mcp/` - Update Helm values
- `.env.example` - Update config variables

**Documentation:**
- `docs/architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md` (created)
- `README.md` - Update technology stack section
- `docs/neo4j-setup.md` → Rename to `docs/graph-database-setup.md`

### Success Criteria

- [ ] All 5 graph MCP tools functional with FalkorDB
- [ ] Existing indexed repositories queryable
- [ ] Incremental update pipeline working
- [ ] Performance within targets (<100ms graph traversal)
- [ ] Test coverage maintained at 90%+
- [ ] neo4j-driver removed from package.json
- [ ] Docker Compose uses FalkorDB container
