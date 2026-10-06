# Architecture & System Design

## Overview
Glitch SEO Ops Engine is designed as a modular monorepo separating data ingestion, analysis engines, API gateways, and user presentation.

```mermaid
flowchart TD
    subgraph Ingestion
        L[Server Logs: .log / .gz] -->|Streams| LP[packages/log-parser]
        C[Web Sites] -->|HTTP Crawler| CR[packages/crawler]
        DS[Datasets: CSV / JSON] -->|Validator| CE[packages/content-engine]
    end

    subgraph Core Engines
        LP --> DB[(PostgreSQL)]
        CR --> DB
        CE --> DB
        SE[packages/schema-engine] --> DB
    end

    subgraph Distribution & Connectors
        DB --> API[apps/api: Fastify REST]
        API --> WEB[apps/web: Next.js Dashboard]
        DB --> WP[WordPress REST: Drafts Only]
        DB --> GSC[Google Search Console API]
    end
```

## Module Boundaries
- **`packages/core`**: Zero external dependencies. Holds domain business models, privacy hashing, and priority formulas.
- **`packages/log-parser`**: Streaming parser with zero memory overhead, regex combined formats, bot heuristics.
- **`packages/crawler`**: Audit engine detecting over 15 categories of SEO regressions.
- **`packages/schema-engine`**: Strict JSON-LD Schema.org validator and graph builder.
- **`packages/content-engine`**: Safe template evaluator and Jaccard shingling similarity checker.
- **`packages/connectors`**: WordPress and Google Search Console adapters with built-in mock/demo modes.
