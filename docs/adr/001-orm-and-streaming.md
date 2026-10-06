# ADR 001: Selection of Prisma ORM and Streaming Log Architecture

## Context
Glitch SEO Ops Engine processes millions of server access log lines and manages complex relational entities for SEO audits, issues, sitemaps, and programmatic templates.

## Decision
1. **Prisma ORM** was chosen for type-safety, automatic migration tracking, schema declaration, and seamless developer ergonomics across the monorepo.
2. **Node.js Streams + readline + zlib** was selected for log ingestion to guarantee constant $O(1)$ memory consumption when parsing gigabyte-scale gzip archives.

## Consequences
- High type safety across apps and workers.
- Zero Out-Of-Memory (OOM) risks during large log imports.
