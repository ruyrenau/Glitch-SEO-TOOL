# ADR 011: Crawler DNS verification and Core Web Vitals

Date: 2026-10-07 · Status: accepted

## Crawler verification

- **Method.** Reverse DNS → hostname must end in the operator's domain → forward DNS of that hostname must contain the IP. This is the method Google, Bing, Apple, Yandex and Baidu document; a PTR record alone is not trusted because whoever controls an IP range controls its PTR.
- **Privacy.** Logs are otherwise stored as aggregates with HMAC-hashed IPs. Verification needs the raw IP, so raw IPs of DNS-verifiable bots are held in memory during one import (capped at 20,000), checked, and discarded. Only hit counts are stored. The cache key is `family + HMAC(ip)`; neither IPs nor hostnames (which embed the IP) are persisted.
- **Cost control.** Most-active IPs first, at most 2,000 per import, 8 concurrent lookups, 2.5 s timeout, 7-day cache. Timeouts are recorded as "unchecked", never as spoofed.
- **Scope.** AI crawlers (GPTBot, ClaudeBot, PerplexityBot…) and DuckDuckBot publish IP lists, not DNS methods; they are shown as declared rather than guessed. Disable with `BOT_DNS_VERIFICATION=false`.

## Core Web Vitals

- **Two sources, never mixed.** Local Lighthouse (headless Chrome/Edge) needs no account and gives lab data. PageSpeed Insights with `PSI_API_KEY` adds CrUX field data. Keyless PSI calls share a global quota that is usually exhausted, so the key is required in practice for field data.
- **Field data first in the UI**, labeled as p75 of real Chrome users over 28 days, with URL vs origin scope and the collection period. Lab data is labeled "simulated"; INP is never shown as a lab metric (TBT is named as its proxy). "Insufficient data" is a state, not an error.
- **Queued job, one browser at a time.** Measurements run in a dedicated `performance` queue with concurrency 1. URLs must belong to the site's host and pass the SSRF guard; quota and missing-browser errors stop the run instead of retrying.
- **Stored per run:** score and key metrics as columns (for trends), full lab/field/diagnostics as JSON.
