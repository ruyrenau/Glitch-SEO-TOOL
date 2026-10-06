# ADR 003: Enforcement of Draft-Only Publication to WordPress

## Context
Accidental publication of programmatic content before human editorial review can lead to indexing penalties, duplicate content issues, or brand damage.

## Decision
Hardcode `status: 'draft'` in the WordPress connector payload. Prohibit any programmatic override to `publish`.

## Consequences
- 100% guarantee that all content requires human editorial approval in the WordPress CMS.
