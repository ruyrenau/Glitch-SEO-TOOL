# ADR 002: Separation of REST API and Worker Processes

## Context
CPU-intensive jobs such as log streaming, crawler execution, and shingling similarity computations must not degrade HTTP response latency for dashboard users.

## Decision
Separate Fastify REST API (`apps/api`) from the asynchronous job worker (`apps/worker`) connected via Redis/BullMQ.

## Consequences
- Fast HTTP responses (<50ms) for UI interactions.
- Background jobs can scale horizontally without affecting dashboard availability.
