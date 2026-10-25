# Development Guide

Operational documentation for working on MixCraft. Companion to the root [README](../README.md); the four planning documents (`prd.md`, `architecture.md`, `design.md`, `file_structure.md`) remain the authoritative specifications.

## Local setup

```bash
pnpm install
cp .env.example .env
```

### Database

Integration tests and the login flow need a local PostgreSQL 16:

```bash
docker run --name mixcraft-pg -e POSTGRES_PASSWORD=mixcraft -e POSTGRES_DB=mixcraft -p 5432:5432 -d postgres:16-alpine
pnpm --filter @mixcraft/database db:generate   # generate the Prisma client
pnpm --filter @mixcraft/database db:migrate    # apply migrations
```

Useful database commands:

| Command                                        | Purpose                           |
| ---------------------------------------------- | --------------------------------- |
| `pnpm --filter @mixcraft/database db:generate` | Regenerate the Prisma client      |
| `pnpm --filter @mixcraft/database db:migrate`  | Create/apply migrations locally   |
| `pnpm --filter @mixcraft/database db:deploy`   | Apply migrations without creating |
| `pnpm --filter @mixcraft/database db:reset`    | Drop and recreate (local only)    |

Prisma 7 specifics: `prisma7.config.ts` loads `.env` via `process.loadEnvFile()`; the datasource block carries no `url` (connection string is passed at runtime to `createPrismaClient()` with the `@prisma/adapter-pg` driver adapter); the `prisma-client` generator writes to `packages/database/src/generated/` (git- and Prettier-ignored, regenerate after schema changes).

### Environment variables

`.env.example` documents every variable; production (`NODE_ENV=production`) enforces all of them at boot.

| Variable                                            | Default                 | Notes                                                                                                                                 |
| --------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                          | `development`           | `production` enables strict validation and `Secure` cookies                                                                           |
| `API_PORT` / `API_HOST`                             | `3001` / `127.0.0.1`    | API bind address                                                                                                                      |
| `WEB_ORIGIN`                                        | `http://localhost:5173` | Browser origin; redirect target after login and after connection callbacks, CORS/CSRF allowlist                                       |
| `API_BASE_URL`                                      | `http://127.0.0.1:3001` | Public API origin; OAuth `redirect_uri` and CSRF allowlist entry (required in production)                                             |
| `DATABASE_URL`                                      | —                       | PostgreSQL connection string (required in production)                                                                                 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`         | —                       | GitHub **login** OAuth app credentials (required in production)                                                                       |
| `GITHUB_APP_ID` / `GITHUB_APP_SLUG`                 | —                       | GitHub **App** used for provider connections; slug builds the install URL (required in production)                                    |
| `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` | —                       | GitHub App OAuth credentials for the install-flow token exchange (required in production)                                             |
| `GITHUB_APP_PRIVATE_KEY`                            | —                       | GitHub App private key (PEM) used to sign App JWTs for the installation API (required in production)                                  |
| `VERCEL_CLIENT_ID` / `VERCEL_CLIENT_SECRET`         | —                       | Vercel OAuth application for the connection flow (required in production)                                                             |
| `ENCRYPTION_KEY`                                    | —                       | 64 hex chars or base64 decoding to 32 bytes; encrypts the PKCE verifier and all provider credentials at rest (required in production) |
| `SESSION_IDLE_TTL_MINUTES`                          | `720`                   | Session idle timeout (must be ≤ absolute TTL)                                                                                         |
| `SESSION_ABSOLUTE_TTL_MINUTES`                      | `10080`                 | Session absolute lifetime                                                                                                             |
| `OAUTH_TRANSACTION_TTL_SECONDS`                     | `600`                   | Login **and** connection OAuth transaction lifetime (state hash, PKCE verifier, binding cookies), 60–3600 s                           |

A missing provider never fails boot: connections for an unconfigured provider answer `503 PROVIDER_UNAVAILABLE`, and `GET /api/connections` reports it in `configured`.

## Scripts

| Command          | Purpose                                                       |
| ---------------- | ------------------------------------------------------------- |
| `pnpm dev`       | Build shared + database packages, then watch-run web and API  |
| `pnpm build`     | Build all packages in dependency order                        |
| `pnpm typecheck` | Type-check every package                                      |
| `pnpm lint`      | ESLint on every package                                       |
| `pnpm test`      | Vitest across the workspace (`--passWithNoTests` where empty) |
| `pnpm format`    | Prettier write; `pnpm format:check` for CI-style verification |

Frontend runs on `http://localhost:5173` and proxies `/api` to `http://127.0.0.1:3001`.

