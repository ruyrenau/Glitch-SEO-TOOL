# ADR 006: Crawler design

Date: 2026-10-05 · Status: accepted

## Decisions

- **Own crawler, no headless browser.** Fetch + cheerio covers the HTML signals the audit rules need and keeps the tool free and fast. JavaScript rendering is a later, opt-in step.
- **Safety first.** robots.txt is respected by default (RFC 9309 semantics). Dangerous paths (logout, cart, checkout, wp-admin, internal search) are never requested. The rate limit applies to every request, including redirect hops. The SSRF guard runs on every redirect hop, not just the first URL. Private hosts need an explicit allowlist.
- **Redirects are recorded, then the target is crawled as its own page.** Each URL appears once with its own status; chains and loops are kept as evidence.
- **Issues are upserted per (site, code).** A re-crawl updates evidence and counts, resolves codes that no longer fire, and never reopens issues a person marked "ignored".
- **Ordering = severity, then heuristic score.** The spec's `impact × confidence × affected factor × importance ÷ (effort × risk)` alone ranked a critical 5xx below a missing H1, because hard fixes were penalized. Severity now acts as the importance weight and as the primary sort key.
- **In-process background run.** Crawls run inside the API process with an AbortController until the BullMQ queue exists; runs left "running" after a restart are marked failed.
