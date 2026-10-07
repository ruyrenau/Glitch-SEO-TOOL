# Glitch SEO Ops Engine

Internal SEO operations tool in TypeScript. It streams Nginx/Apache access logs, identifies search-engine and AI crawlers, cross-references bot activity with the XML sitemap, crawls sites to detect and prioritize technical SEO issues, alerts when a deploy breaks something between two crawls, and sends human-approved programmatic pages to WordPress as drafts. A dashboard, a REST API and a CLI sit on top of the same services.

> **Status (v0.9).** Log + sitemap analysis, the technical crawler/auditor, crawl diffs and alerts, and the programmatic content workflow (CSV dataset → template → batch generation with quality gates → human approval → WordPress drafts) are real and tested end to end (WordPress tests also run against a real WordPress). Search Console and GEO monitoring are **not built yet**; the dashboard marks those modules as `PRONTO` and shows no numbers for them. See [Roadmap](#roadmap).

## What works today

| Area | Implemented |
|---|---|
| Log ingestion | `.log`, `.txt`, `.gz` (gzip detected by magic bytes). Nginx/Apache *combined*, with or without `$request_time`. Streaming with real backpressure, cancellation via `AbortSignal`, zip-bomb guard, SHA-256 de-duplication, redacted samples of unparsed lines. |
| Privacy | IPs are HMAC-hashed with `SALT_SECRET` and never stored. Sensitive query params (`token`, `email`, `password`, `session`, `user`…) are redacted before anything is persisted. Only aggregates are stored, never raw lines. |
| Bot identification | Googlebot (smartphone, desktop, image, video, news), Bingbot, Applebot, DuckDuckBot, Yandex, Baidu, GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Bytespider, Amazonbot, CCBot, Google-Extended, SEO tools, unknown bots. Search-engine crawlers (Googlebot variants, Bingbot, Applebot, YandexBot, Baiduspider) are **verified by reverse + forward DNS**; spoofed hits are reported separately. Raw IPs exist only in memory during the import; the verification cache is keyed by an HMAC. AI crawlers do not publish a DNS method and are reported as declared. |
| Log report | Bot hits by day, hour, bot, directory; HTTP status distribution; most/least crawled URLs; 4xx, 5xx and redirects served to bots; crawled parameters; response-time p50/p90/p99; AI-bot activity; **human visits referred by ChatGPT, Perplexity, Claude, Gemini, Copilot**; potential crawl waste (explicitly an estimate). CSV export with formula-injection protection. |
| Sitemap | Upload `sitemap.xml` or fetch by URL (follows sitemap indexes). SSRF guard blocks private, loopback, link-local and metadata IPs. No DTD/entity expansion. |
| Cross-reference | Sitemap URLs never visited by Googlebot in the log period; URLs crawled with 200 that are missing from the sitemap. Crawled pages are flagged when Googlebot requested them in the latest log. |
| Crawler | robots.txt (RFC 9309: longest match, `*`/`$`, most specific group, crawl-delay), rate limit and concurrency, max URLs/depth, include/exclude regexes, dangerous paths never requested (logout, cart, checkout, wp-admin, internal search), SSRF check on **every** redirect hop, redirect chains and loops recorded, body size cap, cancellation. Seeds from the homepage and stored sitemap URLs. No JavaScript rendering. |
| Extraction | Title, meta description, robots meta, X-Robots-Tag, canonical, H1/H2, lang, hreflang, Open Graph title, JSON-LD types and syntax errors, internal/external links, images without alt, main-content word count and hash (nav/header/footer excluded), depth, inlinks, indexability with reason. |
| Issues (39 rules) | HTTP 4xx/5xx, fetch failures, redirect chains/loops, links to redirects, broken internal links, robots.txt missing / no sitemap line / blocked URLs, http to https and www variants, noindex (and noindex **in the sitemap**), indexable staging, sitemap with non-indexable URLs, indexable pages missing from the sitemap, sitemap orphans, missing/invalid/cross-host canonicals, indexable parameter URLs, title missing/short/long/duplicate, description missing/duplicate, H1 missing/multiple, lang, hreflang, thin and exact-duplicate content, depth over 4, images without alt, invalid JSON-LD, missing JSON-LD, slow responses. Each issue keeps evidence, sample URLs, impact/effort/risk/confidence and a status (open, in progress, resolved, ignored). Re-crawls upsert by code, resolve what disappeared and keep "ignored". |
| Crawl diff | Every completed crawl is compared with the previous one: pages added/removed, status changes, pages broken or recovered, noindex added, became (non-)indexable, canonical/title/description/H1 changes, content shrunk by more than half, JSON-LD types removed, pages newly blocked by robots.txt. Removed pages are not reported when the newer crawl was cut short. |
| Alerts | Regressions only (noindex added, pages broken, no longer indexable, canonical changed, new robots.txt blocks, content shrunk, schema removed, mass title changes, robots.txt changed or unreachable), with severity, URLs and details. Optional delivery to `ALERT_WEBHOOK_URL` (generic JSON, or Slack format for `hooks.slack.com`), SSRF-guarded; the delivery result is stored on the alert. Alerts can be acknowledged. |
| Datasets | CSV import (RFC 4180: quotes, newlines in cells, BOM; `,` `;` or tab), up to 5,000 rows and 100 columns, SHA-256 de-duplication. Each column becomes a `{{variable}}` with an inferred type (number, boolean, URL, email, date, text). Reports duplicate rows, empty cells and whether a column identifies every row. Deleting a dataset keeps already generated pages and their source data. |
| Templates | Title, meta description, slug and HTML body. Variables are checked against the dataset's columns; scripts and inline event handlers are rejected; data values are HTML-escaped when inserted into the body. |
| Batch generation | Up to 500 rows per run. Each page goes through the quality gate: title and description length, slug, H1, thin content, **missing data for a variable**, leftover `{{ }}`, risky claims ("garantizado", "#1", "100 %"...), words specific to the row, and similarity to every other page of the site. Similarity is measured on the content each row adds (shingles minus the template boilerplate), so pages are not flagged just for sharing a template, while a row that repeats another row's data is blocked as a near-duplicate. Slug collisions are skipped and reported. Exact hash, shingle/Jaccard and a 64-bit SimHash are available. States: blocked, needs review, ready, approved, draft in WordPress. |
| Human approval | Sending is impossible until a named reviewer approves the page; blocked pages cannot be approved. Every review is stored. Bulk approve/reject/send report a result per page (blocked or unapproved pages are refused, conflicts are never overwritten in bulk). |
| WordPress | REST API + Application Passwords. Credentials encrypted at rest (AES-256-GCM, `CREDENTIALS_KEY`) and never returned. HTTPS required (local hosts only via `CRAWL_ALLOW_PRIVATE_HOSTS`). Connection test checks the user can edit posts; lists categories. **Drafts only**: never publishes, never deletes, refuses to touch a post that is no longer a draft. Dry run with title and line diff. Detects edits made in wp-admin since the last send (`modified_gmt`) and asks before overwriting. Keeps a copy of the remote post before each update and can restore it. `Idempotency-Key` on send. Retries 429/503 honoring `Retry-After`. Every attempt (including conflicts and refusals) is logged. |
| SEO explorer | Screaming Frog-style view of a crawl: 18 tabs (internal, response codes, URI, titles, meta description, keywords, H1, H2, images, canonicals, directives, hreflang, structured data, Open Graph/Twitter, links, pagination, resources and files, external) with filters and counts, file-type overview, search, sort, resizable and selectable columns, CSV export. Per-URL detail: inlinks with anchors, outlinks with status, images, SERP preview, source, headers, issues. The crawler checks every CSS, JS, image, font, PDF and external link used by the pages (status, content type, size, where it is used) without downloading bodies. |
| SEO edits on live WordPress | Title, slug, Yoast/Rank Math SEO title and meta description, and media alt text of published posts and pages, through propose → approve → apply → verify → revert. Conflict check against the value read at proposal time, old value kept for revert, the change is checked on the public page (caches reported), every step audited. Content and status are never sent. See [ADR 012](docs/adr/012-seo-edits-on-live-wordpress.md). |
| Tools | JSON-LD validator. |
| Core Web Vitals | Lab data from Lighthouse run locally in headless Chrome/Edge (no account needed), or PageSpeed Insights with `PSI_API_KEY`, which adds real-user CrUX field data (p75 LCP, INP, CLS, FCP, TTFB, URL or origin level, collection period). Field and lab are stored and shown separately; "insufficient data" is explicit. Diagnostics: render-blocking resources, unsized images, offscreen images, unused JS/CSS, cache policy, font-display, byte weight, request count and more. Mobile/desktop, history per URL, runs as a queued job (one browser at a time), URLs restricted to the site's host. |
| Job queue | BullMQ on Redis with a separate worker process (`apps/worker`). Log imports and crawls are queued by the API and survive API restarts. Every job has a database record (status, progress, last log lines, attempts, result, error, who/what triggered it). Exponential-backoff retries; final failures stay in the BullMQ failed set (dead letter) and can be retried by hand; non-recoverable errors are not retried. Queued jobs can be cancelled immediately, running ones cooperatively. Per-site scheduled crawls (cron, site timezone, at most hourly) and a daily retention job (old log imports, expired sessions, temp files, old job history; audited). Worker heartbeat shown in `/health/ready` and the dashboard. |
| Authentication | Username + password (bcrypt, cost 12; constant-time answer for unknown users). Server-side sessions: random 256-bit token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production), only its SHA-256 stored, 12 h sliding expiry. Login throttling (5 failures per user+IP, 30 per IP, 15 min) with `Retry-After`. CSRF: state-changing requests from a foreign `Origin` are rejected. Temporary passwords must be changed before anything else. Changing a password ends the user's other sessions; disabling a user ends all of them. |
| Authorization | Roles per workspace: Owner, Admin, SEO Manager, Editor, Viewer. Every route maps to a permission; unlisted write routes need `site:manage` (deny by default). Every `:id` (site, crawl, issue, alert, import, dataset, template, page, publication, user) is checked against the caller's workspace and answers 404 if it belongs to another one. Only Owners manage Owners; the last Owner cannot be removed; nobody changes their own role. Audit events and content approvals record the signed-in user. |
| Platform | Fastify API with Zod validation, stable error format with correlation IDs, OpenAPI at `/docs`, readiness check that queries the DB, audit log for every write. Prisma + SQLite with migrations. |

