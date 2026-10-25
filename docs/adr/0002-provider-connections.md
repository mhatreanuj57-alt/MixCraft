# ADR 0002 — Provider connection flows

- Status: accepted (Stage 3)
- Date: 2026-10-25

## Context

MixCraft must connect a user's GitHub, npm, and Vercel accounts (prd.md, file_structure.md §9). The API is a Fastify monolith with sessions, CSRF, and normalized error envelopes from Stage 2. `architecture.md` §7 lists connection routes (`GET /api/connections`, `POST /api/connections/:provider`, OAuth start/callback) but not lifecycle management, and the frontend must show honest states for unconfigured providers without ever seeing a credential.

## Decision

- **One unified route module** `apps/api/src/routes/connections.routes.ts`, registered in `app.ts`, with a shared `requireAuth` JSON guard for management routes and 302 redirects for OAuth callbacks:
  - `GET /api/connections` — list + per-provider `configured`, `Cache-Control: no-store`.
  - `POST /api/connections/npm` — npm granular token validated via `GET registry.npmjs.org/-/whoami`.
  - `GET /api/connections/github/start|callback` — GitHub App install flow (`GITHUB_APP_SLUG`, user-to-server OAuth), App JWT signed with `GITHUB_APP_PRIVATE_KEY`, installation verified against `GET /user/installations/{id}/repositories`.
  - `GET /api/connections/vercel/start|callback` — standard authorization-code flow with PKCE (S256) and rotating refresh tokens.
  - `POST /api/connections/:provider/:connectionId/refresh` and `DELETE /api/connections/:provider/:connectionId` — **additions beyond architecture.md §7**, needed so the UI can revalidate and disconnect without fabricating state.
- **Callbacks answer 302** to `${WEB_ORIGIN}/connections?provider=…&status=connected` or `…&error=<CODE>` because the browser arrives from a provider round-trip; JSON error envelopes remain for `start`/`refresh`/`disconnect`/list.
- **State and binding**: transactions store only the SHA-256 of `state` plus an encrypted PKCE verifier; a path-scoped `HttpOnly` binding cookie (`/api/connections/github|vercel`) ties the callback to the browser. Callbacks accept valid `state` **or** a matching binding (GitHub may omit `state`). Consumption is atomic (`consumedAt: null` update) and `unique(userId, provider, providerAccountId)` is the second replay guard.
- **Configuration is optional outside production**: missing `GITHUB_APP_*` / `VERCEL_CLIENT_*` never fails boot; affected routes return `503 PROVIDER_UNAVAILABLE` and the list route reports `configured: false`.
- **One installation, one account**: `github_installations.installation_id` is globally unique; a second user connecting the same installation receives `409 OPERATION_CONFLICT`.
- **Provider HTTP goes through injectable fetch adapters** (`github.app.ts`, `github.auth.ts`, `vercel.auth.ts`, `npm.client.ts`) so integration tests use `tests/helpers/provider-mock.ts` instead of live traffic.

## Alternatives considered

- Per-provider route modules — rejected now; three providers share auth, CSRF, error, and audit plumbing, and Stage 4+ repository/task routes can split out later.
- JSON-only callbacks (SPA fetch-based OAuth) — rejected; GitHub/Vercel redirect flows are browser-native and the app has no popup/router handling yet.
- Webhooks for installation lifecycle (GitHub `installation` events) — deferred; no webhook endpoint exists yet and pull-based `refresh` covers suspended/renamed installs honestly.

## Consequences

- Scope additions beyond `architecture.md` §7 (start/refresh/disconnect, redirect-based callback responses) are documented in `docs/development.md`.
- Callback outcomes are single query parameters; codes are audited server-side before redirect, so failures stay observable even though the browser only sees a code.
- npm has no server-side revoke API; disconnect deletes MixCraft's copy and audits `revoke: skipped`.
- Security: sessions + CSRF + Origin on every management route; no credential in any redirect target, response body, or log line (pino header redaction already covers cookies).

## Migration

No schema migration — Stage 1's `provider_connections`, `encrypted_credentials`, `github_installations`, `oauth_transactions`, and `audit_events` tables already model this.
