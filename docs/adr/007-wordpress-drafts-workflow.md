# ADR 007: WordPress drafts workflow

Date: 2026-10-05 · Status: accepted (refines ADR 003)

## Decisions

- **Drafts only, enforced in three places.** The client always sends `status: draft`, refuses to update a post whose remote status is not `draft`, and has no publish or delete methods. A page must be approved by a named reviewer before any send; blocked pages cannot be approved.
- **Optimistic concurrency with `modified_gmt`.** After each write the page stores the remote `modified_gmt`. If it differs on the next send, someone edited the draft in wp-admin: the send stops with `REMOTE_CHANGED` and a diff, and only an explicit `overwriteRemoteChanges` proceeds.
- **Backups instead of rollback magic.** Each update stores the previous remote title/content/excerpt/slug. "Restore" writes that copy back while the post is still a draft. A create has nothing to restore, and the tool never deletes remote posts.
- **Credentials.** Application Passwords are encrypted with AES-256-GCM (`CREDENTIALS_KEY`, required in production), masked in responses, and only sent over HTTPS. Local hosts are allowed through the same allowlist the crawler uses; requests go through the SSRF guard and do not follow redirects.
- **`?rest_route=` URLs** so the integration works with and without pretty permalinks.
- **Idempotency-Key** on the send endpoint (in-memory, 24 h) so a retried request cannot create two drafts.
- **Two test targets.** A contract mock runs in every test run; the same suite runs against a real WordPress (WordPress Playground, `pnpm wp:local`) when `WP_TEST_URL` is set. CI runs both.
