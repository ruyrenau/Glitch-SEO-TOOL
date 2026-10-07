# Career & Interview Deliverables

Only claim what the code does today. Update this file as roadmap items ship.

## Portfolio summary (accurate for v0.7)

> Built a TypeScript SEO operations tool that streams Nginx/Apache server logs (including gzip) with bounded memory, identifies search-engine and AI crawlers, stores privacy-safe aggregates, cross-references bot activity with XML sitemaps, and crawls sites (robots.txt-compliant, rate-limited, SSRF-guarded) to detect and prioritize 39 types of technical SEO issues, raises alerts when a deploy introduces regressions between crawls, and turns CSV datasets into quality-gated programmatic pages that are published to WordPress as drafts, through its REST API, only after human approval. Access is protected by session-based authentication and workspace-scoped role-based permissions. Includes a Fastify REST API with OpenAPI, a Next.js dashboard, a CLI, SSRF-guarded sitemap fetching, an audit trail, and Vitest/Playwright test suites.

Do **not** claim Search Console integration or a job queue until they exist. WordPress integration creates and updates drafts only.

## Resume bullets (accurate for v0.7)

- Built a streaming log-analysis pipeline in TypeScript that processes 2M Nginx lines (432 MB) in ~31 s under a 128 MB heap cap; found and fixed a V8 sliced-string leak that previously retained ~240 bytes per line.
- Implemented privacy-by-design ingestion: HMAC-hashed IPs never persisted, sensitive query parameters redacted, SHA-256 de-duplication, zip-bomb and file-type validation.
- Cross-referenced crawler logs with XML sitemaps to report sitemap URLs Googlebot never visited and crawled URLs missing from the sitemap; tracked AI crawler activity and AI-assistant referral traffic.
- Built a polite technical SEO crawler (RFC 9309 robots.txt, rate limiting, redirect-chain capture with SSRF checks on every hop) and 39 audit rules covering indexability, canonicals, sitemaps, duplicates and structured data; issues persist across crawls with evidence, status and resolution tracking.
- Added crawl-to-crawl diffing and regression alerts (noindex added, pages broken, canonical changes, new robots.txt blocks) with optional Slack/webhook delivery, validated by an end-to-end test that simulates a bad deploy.
- Integrated the WordPress REST API with Application Passwords (encrypted at rest) under a drafts-only policy: human approval gate, dry-run diffs, detection of edits made in wp-admin, pre-update backups with restore, idempotent sends; verified against a real WordPress via WordPress Playground.
- Designed programmatic-content quality gates that measure what each data row adds beyond the template (shingle sets minus boilerplate), so template pages are not false duplicates while copied rows are blocked; added CSV profiling, HTML escaping of data, risky-claim detection and per-page bulk review.
- Implemented authentication and RBAC: bcrypt, hashed server-side session tokens in httpOnly cookies, login throttling, origin-based CSRF protection, five roles with deny-by-default route permissions and workspace isolation on every resource; audited actions and approvals carry the real user.
- Delivered a Fastify API (Zod validation, correlation IDs, OpenAPI), Next.js dashboard and CLI on a shared Prisma data layer, covered by 123 Vitest unit/integration tests (including a local fixture site with planted problems) and Playwright end-to-end tests.

## Interview demo (3–5 minutes)

1. **Problem (0:00–0:45).** What bots actually request (logs) differs from what you want crawled (sitemap). Show the "in sitemap, never visited by Googlebot" table.
2. **Pipeline (0:45–2:00).** Stream → line splitter with real backpressure → parse → sanitize → bounded aggregation → batched inserts. Explain why `readline`'s async iterator was replaced and the sliced-string leak; show `pnpm bench:logs` under a heap cap.
3. **Privacy and safety (2:00–3:00).** Upload the fixture log and show that `token=secret123` is redacted and no IP appears; show the SSRF test blocking `169.254.169.254`; show the duplicate-import 409.
4. **Honesty in the UI (3:00–3:30).** Modules without a backend say "PENDIENTE" instead of showing invented numbers; crawl waste is labelled as an estimate.
5. **Crawler (3:30–4:15).** Crawl the fixture site from the dashboard; open the redirect-chain issue and its evidence; mark one issue ignored and re-crawl to show it stays ignored.
6. **Regression alert (4:15–4:45).** Show the second demo crawl (simulated bad deploy): the diff chips and the critical "noindex added" alert.
7. **WordPress (4:45–5:30).** `pnpm wp:local`, connect, generate a page, show the quality gate blocking a page with missing data, approve, dry run, send as draft; edit it in wp-admin and show the conflict warning.
8. **Next steps.** CSV datasets, BullMQ jobs, authentication.
