# ADR 009: Authentication and role-based access

Date: 2026-10-07 · Status: accepted

## Decisions

- **Server-side sessions, not JWTs.** A random 256-bit token lives in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production); the database stores only its SHA-256. Sessions can be revoked instantly (logout, password change, user disabled), which stateless JWTs cannot do without extra machinery.
- **bcrypt (cost 12).** Unknown usernames are compared against a dummy hash so response time does not reveal which usernames exist; the error message is the same for both cases.
- **Throttling in memory.** 5 failures per username+IP and 30 per IP in 15 minutes. Enough for one API process; a shared store (Redis) is needed when the API scales out.
- **CSRF by Origin.** Cookies are `SameSite=Lax`, CORS allows only the dashboard origin, and any non-GET request carrying a foreign `Origin` is rejected. Non-browser clients (CLI, tests) send no Origin.
- **Deny by default.** Each route maps to one permission. Write routes not in the table require `site:manage`, so a new endpoint is admin-only until someone grants it on purpose.
- **Workspace isolation in one place.** A pre-handler resolves the workspace of whatever `:id` the route names (and of every id in bulk bodies) and answers 404 for other workspaces, so handlers cannot forget the check.
- **Actor via AsyncLocalStorage.** Audit events and approvals pick up the signed-in user without threading it through every service call.
- **Credentials never in the repo.** The first Owner comes from `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD` or gets a printed temporary password that must be changed; the CLI reads passwords from `GLITCH_USER_PASSWORD`.
