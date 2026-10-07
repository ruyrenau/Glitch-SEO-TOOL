# ADR 005: SQLite first, custom line splitter, aggregates only

Date: 2026-10-05 · Status: accepted

## Context

The first scaffold targeted PostgreSQL + Redis but nothing ran without Docker, and every dashboard number was hard-coded. The log parser used `readline`'s async iterator.

## Decisions

1. **SQLite via Prisma for v0.x.** Runs with zero services, keeps real migrations, and the schema stays portable. Switch `provider` to `postgresql` when jobs and multi-user access arrive.
2. **Own line splitter instead of `readline`.** `readline`'s async iterator buffers lines faster than they are consumed. `readLines()` iterates the stream with `destroyOnReturn: false` and only pulls the next chunk after yielding every line of the current one.
3. **Copy retained strings.** V8 substrings reference their parent chunk; any string kept in the aggregate map is copied (`detach`). Without this, heap grew ~240 bytes per line (500 MB at 2M lines).
4. **Store aggregates, not lines.** Key `(day, bot, status, path)`; human traffic is folded into path `*`. Hard cap of 250,000 keys, overflow folded into `(other)` and flagged in the report.
5. **Latency as a fixed histogram.** Constant memory; percentiles are bucket upper bounds and documented as such.

## Consequences

- 2M lines run under a 128 MB heap. Benchmark is part of CI.
- Per-request detail (individual IPs, exact timestamps) is unavailable by design.
- Very high-cardinality sites will hit the key cap; an analytical store (ClickHouse/DuckDB) is the scaling path.