## Measured performance

`pnpm bench:logs` streams synthetic Nginx lines through the parser (Windows 10, Node 24):

| Lines | File | Time | Peak heap | Heap cap |
|---|---|---|---|---|
| 1,000,000 | 216 MB | 16 s | 87 MB | none |
| 2,000,000 | 432 MB | 31 s | 103 MB | `--max-old-space-size=128` (passes) |

Memory is bounded by the number of distinct `(day, bot, status, URL)` keys, capped at 250,000; beyond that, rare URLs fold into `(other)` and the report says so. The cap matters: an earlier version leaked ~240 bytes per line because V8 substrings kept 64 KB read chunks alive; the fix is in `packages/log-parser/src/parser.ts`.

## Quickstart (no Docker needed)

```bash
pnpm install
cp .env.example .env          # set SALT_SECRET and CREDENTIALS_KEY to long random strings
pnpm db:generate
pnpm --filter @glitch/db exec prisma migrate deploy
pnpm build
pnpm demo:seed                # Owner from SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD (or a printed temporary password) + [DEMO] sites: synthetic logs + sitemap, two real crawls of a local fixture site, a CSV dataset with generated pages
pnpm start:local              # Redis + API :4000 + worker + dashboard :3000, Ctrl+C stops all
```

`pnpm start:local` starts a local Redis if none is running (on Windows it downloads a portable Redis build into `.tools/` the first time; elsewhere it runs `redis-server` from PATH). Pieces can also run separately: `pnpm redis:local`, `node apps/api/dist/index.js`, `pnpm worker`, `pnpm --filter @glitch/web start`. Without a worker, jobs wait in the queue; `EMBEDDED_WORKER=true` runs the worker inside the API process.

