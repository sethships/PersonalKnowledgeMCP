# Personal Knowledge MCP - Product Requirements Document

**Version:** 1.1
**Date:** October 28, 2025
**Status:** Draft - Requirements Refined
**Author:** Product Team

---

## Executive Summary

The Personal Knowledge MCP is an AI-first knowledge management service that enables Claude Code and other AI assistants to efficiently access, retrieve, and utilize knowledge from software development projects and educational materials. Built as a Model Context Protocol (MCP) service, it prioritizes intelligent retrieval over traditional human interfaces, creating a semantic bridge between AI development workflows and diverse knowledge sources including codebases, documentation, and structured educational content.

**Key Differentiators:**
- **MCP-Native Architecture**: Purpose-built for AI assistant integration, not retrofitted
- **Multi-Instance Security Model**: Separate knowledge instances for different privacy/security levels
- **Software Project Focus**: Optimized for code repositories, documentation, and technical artifacts
- **Local-First with Cloud Flexibility**: Home lab deployment with optional cloud scaling
- **Intelligent Storage Routing**: Automatic selection of optimal storage type per knowledge domain

## Product Vision

To create the most intuitive and powerful personal knowledge management system that seamlessly integrates with AI workflows, enabling users to capture, organize, retrieve, and augment their knowledge across any domain, at any scale, with complete control over their data.

## Problem Statement

### User Pain Points

**For Software Development Projects:**
1. **Context Fragmentation**: Project knowledge scattered across repositories (GitHub, Azure DevOps), documentation systems, local files, and tribal knowledge
2. **AI Token Inefficiency**: Claude Code and similar tools waste tokens re-reading the same code/docs instead of efficiently retrieving indexed knowledge
3. **Scale Complexity**: Large monolithic codebases become unwieldy for AI assistants without intelligent semantic indexing
4. **Multi-Project Context Switching**: No unified way to access knowledge across multiple active projects
5. **Documentation Disconnect**: Reference materials, ADRs, and design docs isolated from code understanding

**For Educational Materials:**
6. **Structured Content Retrieval**: College notes and educational materials stored in folder hierarchies lack semantic searchability
7. **Cross-Domain Connection Loss**: Related concepts across different courses/subjects remain disconnected

**Cross-Cutting Issues:**
8. **Privacy vs Accessibility Tension**: Need to separate highly private knowledge (personal notes) from shareable knowledge (college materials, open-source projects) from work-related knowledge (proprietary codebases)
9. **Deployment Complexity**: Existing solutions require either cloud services (privacy concerns) or complex self-hosted setups
10. **Integration Tax**: Each new knowledge source requires custom integration rather than standardized ingestion

### Market Opportunity

AI-assisted development represents a paradigm shift in how software is built. The bottleneck is no longer writing code—it's providing AI tools with the right context efficiently. This product addresses that bottleneck by creating a purpose-built MCP service that makes project knowledge instantly accessible to AI assistants without token waste or context limitations.

## Goals and Non-Goals

### Functional Goals

**MVP Goals (Priority Order):**
1. **MCP Service Implementation**: Provide standard MCP protocol interface for AI assistant integration
2. **Code Repository Ingestion**: Automatically ingest and index GitHub/Azure DevOps repositories with intelligent code analysis
3. **Semantic Code Search**: Enable AI assistants to efficiently find relevant code, documentation, and patterns without full codebase scans
4. **Multi-Instance Architecture**: Support separate knowledge instances for different security/privacy levels (private, work, public)
5. **Local Folder Ingestion**: Process structured educational materials and documentation from file system hierarchies
6. **Intelligent Storage Routing**: Automatically select optimal storage type (vector DB for semantic search, graph DB for relationships, document store for artifacts)
7. **Pipeline-Based Updates**: Automated knowledge refresh when repositories update or files change

**Future Goals (Post-MVP):**
- Collaborative features for team knowledge sharing
- Knowledge decay/forgetting curves for relevance management
- Interactive learning from user feedback to improve retrieval
- Plugin/extension system for custom analyzers
- Advanced visualization capabilities (knowledge graphs, relationship maps)
- Obsidian integration for personal logging (separate instance)

**Non-Goals:**
- Building a general-purpose database management system
- Creating a note-taking or writing application
- Developing proprietary storage engines or LLM models
- Mobile-first or offline-first mobile applications
- Enterprise compliance certifications (HIPAA, SOC2) in MVP
- Real-time collaborative editing
- Creating a commercial knowledge marketplace

### Non-Functional Goals

**MVP Goals:**
- **Query Performance**: Sub-500ms response time for 95% of semantic searches across typical codebase scale
- **Ingestion Throughput**: Process and index repositories up to 100K files within reasonable timeframes (hours, not days)
- **Deployment Simplicity**: Pre-built containers deployable to home lab Kubernetes or Docker Compose in under 30 minutes
- **Data Sovereignty**: All data stored locally or in user-controlled cloud infrastructure
- **Automation**: Weekly system updates via automated pipelines with minimal manual intervention
- **Scalability**: Support multiple active coding projects (5-10 repositories) plus educational material corpus
- **Resource Efficiency**: Run efficiently on home lab hardware (reasonable CPU/memory requirements)
- **Remote Access**: Secure access from remote locations (coffee shops) to home-hosted instance

