# ADR 012: SEO field edits on live WordPress content

## Context
ADR 003 forbids publishing from the tool: everything sent to WordPress is a draft. The SEO explorer finds problems on published pages (short titles, missing meta descriptions, images without alt), and fixing them by hand in wp-admin one by one is the slowest part of an audit.

## Decision
Allow a narrow exception: changes to **SEO fields only** on content that is already published, through an explicit workflow.

- **Editable fields:** post/page title, slug, SEO title and meta description of Yoast SEO or Rank Math, and the alt text of media-library images. Content, excerpt, status, author and dates are never sent.
- **Workflow:** propose → approve → apply → verify → revert.
  - Proposing needs `content:edit`. Approving, applying, verifying and reverting need `seo:operate`, so an Editor cannot push a change alone.
  - Applying needs an explicit confirmation.
- **Conflict check:** the old value is read when the change is proposed. On apply, WordPress must still hold that value; otherwise the proposal becomes `conflict` and nothing is written.
- **Backup and revert:** the old value is kept on the proposal. Revert only runs while WordPress still holds the applied value.
- **Verification:** after applying, the public page is fetched (SSRF guard applies) and the change is looked for in the HTML. A mismatch is reported, never hidden.
- **SEO plugin meta:** Yoast and Rank Math do not expose their meta over REST. `docs/wordpress/glitch-seo-meta.php` is a mu-plugin that registers only their title and description keys, writable by users who can edit the post. The client only writes the keys of the plugin detected as active (from the REST namespaces).
- **Audit:** every step is recorded (`seo_change.proposed`, `.approved`, `.rejected`, `.applied`, `.conflict`, `.reverted`).

## Known limits
- WordPress copies the alt text into the post HTML when an image is inserted. Changing it in the media library does not update images already inserted; verification reports that as a mismatch.
- The meta description only renders if Yoast or Rank Math is active.
- Page caches (plugin, host or CDN) can keep serving the old HTML; verification then reports a mismatch that mentions the cache.
- Changing a slug changes the URL. WordPress redirects old slugs of posts, not of pages.
- The home page and archive pages are not posts or pages and cannot be edited this way.

## Consequences
- SEO fixes are a click away, with a named approver and a full trail.
- ADR 003 still holds for content: new content is only ever sent as a draft.