Demo data is synthetic and labelled `[DEMO]` in the UI; it goes through the same pipelines as real data. The "[DEMO] Fixture site (local)" is a small local website with intentional problems (redirect chain and loop, 404/500, noindex in the sitemap, duplicates, broken JSON-LD and more). The seed crawls it twice, the second time as a simulated bad deploy, so the demo includes a diff and alerts. To re-crawl it, run `pnpm demo:site` (or `DEMO_SITE_VERSION=2 pnpm demo:site` for the broken version) and start the API with `CRAWL_ALLOW_PRIVATE_HOSTS=127.0.0.1`.

### A real WordPress without Docker

`pnpm wp:local` starts a throwaway WordPress on http://127.0.0.1:8881 with WordPress Playground (WebAssembly) and prints an Application Password for `admin`. Start the API with `CRAWL_ALLOW_PRIVATE_HOSTS=127.0.0.1` to connect to it. The WordPress test suite can run against it:

```bash
WP_TEST_URL=http://127.0.0.1:8881 WP_TEST_USER=admin WP_TEST_APP_PASSWORD=<printed> pnpm test
```

Crawling public sites needs no extra configuration. Private and loopback addresses are blocked unless listed in `CRAWL_ALLOW_PRIVATE_HOSTS`.

### CLI