## Tests

Vitest projects:

- Unit tests live next to scope: `apps/api/tests/unit/**` (env validation, encryption, CSRF, OAuth state, error mapping, auth service with a null database, GitHub App JWT/association helpers, Vercel PKCE exchange/refresh/revoke, npm whoami, connection config).
- Integration tests: `apps/api/tests/integration/**` run against the real local PostgreSQL container and **mocked provider HTTP layers** (`tests/helpers/github-mock.ts` for login; `tests/helpers/provider-mock.ts` for connections — GitHub token/installation/association/revoke, npm whoami, Vercel token/user/revoke). These are labelled mock-provider tests — they are not live GitHub/npm/Vercel traffic.
- `apps/api/tests/integration/connections/connections.test.ts` covers connect/refresh/disconnect for all three providers, encryption round-trips, callback binding/state/replay handling, ownership conflicts, unconfigured-provider `503`s, and the "no token in any response body" contract.
- Frontend unit tests: `apps/web/tests/features/**` (pure helpers: OAuth feedback parsing, error-message mapping, fetch wrappers with an injected `fetch`; no DOM/jsdom yet).
- Test environment comes from `apps/api/vitest.config.ts` (`NODE_ENV=test`, fixed test `ENCRYPTION_KEY`, fake GitHub App and Vercel client credentials, real `DATABASE_URL`).

Conventions:

- Integration tests create users with unique random `githubUserId`s and clean up their audit rows, user rows, and OAuth transactions; repeated runs are safe.
- Never use production credentials or fabricate provider responses in tests; the mock layer exists so live OAuth is not required in CI.
- The auth routes are rate-limited (30/min) and the global limiter is 600/min, so long test runs stay within budget.

## Stage 2 design notes

- **Error envelopes**: every failure responds `{ error: { code, message, requestId } }` with codes from `packages/shared`: `VALIDATION_FAILED` 400, `AUTHENTICATION_REQUIRED`/`CONNECTION_EXPIRED` 401, `PERMISSION_DENIED` 403, `RESOURCE_NOT_FOUND` 404, `OPERATION_CONFLICT` 409, `RATE_LIMITED` 429, `INTERNAL_ERROR` 500, `OUTCOME_UNKNOWN` 502, `PROVIDER_UNAVAILABLE`/`SERVICE_UNAVAILABLE` 503 (full map in `apps/api/src/types/api-error.ts`). The Fastify error handler maps Zod errors, Fastify 4xx/5xx, and unknown errors through one `statusForError()`.
- **Sessions**: opaque 32-byte secret cookie `mixcraft_session`; only `sha256(hex)` is stored. Idle expiry refreshes `last_seen_at` at most once a minute; absolute expiry is fixed at creation; revoked/idle-expired sessions are cleared from the cookie on detection.
- **OAuth transactions**: `state` is stored only as a hash; the PKCE verifier is encrypted with AES-256-GCM (`ENCRYPTION_KEY`); a binding cookie ties the callback to the initiating browser; consumption is atomic (`updateMany … consumedAt: null`) so replay yields 409.
- **CSRF**: double-submit cookie (`mixcraft_csrf`, deliberately not `HttpOnly`) compared to the `x-csrf-token` header using SHA-256 digests (timing-safe), plus an Origin allowlist check on every state-changing method. Future routes that verify signatures (webhooks) can opt out with `config: { skipCsrf: true }`.
- **Ordering**: callback input (query shape, binding, state) is validated before GitHub credentials are read, so untrusted input fails fast with a 4xx even when the server has no OAuth credentials configured.
- **Audit events** (`auth.login` success/failure, `auth.logout`) are written best-effort; an audit failure never invalidates a login or logout.
- **Logging**: pino redacts `req.headers.cookie`, `req.headers.authorization`, and `res.headers["set-cookie"]`.
- **GitHub tokens** from the **login** flow are still discarded after profile fetch; provider connection tokens live encrypted in `encrypted_credentials` (Stage 3).

