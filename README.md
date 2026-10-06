# Glitch SEO Ops Engine

> **Enterprise Technical SEO, Server Log Streaming, Crawler Audit, Structured Data, Programmatic Content & Google Search Console Ops Engine.**

Built with **TypeScript, pnpm Workspaces, Turborepo, Next.js, Fastify, Prisma ORM, and BullMQ**.

---

## 🚀 Key Features

1. **Streaming Server Log Analyzer**:
   - Parses large `.log`, `.txt`, and `.gz` files via streams with backpressure.
   - Detects 17+ Search Engine and AI bots (*Googlebot, Bingbot, GPTBot, ClaudeBot, PerplexityBot, Bytespider, etc.*).
   - Hashes IP addresses and sanitizes sensitive URL query parameters (*passwords, tokens, sessions*).
   - Generates crawl waste analysis, response percentiles, and HTTP status distribution.

2. **Technical Crawler & Issue Detector**:
   - Respects `robots.txt`, canonical tags, and concurrency limits.
   - Audits 15+ technical issues (*4xx/5xx errors, accidental noindex, missing/short titles, thin content, redirect chains, orphan pages, missing JSON-LD*).
   - Configurable priority scoring formula.

3. **Schema.org Structured Data Engine**:
   - Generates and validates JSON-LD schemas (*Article, Organization, FAQPage, WebPage*).
   - Ensures entity `@id` persistence and namespace integrity.

4. **Programmatic Content & Quality Gates**:
   - Safe string templating without `eval`.
   - Content duplication and shingling similarity detector (*Jaccard Similarity*).
   - Automatic quality gate classifications (*BLOCKED, NEEDS_REVIEW, READY_FOR_APPROVAL*).

5. **WordPress REST Connector**:
   - Publishes content **strictly as drafts** (`draft` status enforced).
   - Computes local vs remote diffs and supports dry runs.

6. **Search Console & GEO Visibility Monitoring**:
   - Search Analytics query/page performance ingestion.
   - Brand entity mention observation across conversational LLM outputs.

7. **Modern Soft UI / Neumorphic Dashboard**:
   - Matching design system with curved pill sidebar, rounded cards (`rounded-[28px]`), floating action panels, today tasks, light/dark switch, and accessible progress indicators.

---

## 🛠️ Quickstart

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL & Redis via Docker
docker compose up -d postgres redis

# 3. Setup Database
pnpm db:migrate
pnpm demo:seed

# 4. Start all applications in development
pnpm dev
```

Access the Dashboard at **http://localhost:3000** and the API at **http://localhost:4000/docs**.