```bash
GLITCH_USER_PASSWORD=... pnpm cli users:create --username ana --name "Ana" --role EDITOR [--temporary]
GLITCH_USER_PASSWORD=... pnpm cli users:reset-password --username ana [--temporary]
pnpm cli sites:list
pnpm cli site:create --name "My site" --url https://www.example.com
pnpm cli logs:analyze ./access.log.gz          # local analysis, saves nothing
pnpm cli logs:import ./access.log --site <id>  # exit 2 if already imported (use --replace)
pnpm cli sitemap:import https://www.example.com/sitemap.xml --site <id>
pnpm cli logs:report --site <id> [--json]
pnpm cli crawl:start --site <id> [--max-urls 500 --rps 2 --concurrency 2]
pnpm cli issues:list --site <id> [--status open]
pnpm cli alerts:list --site <id> [--all]
WP_APP_PASSWORD=... pnpm cli wordpress:connect --site <id> --url https://example.com --user editor
pnpm cli datasets:import ./servicios.csv --site <id>   # exit 2 if already imported
pnpm cli templates:list --site <id>
pnpm cli content:generate --template <id> [--limit 500]
pnpm cli pages:list --site <id>
pnpm cli wordpress:dry-run --page <id>
pnpm cli wordpress:push --page <id> [--overwrite-remote-changes]   # exit 4 on a remote-edit conflict
pnpm cli schema:validate ./schema.json         # exit 1 when invalid
```

### Docker

`docker compose up --build` starts Redis, the API (migrations applied at start), the worker and the web app; SQLite and uploads live on a shared volume. Set `SALT_SECRET` and `CREDENTIALS_KEY` in `.env` first. *Not yet verified on a machine with Docker.*

## Tests

```bash
pnpm test        # Vitest (151 tests; needs Redis, started automatically; runs real Lighthouse when Chrome/Edge is installed): parser, bots, robots.txt, extraction, crawler vs a local fixture site, SSRF, API integration on a throwaway SQLite DB
pnpm test:e2e    # Playwright (8 flows): login/logout; logs; crawl and issue triage; bad deploy raises alerts; single page to WordPress with a conflict; CSV → batch → bulk approve → bulk send; edit a live SEO title from the explorer, approve, apply, verify and revert
pnpm typecheck
pnpm bench:logs [lines]
```

E2E uses the installed Microsoft Edge locally (`PW_CHANNEL=chromium` in CI) and needs ports 3000/4000 free.

## Architecture

```
apps/api       Fastify REST API (/api/v1, OpenAPI at /docs)
apps/web       Next.js dashboard
apps/cli       seo-ops CLI
apps/worker    placeholder, no jobs yet
packages/log-parser   streaming parser, bot rules, synthetic log generator
packages/crawler      robots.txt, crawler, HTML extraction, 39 issue rules, sitemap parser/fetcher, SSRF guard
packages/testing      local fixture website with intentional SEO problems
packages/db           Prisma schema, migrations, import/report/audit services, seed
packages/core         privacy helpers, scoring
packages/schema-engine, content-engine, connectors, config
```

## Known limitations

- No password recovery by email yet (an Admin resets passwords). Login throttling is in memory (per API process).
- WordPress drafts: posts only (no pages, media upload or featured images). SEO edits on live content cover posts and pages, but not the home page or archives; Yoast/Rank Math fields need the mu-plugin in `docs/wordpress/`. Changing a media alt does not update images already inserted in a post's HTML.
- There is no JavaScript rendering, so client-rendered content is invisible to the crawler.
- SQLite is shared by the API and worker processes on one machine; several machines need PostgreSQL (switch the Prisma provider) and a shared upload store.
- Retrying a failed log import requires uploading the file again (temp files are deleted after a final failure).
- Issue priority is a heuristic: issues are listed by severity, then by `impact × confidence × URL factor × severity weight ÷ (effort × risk)`. It orders work; it does not estimate traffic.
- Orphan detection only sees pages linked from crawled pages; when the URL limit is reached its confidence is lowered.
- Bot identity is based on the declared user agent; spoofed bots are counted as real.
- Response-time percentiles are bucket upper bounds (10, 25, 50 … 10,000 ms), not exact values.
- Only the *combined* log format (plus optional request time) is parsed; custom templates are not supported.
- SSRF guard resolves DNS before fetching; DNS rebinding between check and fetch is not prevented.
- No ESLint configuration yet; `pnpm lint` does not check anything meaningful.

## Roadmap

1. **WordPress extras**: media upload and featured images for drafts, JSON-LD per page, inline image alt inside post content.
2. **Search Console**: OAuth, Search Analytics, cross-reference with logs.
3. GEO monitoring, log-based alerts (5xx spikes, Googlebot drops).

## Ideas worth building (beyond the original spec)

- **AI citation ratio**: AI-referred human visits vs. AI-bot crawl volume per section (the data is already collected).
- **robots.txt vs reality**: which AI bots are blocked by rules yet still appear in logs, and which allowed ones never come.
- **Redirect map simulator**: validate a migration redirect file for chains, loops and 404 targets before deploy.
- **Schema/visible-content parity**: flag FAQ or price data present in JSON-LD but not on the page.
- **Issue → ticket export**: Markdown/Jira/GitHub issues with evidence and acceptance criteria.