## Stage 3 design notes — provider connections

- **Routes**: `GET /api/connections`, `POST /api/connections/npm`, `GET /api/connections/github/start|callback`, `GET /api/connections/vercel/start|callback`, `POST /api/connections/:provider/:connectionId/refresh`, `DELETE /api/connections/:provider/:connectionId` — registered in `app.ts`. `start`/`refresh`/`disconnect` are **additions beyond architecture.md §7** (which lists only list/connect/callback); they exist so the UI can manage connections without leaving server state behind.
- **Callback responses are 302 redirects**, not JSON: success → `${WEB_ORIGIN}/connections?provider=X&status=connected`, failure → `?provider=X&error=<CODE>`. An unauthenticated callback also redirects (`error=AUTHENTICATION_REQUIRED`) because the browser arrives from a provider round-trip. Errors are audited before redirecting.
- **OAuth state/binding**: connection callbacks accept either valid `state` **or** a matching binding cookie (GitHub's install flow can omit `state`); cookies are scoped to `/api/connections/github` or `/api/connections/vercel`, `HttpOnly`, `SameSite=Lax`, TTL from `OAUTH_TRANSACTION_TTL_SECONDS`. Replay is blocked twice: single-use transaction consume (409) and the `unique(userId, provider, providerAccountId)` constraint.
- **GitHub install flow**: the App must request OAuth tokens during installation (user-to-server). The callback exchanges the code **without** `redirect_uri`/PKCE, verifies the installation is associated with the authorizing user (`GET /user/installations/{id}/repositories`, 404 → `VALIDATION_FAILED`, missing row → `PERMISSION_DENIED`), and refuses suspended installations (`CONNECTION_EXPIRED` on refresh, `VALIDATION_FAILED` on connect).
- **Ownership**: `github_installations.installation_id` is globally unique — one GitHub installation maps to exactly one MixCraft account, so a second account connecting it gets `409 OPERATION_CONFLICT`.
- **Refresh semantics**: npm re-runs `/-/whoami`; GitHub re-fetches the installation (suspended → `expired`); Vercel uses the rotating refresh grant and re-encrypts the new token pair. Credential rejections mark the row `expired`, audit `connection.validate` failure, and return `401 CONNECTION_EXPIRED`.
- **Disconnect**: best-effort revocation first (GitHub `DELETE /applications/{id}/token`, Vercel `token/revoke`; npm has **no** server-side revoke — documented, users revoke at npmjs.com), then delete (credential cascades), then audit with `resourceType: provider_connection` + `resourceId` because `connectionId` no longer exists.
- **Frontend**: `apps/web/src/pages/ConnectionsPage.tsx` renders on `/connections` (no router yet — `App.tsx` switches on `location.pathname`). It only reads account names, scopes, statuses, and `configured` flags; the npm token field posts once and never echoes the token. OAuth feedback query params are parsed by pure helpers in `src/features/connections/feedback.ts`.

## Known limitations

- **No live provider credentials in this environment**: `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, the `GITHUB_APP_*` variables, and `VERCEL_CLIENT_*` are empty in the local `.env`, so login, connection starts, and callbacks answer `503 PROVIDER_UNAVAILABLE` by design. Every flow is covered by mock-provider tests instead; live verification is still pending and must not be assumed.
- **npm revocation**: the npm registry has no server-side token revoke API, so `DELETE /api/connections/npm/:id` removes MixCraft's stored copy (and audits `revoke: skipped`) while the token itself must be revoked at npmjs.com.
- `middleware/request-context.ts` and `plugins/observability.ts` are deferred to a later stage, as are `docs/security.md` and `docs/deployment.md`. ADRs `0002` and `0003` exist; `0001` (modular monolith) remains documented in `architecture.md`.
- No `prisma/seed.ts` yet: seeded provider data would be fabricated, which the planning documents forbid.

## Conventions

- TypeScript everywhere; shared validation via Zod contracts in `packages/shared`.
- Route modules follow `*.routes.ts`, services `*.service.ts`, tests `*.test.ts`.
- Do not edit the four root planning documents, commit secrets, or fabricate provider data.
- Regenerate the Prisma client after schema changes; never commit it.