**Future Goals:**
- 99.9% availability with proper failover mechanisms
- Millions of documents/entries scale for large enterprises
- Sub-100ms response times with caching optimizations
- Multi-region deployment support

**Non-Goals:**
- Real-time synchronization (eventual consistency is acceptable with completion notifications)
- Support for resource-constrained mobile devices
- Legacy database compatibility
- Enterprise SLA guarantees in MVP
- Managed hosting services

## Target Users

### Primary Persona: The AI-Augmented Technical Expert

**Profile:**
- **Experience Level**: 20+ years in software engineering, including leadership roles
- **Education**: Computer Science degree(s), MBA
- **Technical Comfort**: Highly comfortable with infrastructure, Kubernetes, database tuning, system architecture
- **Working Style**: AI-first development using Claude Code and similar tools
- **Infrastructure**: Home lab with containerized services, potentially NAS-based deployments
- **Privacy Awareness**: Sophisticated understanding of data security requiring separate instances for different sensitivity levels

**Primary Use Cases:**

**1. Software Project Knowledge Management (Priority #1)**
- Managing knowledge for multiple active coding projects simultaneously
- Working with codebases at various scales (small microservices to large monoliths)
- Integrating code, documentation, ADRs, reference materials across GitHub and Azure DevOps
- Enabling AI assistants to efficiently access project context without token waste
- Quick context switching between projects during active development

**2. Educational Material Organization (Priority #2)**
- Organizing undergraduate and graduate college notes
- Making structured educational content semantically searchable
- Cross-referencing concepts across different courses/domains
- Potential future sharing of general knowledge (lower security tier)

**Secondary Personas (Future Consideration):**
- **Development Teams**: Collaborative knowledge sharing (mentioned as potential future feature)
- **Individual Contributors**: Less infrastructure-savvy developers who want simpler setup

### User Journey (MVP Focus)

**Initial Setup:**
1. **Deployment**: Deploy pre-built containers to home lab Kubernetes/Docker Compose
2. **Instance Configuration**: Create separate instances for private, work, and public knowledge tiers
3. **Authentication Setup**: Configure secure authentication (potentially Microsoft 365 integration)
4. **Storage Configuration**: Select and configure storage backends (vector DB, graph DB, document store)

**Knowledge Ingestion:**
5. **Repository Connection**: Connect GitHub and Azure DevOps repositories to appropriate instances
6. **Folder Mapping**: Map local file system hierarchies (college notes) for ingestion
7. **Pipeline Execution**: Trigger initial ingestion with progress monitoring
8. **Verification**: Confirm successful indexing and searchability

**AI-Assisted Usage:**
9. **MCP Integration**: Configure Claude Code to use Personal Knowledge MCP service
10. **Contextual Retrieval**: AI assistants query knowledge base during development work
11. **Multi-Project Context**: Seamless switching between different project knowledge domains
12. **Automated Updates**: Pipelines automatically refresh knowledge when repositories update

**Ongoing Operations:**
13. **Maintenance**: Automated weekly system updates with minimal intervention
14. **Backup Management**: Periodic full/incremental backups with cloud replication
15. **Remote Access**: Secure access from coffee shops and remote locations

## Core Capabilities (Prioritized for MVP)

### 1. MCP Service Interface (P0 - Critical)
- **Description**: Standards-compliant Model Context Protocol implementation exposing knowledge retrieval to AI assistants
- **User Value**: Claude Code can directly query knowledge base without custom integrations
- **Success Metrics**: MCP protocol compliance, query latency, AI assistant compatibility
- **MVP Scope**: Read-only queries, semantic search, project-scoped retrieval

### 2. Code Repository Intelligence (P0 - Critical)
- **Description**: Automated ingestion and analysis of GitHub/Azure DevOps repositories with code-aware indexing
- **User Value**: AI assistants understand code structure, dependencies, documentation, and patterns without full file reads
- **Success Metrics**: Repository ingestion time, code semantic accuracy, supported languages
- **MVP Scope**:
  - Support for 13 languages: TypeScript, TSX, JavaScript, JSX, Python, Java, Go, Rust, C#, C, C++, Ruby, PHP
  - Extract: functions/methods, classes, imports, docstrings, README/docs
  - Index code semantics, not just text matching

### 3. Multi-Instance Security Architecture (P0 - Critical)
- **Description**: Deploy separate knowledge instances for different security/privacy tiers
- **User Value**: Keep proprietary work code separate from public projects and personal notes
- **Success Metrics**: Instance isolation verification, authentication enforcement
- **MVP Scope**:
  - Three-tier model: Private, Work, Public
  - Instance-level access control
  - Separate storage backends per instance

### 4. Intelligent Storage Routing (P0 - Critical)
- **Description**: Automatically select optimal storage type based on knowledge domain and query pattern
- **User Value**: Performance optimization without manual tuning decisions
- **Success Metrics**: Query performance by storage type, routing accuracy
- **MVP Scope**:
  - Vector DB: Semantic code search, document similarity
  - Graph DB: Code dependencies, knowledge relationships
  - Document Store: Raw artifacts, documentation, binary blobs

### 5. Pipeline-Based Knowledge Updates (P1 - High Priority)
- **Description**: Automated pipelines triggered by repository changes or file system updates
- **User Value**: Knowledge base stays current without manual intervention
- **Success Metrics**: Update latency after trigger, pipeline success rate
- **MVP Scope**:
  - GitHub webhook integration for PR merges
  - File system watcher for local folder changes
  - Progress notification when ingestion completes

### 6. Structured Content Ingestion (P1 - High Priority)
- **Description**: Process hierarchical folder structures with intelligent content extraction
- **User Value**: College notes and documentation become semantically searchable
- **Success Metrics**: File format support, extraction accuracy
- **MVP Scope**:
  - Markdown, PDF, DOCX, TXT support
  - Preserve folder hierarchy as metadata
  - Extract headings, structure, and semantic content

### 7. Semantic Search & RAG (P1 - High Priority)
- **Description**: Vector-based semantic search with retrieval-augmented generation support
- **User Value**: Find relevant knowledge by meaning, not just keywords
- **Success Metrics**: Search precision/recall, relevance scoring accuracy
- **MVP Scope**:
  - Embedding generation for code and documents
  - Similarity search with configurable threshold
  - Context assembly for AI assistant queries

### Future Capabilities (Post-MVP)
- **Knowledge Graph Visualization**: Visual relationship exploration (far future, possibly off-the-shelf tool)
- **Interactive Learning**: Feedback-based retrieval improvement
- **Obsidian Integration**: Personal note synchronization (separate instance)
- **Plugin System**: Custom analyzers and extractors
- **Collaborative Features**: Team knowledge sharing

## User Experience Principles (AI-First Design)

Given the MCP-first approach and highly technical user profile, these principles reflect the unique characteristics of an AI-consumed service:

1. **API-First Design**: MCP protocol interface is the primary UX; human interfaces are secondary administrative tools
2. **Intelligent Defaults with Full Control**: Smart defaults for storage routing and indexing, but expose configuration for tuning
3. **Transparency & Explainability**: Clear logging of what was indexed, how queries are routed, and why results are returned
4. **Progress Visibility**: Real-time feedback during ingestion pipelines and indexing operations
5. **Automation-Friendly**: All operations scriptable and pipeline-compatible
6. **Expert-Optimized**: Assume infrastructure knowledge; don't hide complexity, organize it logically
7. **Security-Conscious**: Instance isolation enforced at architecture level, not just access control
8. **Performance-Aware**: Expose query performance metrics to enable user optimization

## Success Metrics

### Primary Metrics (MVP Focus)

**AI Assistant Efficiency:**
- **Token Savings**: Reduction in tokens consumed by Claude Code for context retrieval vs. full file reads
- **Query Response Time**: 95th percentile latency for MCP queries (target: <500ms)
- **Retrieval Precision**: Percentage of queries returning relevant code/documentation (target: >85%)
- **Context Switch Speed**: Time to switch between different project knowledge domains (target: <100ms)

**Knowledge Coverage:**
- **Repository Indexing Success**: Percentage of connected repos successfully indexed (target: 100%)
- **Code Coverage**: Percentage of code files successfully analyzed and indexed (target: >95%)
- **File Format Support**: Percentage of supported document formats successfully extracted (target: >90%)

**Operational Efficiency:**
- **Deployment Time**: Time from download to functional MCP service (target: <30 minutes)
- **Update Pipeline Success**: Percentage of automated knowledge updates completing successfully (target: >95%)
- **System Availability**: Uptime for local instance (target: >99% during active working hours)

### Secondary Metrics

**Performance & Scale:**
- **Ingestion Throughput**: Files processed per minute during initial repository ingestion
- **Storage Efficiency**: Total indexed knowledge size vs. raw data size ratio
- **Concurrent Query Support**: Number of simultaneous MCP queries handled

**User Satisfaction (Self-Assessment):**
- **Time-to-Useful-Response**: Time from asking Claude Code a project question to receiving useful answer
- **Manual Search Reduction**: Decreased need to manually search through code/docs
- **Context Completeness**: Subjective assessment of whether AI has sufficient project context

**Future Metrics (Post-MVP):**
- **Collaborative Usage**: Number of team members using shared instance
- **Knowledge Graph Density**: Relationships discovered per 1000 knowledge items
- **Learning Accuracy**: Improvement in retrieval relevance from user feedback

## Technical Constraints & Considerations

### Architecture Philosophy
- **MCP-Native**: Model Context Protocol as first-class interface, not an afterthought
- **Container-First**: Docker images with Kubernetes and Docker Compose deployment options
- **Local-First with Cloud Flexibility**: Default to local deployment, support cloud migration path
- **Multi-Instance by Design**: Architecture supports isolated instances from the ground up
- **Polyglot Storage**: Multiple storage backends working in concert, not a monolithic database
- **Pipeline-Driven**: Knowledge updates via automated pipelines, not manual operations

### Integration Requirements

**Critical (MVP):**
- **MCP Protocol Compliance**: Full implementation of Model Context Protocol specification
- **GitHub Integration**: Repository cloning, webhook handling, authentication
- **Azure DevOps Integration**: Repository access, authentication
- **LLM Provider Support**: Anthropic (Claude), OpenAI for embeddings generation
- **Local Filesystem**: Watch and ingest local folder hierarchies
- **Authentication**: Secure auth mechanism (consider Microsoft 365 OAuth)

**Important (Post-MVP):**
- **Obsidian Integration**: Sync personal notes (separate instance)
- **Ollama Support**: Local LLM for embeddings and analysis
- **Additional VCS**: GitLab, Bitbucket support

### Performance Targets (MVP Scale)

**Query Performance:**
- MCP query response: <500ms for 95th percentile
- Semantic search: <200ms for vector similarity lookup
- Graph traversal: <100ms for relationship queries
- Context assembly: <300ms for complete RAG response

**Ingestion Performance:**
- Small repository (<1K files): <5 minutes to full indexing
- Medium repository (1K-10K files): <30 minutes to full indexing
- Large repository (10K-100K files): <4 hours to full indexing
- Incremental updates: <1 minute for typical PR changes

**Resource Constraints (Home Lab):**
- CPU: Efficiently utilize 4-8 core systems
- Memory: Reasonable footprint on 16-32GB RAM systems
- Storage: Support local SSD/NAS storage backends
- Network: Optimize for gigabit local network speeds

### Storage Technology Considerations

**Vector Database** (Semantic Search):
- Candidates: Qdrant, Weaviate, Milvus, ChromaDB
- Preference: Open-source, container-ready, good Python/Node.js support

**Graph Database** (Relationships):
- Candidates: Neo4j Community, ArangoDB, JanusGraph
- Preference: Open-source, supports property graphs, good query language

**Document Store** (Artifacts):
- Candidates: MongoDB, Elasticsearch, PostgreSQL with JSON
- Preference: Open-source, flexible schema, good full-text search

**Note**: Specific technology choices deferred to System Design Document

## Risks & Mitigation Strategies

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **MCP protocol immaturity/changes** | High | Medium | Abstract MCP interface behind adapter layer; version protocol explicitly |
| **Multi-instance complexity** | High | Medium | Provide Docker Compose templates for common configurations; excellent documentation |
| **Code analysis inaccuracy** | High | Medium | Start with well-tested parsers (tree-sitter, LSP); validate against known codebases |
| **Performance at large repo scale** | High | Medium | Implement incremental indexing; benchmark against large OSS projects early |
| **Storage backend coordination** | Medium | High | Clear routing logic with fallbacks; comprehensive integration testing |
| **GitHub/Azure DevOps API rate limits** | Medium | Medium | Implement intelligent caching; batch operations; respect rate limits |
| **LLM embedding API costs** | Medium | Low | Support local Ollama for embeddings; cache embeddings aggressively |
| **Authentication complexity** | Medium | Medium | Start with simple token-based auth; defer OAuth to post-MVP if complex |
| **Backup/restore complexity** | Low | Medium | Standard Docker volume backups; document procedures clearly |
| **Remote access security** | High | Low | Require VPN or secure tunnel; no direct internet exposure by default |

## Questions & Answers

### Product Vision & Scope

**Q1:** What is the primary use case that should drive our initial development priorities - academic research, professional knowledge management, or personal learning?
**A:** There are 2:
    1. As a project repository for storing knowledge about software projects. Code, documentation, reference material, etc. are all example targets (there may be more) of information that should be stored and organized. This can be at many scales ... from a small-scoped project (e.g. a console app or simple microservice or MCP) - to something much larger in scope where it has even greater immpact, like a large legacy monolithic codbase with full user, developer, and internal documentation stored in varies formats and locations.
    2. Personal knowledge that is stored in a strutured folder format. The starting point will be notes and other artifacts from college, both undergrad and graduate.

**Q2:** Should the system support collaborative features in the future, or remain strictly personal?
**A:** It could be used collaboratively. What might this change about the requirements? I'm assuming there's going to be custom tuning for various kinds of data stores and so on...

**Q3:** What level of technical expertise should we assume for our target user? Should there be multiple user interfaces for different skill levels?
**A:** High, 20+ years tech/software engineering experience in various roles (including leadership roles) and degrees in computer science as well as a MBA. The user is comfortable exploring and discussing various approaches to analyzing data and how it may be inedexed into a vector db, for example. And would like to both understand and help decide how systems are configured, like kubernetes cluster configurations.

### Storage & Architecture

**Q4:** Which storage types should be supported in the MVP? (Vector DB, Graph DB, Relational, Document, Key-Value, Time-series?)
**A:** Any or all that make sense for a given scenario. Implementations might opt for some in one case vs others. However the focus of this will be on AI-assisted querying (e.g. Claude Code utilizing it for more efficient working/token utilization). 

**Q5:** Should we prioritize local-first deployment or cloud-native architecture initially?
**A:** Local first with the flexibility to move to cloud hosted later. Local can also include a cluster on a personal lab computer or NAS (e.g. Synology nas running containers)

**Q6:** What is the expected scale of a typical personal knowledge base? (Thousands, millions, or billions of items?)
**A:** Make some assumptions based on the examples given above. I have several active ccoding projects going and a bunch of notes from college.

**Q7:** Should the system support real-time synchronization across multiple instances, or is eventual consistency acceptable?
**A:** Yes, with the caveat that the user may expect to know when new knowledge import completes (e.g. a pipeline completes after a PR has merged on a repostry, or new documents or files have been added to a folder and need to be ingested by analyzers).

### Knowledge Management Features

**Q8:** How important is automatic knowledge extraction from unstructured sources (PDFs, websites, videos)?
**A:** Very. Ideally this flow should be configurable and then ultimately convienient to add extra sources.

**Q9:** Should the system support knowledge decay/forgetting curves for information relevance?
**A:** Not in the first MVP. This might be a future feature to explore.

**Q10:** What types of relationships between knowledge items are most valuable? (Hierarchical, associative, temporal, causal?)
**A:** That varies depending on the source material. Use the given examples and provide some suggestions for this first MVP.

**Q11:** Should versioning be at the document level, fragment level, or both?
**A:** Same answer as Q10.

### AI Integration

**Q12:** Which LLM providers should be supported initially? Should we support multiple simultaneously?
**A:** I primarily use Anthropic and OpenAI LLM models, although I do use local Ollama models too.

**Q13:** How should we handle the balance between retrieval accuracy and creative augmentation?

*Expanded Context:* This question addresses a fundamental design decision in RAG (Retrieval-Augmented Generation) systems. There are two primary modes:

1. **Retrieval-Focused Mode**: Prioritizes returning exactly what exists in your knowledge base with minimal AI interpretation. This is more like "enhanced search" where the AI helps find relevant content but doesn't synthesize or create new connections. Best for: "What does this function do?", "Show me where authentication is implemented", "What did I write about X topic?"

2. **Creative Augmentation Mode**: The AI actively synthesizes information from multiple sources, draws novel connections, and generates insights that aren't explicitly stated in your knowledge base. Best for: "How are these three modules related?", "What patterns emerge across my projects?", "Suggest architectural improvements based on similar projects I've worked on."

The tradeoff: Retrieval-focused mode is more trustworthy (less hallucination risk) but less insightful. Creative mode can generate valuable insights but might introduce AI confabulation.

Questions to help answer:
- When Claude Code queries your knowledge base, do you primarily want "find me what I wrote" (retrieval) or "help me understand connections and patterns" (augmentation)?
- Should the MCP service support both modes with the AI assistant choosing which to use?
- How important is citation/source attribution for returned information?
- Would you want a confidence score on augmented responses to know when the AI is being creative vs. retrieving?

**A:** [Awaiting clarification based on expanded context]

**Q14:** Should the system learn from user interactions to improve retrieval over time?
**A:** I think that's an excellent future feature. Lets document it and keep it scoped out of this MVP.

**Q15:** What level of explainability is required for AI-generated insights and connections?
**A:** Same answer as Q10.

### User Experience

**Q16:** Should there be a graphical user interface, or focus on CLI/API-first approach?
**A:** I think we should focus on a MCP service at first, whatever makes the most sense for those tools.

**Q17:** How important is mobile access to the knowledge base?
**A:** Hm, good question. I do like to work wfrom coffee shops where remote access to this store would be good. It could be hosted on one of my home lab machines, provided that they're beefy enough to make it performant (not sure what hardware requirements would be needed, something to consider).

**Q18:** Should the system support natural language queries exclusively, or also structured query languages?
**A:** Whatever makes the most sense in the context of a MCP tool for AIs to access.

**Q19:** What visualization capabilities are most critical? (Knowledge graphs, timelines, mind maps, dashboards?)
**A:** This can be a far-future feature. And actually we may use something off the shelf or open source rather than author it here. This project should focus on being the best MCP service it can to assist AI driven development and aid with responses to user prompts.

### Deployment & Operations

**Q20:** Should we provide pre-built container images or expect users to build their own?
**A:** Pre built. We should have pipelines when not using something that is already available in a container image registry/hub.

**Q21:** What level of monitoring and observability should be built-in?
**A:** I'm open to suggestion, but keep this minimial to a first pass MVP for now. We might not need much really, to start with.

**Q22:** Should the system support automatic backups and disaster recovery?
**A:** Ideally, yes. At least full backups with periodic incrmental backups that can be stored locally and then replicated to a cold store someplace else (e.g. cloud).

**Q23:** What is the expected update/upgrade frequency, and how should updates be handled?
**A:** Weekly. I would like to stay on top of system updates in order to keep tight cybersecurity concerns under control.

### Integration & Extensibility

**Q24:** Which third-party knowledge sources should have first-class integration? (Notion, Obsidian, Roam, Evernote, etc.)
**A:** I use Obsidian for logging, however that's very private and may not be used (at least not in the same instance as the coding projects and college files ... not sure). That is an intersting aspect. I may want to keep a separate instance of this knowledge store for personal/private stuff, and then another for coding projects, and another for general (but not as private) knowledge and documentation storage (e.g. college notes) that can be made available as I determine. Other than Obsidian most of this will integrate with local files, GitHub projects (private and public), and a bit of AzureDevOps. At least for the MVP.

**Q25:** Should the system support plugins or extensions for custom functionality?
**A:** Later, not in this first MVP.

**Q26:** What import/export formats are essential for data portability?
**A:** Anything that might make sense in the context of the given example scenarios. We might choose various code analyzers to add metadata to a vectorDB, for example.

**Q27:** How should the system handle authentication and authorization for external integrations?
**A:** I'm open to suggestion here. Ideally something secure, simple, and at least on the small-scale, already paid for or free. I do have an active Microsoft365 business standard tenant (bibler.us) that could be used for this puprose, if it makes sense.

### Business & Sustainability

**Q28:** Is this intended to remain open-source, or might there be commercial offerings?
**A:** Lets keep it to open-source tools and projects for now, unless otherwise stated (like in my answer to Q27).

**Q29:** What is the expected maintenance commitment for this project?
**A:** Low. I would love for maintenance tasks to be highly automated via scripts or pipelines that could handle basic routine operations like systems updates, ingesting new data, etc.

**Q30:** Should we build a community around this project, and if so, what would that look like?
**A:** Not right now. I might consider switching to public later and then we'd want to discuss community building.

**Q31:** What open-source license should be selected for this project?
**A:** License selection is deferred until project stabilization and before any public release. When selecting:
- Must be a permissive open-source license (non-copyleft preferred)
- Consider MIT or Apache 2.0 for maximum adoption and compatibility
- Verify compatibility with all project dependencies
- Document license choice and rationale in repository before public release
- Currently marked as "TBD" in README.md pending this decision

---

## Follow-Up Questions for MVP Scoping

Based on the answers provided, these targeted questions will help define the MVP scope more precisely:

### Multi-Instance Architecture

**FQ1:** For the three-tier instance model (Private, Work, Public), how should they be deployed?
- Option A: Three completely separate service deployments (different ports, configs, storage)
- Option B: Single service with instance isolation via configuration and access control
- Option C: Hybrid approach with some shared infrastructure (e.g., shared MCP gateway routing to isolated backends)

**FQ2:** How should cross-instance queries work? For example, if Claude Code needs to search across both "Work" and "Public" instances simultaneously, should this be:
- Not supported in MVP (must query instances separately)
- Supported with explicit multi-instance query syntax
- Intelligent routing based on query context

### Code Analysis & Storage

**FQ3:** For code metadata extraction, which is most valuable for the MVP?
- Priority 1: Function/method signatures and docstrings
- Priority 2: Import dependencies and call graphs
- Priority 3: Code patterns and idioms
- Priority 4: Test coverage and relationships
- (Rank these or suggest different priorities)

**FQ4:** What types of relationships are most important to capture in the graph database for the MVP?
- Code dependencies (imports, function calls)
- Documentation references (doc mentions code, code references ADRs)
- Project structure (modules, packages, components)
- Temporal relationships (version history, commit timeline)
- Conceptual links (similar functionality across projects)

### Storage Technology Selection

**FQ5:** Given your infrastructure experience, do you have preferences for the storage technologies?
- Are you already running any of these in your home lab? (Neo4j, MongoDB, PostgreSQL, etc.)
- Would you prefer Docker Compose for MVP (simpler) or Kubernetes from day one?
- Any strong preferences or dealbreakers for specific databases?

**FQ6:** For vector embeddings, what's your preference?
- Use OpenAI/Anthropic embedding APIs (simple, costs money, cloud dependency)
- Use local Ollama embeddings (free, slower, completely local)
- Support both with a configuration option
- Start with one and add the other later (which first?)

### MVP Feature Prioritization

**FQ7:** Which single storage backend should we implement FIRST for fastest time-to-value?
- Vector DB only (semantic search, no relationships) - quickest path to useful retrieval
- Vector + Document store (semantic search + full artifacts) - balanced approach
- All three (vector + graph + document) - complete but slower to MVP

**FQ8:** For the initial repository ingestion, should we support:
- Only public repos accessible via HTTPS clone (simplest)
- Private repos requiring SSH keys or PAT tokens
- Both from the start
- Start with public, add private shortly after

### Deployment & Operations

**FQ9:** For automated pipelines and updates, what should trigger knowledge refresh?
- GitHub webhooks (requires publicly accessible endpoint or ngrok-like solution)
- Scheduled polling (simpler, higher latency, no webhook infrastructure needed)
- Manual trigger via CLI/API (simplest for MVP, automation comes later)
- Combination approach (which primary for MVP?)

**FQ10:** For remote access (coffee shop scenario), what's your preferred approach?
- VPN to home network (most secure, requires VPN setup)
- Tailscale/ZeroTier mesh network (easy, secure, cloud-relayed)
- CloudFlare Tunnel or similar (simple, some cloud dependency)
- Direct port forwarding with strong authentication (simplest but riskier)

### Success Criteria

**FQ11:** What would make the MVP "successful enough" to move to the next phase?
- Can query 2-3 active projects with <500ms response time
- Saves measurable tokens in typical Claude Code session
- Deploys and runs reliably for 1 week without intervention
- Successfully indexes at least one large monolithic codebase
- (Define your criteria)

**FQ12:** What's the acceptable time investment for MVP development?
- 2-4 weeks of evenings/weekends
- 1-2 months part-time
- 3-6 months when time permits
- Other timeline expectation

---

## MVP Recommendations

Based on the requirements analysis, here are strategic recommendations for building the MVP efficiently:

### Phased Implementation Approach

**Phase 1: Core MCP + Vector Search (Weeks 1-3)**
- **Goal**: Get Claude Code querying indexed code semantically
- **Components**:
  - Basic MCP service implementation (read-only queries)
  - Single vector database (recommend Qdrant - good Python support, easy Docker deployment)
  - GitHub repository cloner and basic file ingestion
  - Simple code text extraction (no AST parsing yet)
  - OpenAI embeddings API integration (defer Ollama to Phase 2)
- **Success Metric**: Claude Code can semantic search across one indexed repository
- **Rationale**: Fastest path to demonstrable value; proves core concept

**Phase 2: Code Intelligence + Local Files (Weeks 4-6)**
- **Goal**: Add code-aware indexing and educational material support
- **Components**:
  - Integrate tree-sitter or similar for AST parsing (functions, classes, imports)
  - Add document store (MongoDB or PostgreSQL) for full file artifacts
  - Local folder ingestion with file watcher
  - Markdown/PDF extraction for college notes
- **Success Metric**: Claude Code understands code structure, not just text; college notes searchable
- **Rationale**: Differentiates from simple vector search tools

**Phase 3: Multi-Instance + Azure DevOps (Weeks 7-9)**
- **Goal**: Security model and work integration
- **Components**:
  - Multi-instance configuration and deployment templates
  - Authentication layer (simple token-based, defer OAuth)
  - Azure DevOps repository integration
  - Instance-specific routing in MCP service
- **Success Metric**: Separate instances for work/personal projects running simultaneously
- **Rationale**: Critical for real-world usage with proprietary code

**Phase 4: Graph Relationships + Automation (Weeks 10-12)**
- **Goal**: Deeper insights and operational automation
- **Components**:
  - Graph database (Neo4j Community or ArangoDB) for relationships
  - Code dependency extraction and graph population
  - GitHub webhook handler (or polling alternative)
  - Automated update pipelines
- **Success Metric**: Can query code dependencies; knowledge updates automatically on PR merge
- **Rationale**: Completes the core value proposition

**Post-MVP Backlog** (Prioritized):
1. Ollama local embeddings support
2. Advanced code analysis (call graphs, test relationships)
3. Kubernetes deployment manifests and Helm charts
4. Backup/restore automation
5. Performance optimization and caching layer
6. Obsidian integration (personal instance)

### Recommended Technology Stack

**Core Service:**
- **Language**: Python (excellent ML/AI library support, good MCP SDK availability)
- **Framework**: FastAPI (modern, async, good OpenAPI support for admin interfaces)
- **MCP SDK**: Official Anthropic MCP Python SDK

**Storage Layer:**
- **Vector DB**: Qdrant (open-source, Docker-ready, excellent Python client, good performance)
- **Graph DB**: Neo4j Community Edition (mature, Cypher query language, good tooling)
- **Document Store**: PostgreSQL with JSON (already familiar, reliable, can serve multiple roles)
- **Rationale**: Balance between capability and operational simplicity

**Ingestion & Analysis:**
- **Code Parsing**: tree-sitter (multi-language, maintained, AST generation)
- **Document Extraction**: python libraries (pypdf, python-docx, markdown-it-py)
- **Embeddings**: OpenAI API initially, add Ollama wrapper in Phase 4

**Deployment:**
- **MVP**: Docker Compose (simpler for single-user deployment)
- **Post-MVP**: Kubernetes manifests (for home lab cluster deployment)
- **CI/CD**: GitHub Actions for container builds and testing

**Authentication:**
- **MVP**: Simple bearer token authentication
- **Future**: OAuth2 with Microsoft 365 integration if needed

### Key Architectural Decisions

**Decision 1: MCP Interface Design**
- **Recommendation**: Expose multiple query modes via MCP tools/functions:
  - `semantic_search(query, project, limit)` - Vector similarity
  - `find_code(signature, language, project)` - Targeted code search
  - `get_dependencies(module, project)` - Graph traversal
  - `get_context(file_path, project)` - Full artifact retrieval
- **Rationale**: Gives Claude Code fine-grained control over retrieval strategy

**Decision 2: Multi-Instance Implementation**
- **Recommendation**: Start with Option A (separate deployments) using Docker Compose profiles
- **Rationale**: Strongest isolation, simpler to reason about, can consolidate later if needed

**Decision 3: Repository Update Strategy**
- **Recommendation**: Start with polling approach, add webhooks in Phase 4
- **Rationale**: Avoids complexity of exposing home lab to internet; polling every 5-15 minutes acceptable for MVP

**Decision 4: Embedding Strategy**
- **Recommendation**: OpenAI embeddings initially, abstract behind interface for future Ollama support
- **Rationale**: Faster MVP delivery; embedding costs are low for personal use; local option important for privacy but not blocking

**Decision 5: Code Analysis Depth**
- **Recommendation**: Phase 1 = file-level text, Phase 2 = function/class extraction, Phase 4 = full call graphs
- **Rationale**: Incremental value delivery; even simple semantic search is valuable

### Risk Mitigation Strategies

**Technical Risk: MCP Protocol Changes**
- Create adapter layer that can be updated independently
- Version MCP responses explicitly
- Monitor MCP specification changes actively

**Operational Risk: Home Lab Reliability**
- Implement comprehensive logging from day one
- Create simple health check endpoints
- Document common failure modes and recovery procedures

**Performance Risk: Large Repository Scaling**
- Test against large public repos early (Linux kernel, React, etc.)
- Implement chunking strategies for huge files
- Add circuit breakers for runaway operations

**User Risk: Configuration Complexity**
- Provide working Docker Compose templates for common scenarios
- Create configuration validation CLI tool
- Write clear, example-driven documentation

### Success Metrics for MVP Go/No-Go Decision

After completing Phase 3 (Multi-Instance + Azure DevOps), evaluate:

**Go Criteria** (Must achieve ALL):
1. ✅ Claude Code successfully queries knowledge base via MCP in <500ms p95
2. ✅ At least 3 repositories successfully indexed (1 small, 1 medium, 1 large)
3. ✅ Deployment from scratch completes in <30 minutes following docs
4. ✅ Multi-instance isolation verified (no cross-contamination)
5. ✅ System runs for 1 week without manual intervention

**No-Go Signals** (Any ONE triggers re-evaluation):
1. ❌ Query latency consistently >2 seconds
2. ❌ Code analysis accuracy <70% (too many missed functions/classes)
3. ❌ Memory footprint >16GB for typical workload
4. ❌ Repository ingestion takes >12 hours for medium repos
5. ❌ More than 50% of development time spent on infrastructure vs. features

If "Go": Proceed to Phase 4 and post-MVP features
If "No-Go": Pivot architecture or scope before continuing

## Next Steps

### Immediate Actions (This Week)
1. **Answer Follow-Up Questions (FQ1-FQ12)**: Refine MVP scope based on targeted questions above
2. **Clarify Q13 (Retrieval vs. Augmentation)**: Determine primary query mode for MCP service
3. **Review MVP Recommendations**: Validate phased approach and technology stack suggestions
4. **Approve/Modify Core Capabilities Prioritization**: Confirm P0 vs. P1 feature prioritization

### Near-Term Actions (Next 2-4 Weeks)
5. **System Design Document Creation**: Begin technical architecture design (separate SDD document)
6. **Technology Validation**: Quick proof-of-concept for key unknowns:
   - MCP protocol integration with Claude Code
   - Qdrant vector DB with code embeddings
   - tree-sitter code parsing accuracy for target languages
   - Docker Compose multi-instance deployment
7. **Development Environment Setup**: Prepare local development environment for MVP work
8. **Initial Repository Selection**: Choose 2-3 test repositories (small, medium, large) for validation

### Medium-Term Actions (Next 1-3 Months)
9. **Phase 1 Implementation**: Core MCP + Vector Search
10. **Phase 2 Implementation**: Code Intelligence + Local Files
11. **Phase 3 Implementation**: Multi-Instance + Azure DevOps
12. **MVP Go/No-Go Decision**: Evaluate against success criteria
13. **Phase 4 Planning**: If MVP successful, plan graph relationships and automation

## Appendices

### Appendix A: Competitive Landscape
_To be completed after market analysis_

### Appendix B: User Research Findings
_To be completed after user interviews_

### Appendix C: Technical Architecture Overview
_To be detailed in separate System Design Document_

---

**Document History:**
- v1.0 - Initial draft with Q&A framework (October 28, 2025)
- v1.1 - Updated based on Q&A responses; refined scope, personas, and goals; added Follow-Up Questions and MVP Recommendations sections (October 28, 2025)