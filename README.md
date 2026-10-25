# MixCraft

Unified developer control center for GitHub, npm, and Vercel. MixCraft is a modular TypeScript monorepo: a React frontend, a Fastify API, shared contracts, a Prisma-backed database package, and provider adapters that keep every credential on the server.

This repository is currently at **Stage 3 — provider connections**: PostgreSQL schema, Prisma client, GitHub OAuth login with PKCE and server-side sessions, CSRF/Origin protection, normalized error envelopes, and GitHub App / npm / Vercel connection flows whose credentials stay encrypted on the server. Repository management and task orchestration arrive in later stages.

## Prerequisites

- Node.js `>= 22.12` (Node 24 recommended)
- pnpm via Corepack: `corepack enable && corepack prepare pnpm@latest --activate`
- Git
- Docker (PostgreSQL 16 for local development and integration tests)

## Setup

```bash
pnpm install
cp .env.example .env
docker run --name mixcraft-pg -e POSTGRES_PASSWORD=mixcraft -e POSTGRES_DB=mixcraft -p 5432:5432 -d postgres:16-alpine
pnpm --filter @mixcraft/database db:generate
pnpm --filter @mixcraft/database db:migrate
```

Fill `.env` as needed. Defaults work for local development (`API_PORT=3001`, web dev server on `5173`). See [docs/development.md](docs/development.md) for the full environment variable reference.

## Commands

| Command                                       | Purpose                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                                    | Build shared/database packages, then run web and API in watch mode |
| `pnpm build`                                  | Build all packages in dependency order                             |
| `pnpm typecheck`                              | Type-check every package                                           |
| `pnpm lint`                                   | Lint every package                                                 |
| `pnpm test`                                   | Run unit and integration tests (Vitest)                            |
| `pnpm format` / `pnpm format:check`           | Format the repository with Prettier                                |
| `pnpm --filter @mixcraft/database db:migrate` | Apply database migrations (local)                                  |
| `pnpm --filter @mixcraft/database db:deploy`  | Apply database migrations (production)                             |

Frontend: `http://localhost:5173` (proxies `/api` to the API). API health check: `http://127.0.0.1:3001/api/health`.

## Workspace layout

- `apps/web` — React + Vite frontend (Credential Constellation design system)
- `apps/api` — Fastify API: auth routes, session/CSRF middleware, error envelopes
- `packages/shared` — safe API contracts, provider identifiers, normalized error codes
- `packages/config` — shared TypeScript, ESLint, and Prettier configuration
- `packages/database` — Prisma schema, migrations, and generated client (PostgreSQL 16)
- `docs/development.md` — environment, scripts, tests, and Stage 3 conventions
- `docs/adr/` — architecture decision records (`0002` provider connections, `0003` credential storage; `0001` modular monolith stays in `architecture.md`)
- Four planning documents at the repository root are read-only specifications: `prd.md`, `architecture.md`, `design.md`, `file_structure.md`

## Authentication (Stage 2)

- `GET /api/auth/github` starts login: 302 to GitHub with PKCE (S256), `state`, and a browser binding cookie; **no OAuth scopes are requested**.
- `GET /api/auth/github/callback` validates binding cookie → state (single-use, atomic consume) → exchanges the code, upserts the user, issues an opaque session cookie, and clears the binding cookie.
- Sessions are opaque 32-byte secrets in the `mixcraft_session` cookie; only the SHA-256 hash is stored, with idle and absolute expiry.
- State-changing routes require a double-submit CSRF token (`mixcraft_csrf` cookie + `x-csrf-token` header) plus an Origin allowlist check.
- GitHub access tokens from the **login** flow are intentionally not persisted; provider connection tokens are stored encrypted at rest (see below).

## Provider connections (Stage 3)

- `GET /api/connections` — lists the caller's connections plus per-provider `configured` flags (`no-store`).
- `POST /api/connections/npm` — validates an npm granular access token against the registry, then stores it encrypted (`credentialKind: npm_token`).
- `GET /api/connections/github/start` — 302 to the GitHub App install page (`GITHUB_APP_SLUG`) with a scoped binding cookie.
- `GET /api/connections/github/callback` — single-use binding/state validation, user-token exchange, installation fetch, association check, ownership check, then an encrypted connection record. Answers with a 302 back to `/connections?provider=github&status=connected|error=<CODE>` (or `AUTHENTICATION_REQUIRED` if the session is missing).
- `GET /api/connections/vercel/start|callback` — standard OAuth 2.0 authorization-code flow with PKCE (S256) and rotating refresh tokens.
- `POST /api/connections/:provider/:connectionId/refresh` — revalidates the stored credential (npm whoami, GitHub installation status, Vercel refresh grant) and records an audit event; rejected credentials move the connection to `expired` and return `401 CONNECTION_EXPIRED`.
- `DELETE /api/connections/:provider/:connectionId` — best-effort remote revocation (GitHub token revoke, Vercel token revoke; npm has no server-side revoke), then deletes the row and cascades the encrypted credential.

All connection credentials are encrypted server-side with `ENCRYPTION_KEY`; responses, logs, and the frontend only ever contain account names, scopes, status, and timestamps. Connect/refresh/disconnect require a session plus the double-submit CSRF token; OAuth callbacks redirect instead of returning JSON so provider round-trips degrade honestly.

Configuration (all optional in development, required in production — a missing provider returns `503 PROVIDER_UNAVAILABLE` instead of failing boot):

| Variable                                                   | Purpose                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| `GITHUB_APP_ID` / `_SLUG`                                  | GitHub App identity for the install flow                   |
| `GITHUB_APP_CLIENT_ID` / `_CLIENT_SECRET` / `_PRIVATE_KEY` | GitHub App credentials (JWT-signed installation API calls) |
| `VERCEL_CLIENT_ID` / `_SECRET`                             | Vercel OAuth application                                   |
| `OAUTH_TRANSACTION_TTL_SECONDS`                            | Lifetime of single-use OAuth state/binding transactions    |

The GitHub App must be configured to **request an OAuth token during installation** (user-to-server). One installation belongs to exactly one MixCraft account: a second account connecting the same installation receives `409 OPERATION_CONFLICT`. npm tokens can only be revoked at npmjs.com, not from this server.

## Security notes

- Never commit `.env` or real credentials. `.env.example` holds empty placeholders only.
- Provider tokens must stay server-side; the frontend never receives them.
- Session cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production. The CSRF cookie is readable by the frontend by design.
- The API logs redact `cookie`, `authorization`, and `set-cookie` headers.
- High-impact operations require explicit confirmation (implemented in later stages).
- **Known limitation:** no live provider credentials exist in this environment (`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` and the GitHub App/Vercel variables are empty), so live GitHub OAuth and provider connections are untested here. The suites use mocked provider HTTP layers and are labelled accordingly.

## Conventions

- TypeScript everywhere; shared validation via Zod contracts in `packages/shared`
- Provider identifiers stay stable: `github`, `npm`, `vercel`
- Frontend must not import backend modules; shared packages must not import server secrets
- Do not fabricate provider data or success states
- Generated Prisma client output (`packages/database/src/generated/`) is git- and Prettier-ignored; regenerate with `pnpm --filter @mixcraft/database db:generate`
