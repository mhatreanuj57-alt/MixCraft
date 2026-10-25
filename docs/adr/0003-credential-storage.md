# ADR 0003 — Credential storage and encryption

- Status: accepted (Stage 3)
- Date: 2026-10-25

## Context

Provider connections produce long-lived secrets (npm token, GitHub user token, Vercel access/refresh pair). `architecture.md` requires credentials to stay server-side, encrypted at rest, and never to appear in API responses, logs, or the frontend. `prd.md` forbids fabricating success when a provider or credential is missing.

## Decision

- **Dedicated `encrypted_credentials` table**, one row per connection (`connectionId @unique`, `ciphertext ByteA`, `iv`, `authTag`, `keyVersion`), `onDelete: Cascade` so disconnect deletes credentials with the connection. Raw tokens are never stored in `provider_connections`.
- **AES-256-GCM** via `connection.repository.ts` helpers (`encryptSecret`/`decryptSecret`), key from `ENCRYPTION_KEY` (64 hex chars or base64 → 32 bytes, validated in `env.ts`), random 12-byte IV per write, `keyVersion` reserved for rotation.
- **Kinds**: `npm_token` (raw secret), `github_user_token` (raw secret), `vercel_oauth_tokens` (JSON `{accessToken, refreshToken}` with `expiresAt` from `expires_in`).
- **Decrypt failure ⇒ `401 CONNECTION_EXPIRED`** (corrupt/unusable key material marks the connection unusable rather than logging secret material).
- **Plaintext only inside the service boundary**: `connection.service.ts` decrypts per operation (whoami, installation check, refresh), re-encrypts rotated Vercel tokens after refresh, and the serialization layer (`serializeConnection`) emits only `id, provider, status, providerAccountId, accountName, scopes, connectedAt, lastValidatedAt, expiresAt, configured`.
- **Audit before delete**: disconnect revokes remotely (best effort), deletes the connection (credentials cascade), then writes `audit_events` with `resourceType: provider_connection` + `resourceId` because `connectionId` no longer exists.

## Alternatives considered

- Store tokens in `provider_connections` columns — rejected; mixes metadata with secrets and complicates rotation.
- OS keychain / external KMS — rejected for this stage; single-server deploy target, no KMS in architecture.md. `keyVersion` keeps the migration path open.
- Encrypt only in the browser/session — rejected; refresh and validation happen server-side.

## Consequences

- Any response contract change must stay within `serializeConnection`; integration tests assert no token substring appears in any body.
- Rotating `ENCRYPTION_KEY` invalidates stored credentials (surfaced as `CONNECTION_EXPIRED`, user reconnects); re-encryption tooling is a future stage.
- Vercel refresh rotation re-encrypts on every refresh, so ciphertext changes are expected there.
- `.env` handling unchanged: never committed; `ENCRYPTION_KEY` required in production, fixed test key in `vitest.config.ts`.

## Migration

None required; schema from the initial migration already matches. Future key rotation would use `keyVersion` plus a re-encrypt job (later stage).
