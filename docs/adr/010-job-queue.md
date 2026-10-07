# ADR 010: Background jobs with BullMQ and Redis

Date: 2026-10-07 · Status: accepted (supersedes the in-process crawl runner of ADR 006)

## Context

Crawls ran inside the API process and log imports inside the upload request. An API restart lost running crawls, large uploads held an HTTP request open for minutes, and nothing could run on a schedule.

## Decisions

- **BullMQ on Redis, separate worker process.** The API only validates, stores the upload and enqueues. `apps/worker` consumes three queues (imports, crawls, maintenance) with per-queue concurrency. Several workers can run; BullMQ guarantees one consumer per job and re-queues jobs whose worker died (stalled detection).
- **Database row per job, BullMQ id = row id.** Redis holds the queue; the `Job` table is the history the dashboard and audit log use (status, progress, last 50 log lines, attempts, result, error, trigger, creator). The row is created first; if Redis is down the row is marked FAILED and the API answers 503, so nothing disappears silently.
- **Retries.** Exponential backoff (`JOB_BACKOFF_MS`, 10 s base). Errors that cannot change (duplicate file, missing upload, cancellation) are thrown as `UnrecoverableError`. Final failures stay in BullMQ's failed set (dead letter) and can be re-run as a new job linked by `retryOfId`.
- **Cancellation.** Queued jobs are removed from Redis immediately. Running jobs get a `cancelRequested` flag; the worker polls it every second and aborts the crawl or parser through the existing `AbortSignal` support, keeping partial results.
- **Duplicates checked before queueing.** The upload is hashed while it is written, so a duplicate log is rejected with 409 at once instead of failing minutes later in the worker.
- **Schedules.** Per-site cron (BullMQ job schedulers, site timezone, at most hourly to protect the target site) and a daily retention job. Scheduler-created jobs get their database row when the worker picks them up.
- **Local Redis without Docker.** `scripts/redis-local.mjs` reuses a running Redis or starts one (portable build on Windows, `redis-server` elsewhere); `pnpm start:local` runs Redis, API, worker and web together. `EMBEDDED_WORKER=true` runs the worker inside the API for E2E and tiny deployments.

## Consequences

- Redis is now a required service for imports and crawls (reads keep working without it; `/health/ready` reports queue and worker state).
- SQLite is shared by API and worker on one host. Multiple hosts require PostgreSQL and a shared upload store.
