import type { ConnectionRecord, ConnectionsListPayload } from "@mixcraft/shared";
import type { PrismaClient, Provider, ProviderConnection } from "@mixcraft/database";
import type { FastifyBaseLogger } from "fastify";
import { API_ROUTES, CONNECTION_AUDIT_ACTIONS, VERCEL_OAUTH } from "../../config/constants.js";
import { env } from "../../config/env.js";
import {
  buildInstallUrl,
  fetchInstallation,
  isInstallationAssociatedWithUser,
  revokeUserToken,
  type GithubAppConfig,
  type GithubInstallationInfo,
} from "../../providers/github/github.app.js";
import {
  exchangeCodeForToken,
  fetchGitHubUser,
  type GitHubUserProfile,
} from "../../providers/github/github.auth.js";
import { GitHubAppError, GitHubAuthError } from "../../providers/github/github.errors.js";
import { verifyNpmToken } from "../../providers/npm/npm.client.js";
import { NpmClientError } from "../../providers/npm/npm.errors.js";
import {
  buildVercelAuthorizeUrl,
  exchangeVercelCode,
  fetchVercelUser,
  refreshVercelToken,
  revokeVercelToken,
  type VercelTokenSet,
  type VercelUserProfile,
} from "../../providers/vercel/vercel.auth.js";
import { VercelAuthError } from "../../providers/vercel/vercel.errors.js";
import { decodeEncryptionKey, decryptSecret, encryptSecret } from "../../security/encryption.js";
import {
  consumeOauthTransaction,
  consumeOauthTransactionByBinding,
  generateOauthTransaction,
  generatePkceChallenge,
  persistOauthTransaction,
} from "../../security/oauth-state.js";
import { ApiError } from "../../types/api-error.js";
import { recordAuditEvent, type AuditInput } from "../audit/audit.service.js";
import {
  deleteConnection,
  findCredential,
  findGithubInstallationByInstallationId,
  findGithubInstallationForConnection,
  findOwnedConnection,
  listUserConnections,
  markConnectionExpired,
  markConnectionValidated,
  replaceCredential,
  upsertConnectionWithCredential,
  upsertGithubInstallation,
} from "./connection.repository.js";
import type { ConnectionsConfig, VercelAppConfig } from "./connection.config.js";

export interface ConnectionDeps {
  db: PrismaClient | null;
  fetchImpl: typeof fetch;
  log: FastifyBaseLogger;
  requestId: string;
  config: ConnectionsConfig;
}

export interface StartOAuthConnectResult {
  authorizeUrl: string;
  binding: string;
}

const GITHUB_APP_TOKEN_KIND = "github_user_token";
const NPM_TOKEN_KIND = "npm_token";
const VERCEL_TOKEN_KIND = "vercel_oauth_tokens";

function requireDb(deps: ConnectionDeps): PrismaClient {
  if (!deps.db) {
    throw new ApiError("SERVICE_UNAVAILABLE", "Database is not configured.");
  }
  return deps.db;
}

function requireEncryptionKey(): string {
  if (!env.ENCRYPTION_KEY) {
    throw new ApiError("SERVICE_UNAVAILABLE", "ENCRYPTION_KEY is not configured.");
  }
  return env.ENCRYPTION_KEY;
}

function requireGithubApp(deps: ConnectionDeps): GithubAppConfig {
  if (!deps.config.githubApp) {
    throw new ApiError("PROVIDER_UNAVAILABLE", "GitHub App connections are not configured.");
  }
  return deps.config.githubApp;
}

function requireVercel(deps: ConnectionDeps): VercelAppConfig {
  if (!deps.config.vercel) {
    throw new ApiError("PROVIDER_UNAVAILABLE", "Vercel connections are not configured.");
  }
  return deps.config.vercel;
}

function toConnectionRecord(row: ProviderConnection): ConnectionRecord {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    accountName: row.providerAccountName,
    lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

interface CredentialRead {
  found: true;
  kind: string;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  authenticationTag: Uint8Array;
  expiresAt: Date | null;
}

function decryptCredential(credential: CredentialRead, encryptionKey: string): string {
  try {
    return decryptSecret(
      {
        ciphertext: Buffer.from(credential.ciphertext),
        nonce: Buffer.from(credential.nonce),
        authenticationTag: Buffer.from(credential.authenticationTag),
      },
      decodeEncryptionKey(encryptionKey),
    );
  } catch {
    // Key rotation or corrupt ciphertext: the user must reconnect the provider.
    throw new ApiError(
      "CONNECTION_EXPIRED",
      "Stored credentials could not be read; reconnect the provider.",
    );
  }
}

function encryptCredentialPayload(
  plaintext: string,
  encryptionKey: string,
  kind: string,
  expiresAt: Date | null,
): {
  credentialKind: string;
  ciphertext: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  authenticationTag: Uint8Array<ArrayBuffer>;
  expiresAt: Date | null;
} {
  const envelope = encryptSecret(plaintext, decodeEncryptionKey(encryptionKey));
  return {
    credentialKind: kind,
    ciphertext: new Uint8Array(envelope.ciphertext),
    nonce: new Uint8Array(envelope.nonce),
    authenticationTag: new Uint8Array(envelope.authenticationTag),
    expiresAt,
  };
}

interface VercelStoredTokens {
  accessToken: string;
  refreshToken: string | null;
}

function parseVercelStoredTokens(raw: string): VercelStoredTokens | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const { accessToken, refreshToken } = parsed as {
      accessToken?: unknown;
      refreshToken?: unknown;
    };
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      return null;
    }
    return {
      accessToken,
      refreshToken:
        typeof refreshToken === "string" && refreshToken.length > 0 ? refreshToken : null,
    };
  } catch {
    return null;
  }
}

interface ClassifiedFailure {
  apiError: ApiError | null;
  credentialRejected: boolean;
  reason: string;
}

/**
 * Maps provider-layer failures onto the shared error contract without leaking
 * provider payloads. `credentialRejected` drives marking a connection `expired`
 * on refresh (the stored credential, not the provider, must be replaced).
 */
function classifyFailure(error: unknown, action: "connect" | "refresh"): ClassifiedFailure {
  if (error instanceof ApiError) {
    return {
      apiError: error,
      credentialRejected: error.code === "CONNECTION_EXPIRED",
      reason: error.code.toLowerCase(),
    };
  }
  if (error instanceof NpmClientError) {
    if (error.reason === "unreachable") {
      return {
        apiError: new ApiError("PROVIDER_UNAVAILABLE", "npm registry is unavailable right now."),
        credentialRejected: false,
        reason: error.reason,
      };
    }
    return {
      apiError:
        action === "connect"
          ? new ApiError("VALIDATION_FAILED", "npm rejected the provided access token.")
          : new ApiError("CONNECTION_EXPIRED", "The stored npm token is no longer valid."),
      credentialRejected: true,
      reason: error.reason,
    };
  }
  if (error instanceof GitHubAppError) {
    if (error.kind === "network") {
      return {
        apiError: new ApiError("PROVIDER_UNAVAILABLE", "GitHub is unavailable right now."),
        credentialRejected: false,
        reason: error.reason,
      };
    }
    if (error.kind === "not_found") {
      return {
        apiError:
          action === "connect"
            ? new ApiError(
                "VALIDATION_FAILED",
                "The GitHub App installation is unavailable (missing or suspended).",
              )
            : new ApiError(
                "CONNECTION_EXPIRED",
                "The GitHub App installation is no longer available.",
              ),
        credentialRejected: true,
        reason: error.reason,
      };
    }
    return {
      apiError: new ApiError("PROVIDER_UNAVAILABLE", "GitHub rejected the App credentials."),
      credentialRejected: false,
      reason: error.reason,
    };
  }
  if (error instanceof GitHubAuthError) {
    return {
      apiError: new ApiError("PROVIDER_UNAVAILABLE", "GitHub sign-in could not be completed."),
      credentialRejected: false,
      reason: error.reason,
    };
  }
  if (error instanceof VercelAuthError) {
    if (error.kind === "network") {
      return {
        apiError: new ApiError("PROVIDER_UNAVAILABLE", "Vercel is unavailable right now."),
        credentialRejected: false,
        reason: error.reason,
      };
    }
    return {
      apiError:
        action === "connect"
          ? new ApiError("PROVIDER_UNAVAILABLE", "Vercel rejected the authorization request.")
          : new ApiError(
              "CONNECTION_EXPIRED",
              "The stored Vercel credentials are no longer valid.",
            ),
      credentialRejected: true,
      reason: error.reason,
    };
  }
  return { apiError: null, credentialRejected: false, reason: "unknown" };
}

function rethrowProviderFailure(error: unknown, action: "connect" | "refresh"): never {
  const failure = classifyFailure(error, action);
  if (failure.apiError) {
    throw failure.apiError;
  }
  throw error;
}

/** Audit is best-effort: a transient audit failure never invalidates a completed operation. */
async function safeAudit(db: PrismaClient, deps: ConnectionDeps, input: AuditInput): Promise<void> {
  try {
    await recordAuditEvent(db, { ...input, requestId: deps.requestId });
  } catch (error) {
    deps.log.error({ err: error }, "failed to record audit event");
  }
}

export async function listConnections(
  deps: ConnectionDeps,
  userId: string,
): Promise<ConnectionsListPayload> {
  const db = requireDb(deps);
  const rows = await listUserConnections(db, userId);
  return {
    connections: rows.map(toConnectionRecord),
    configured: {
      github: deps.config.githubApp !== null,
      npm: true,
      vercel: deps.config.vercel !== null,
    },
  };
}

export async function connectNpm(
  deps: ConnectionDeps,
  input: { userId: string; token: string },
): Promise<ConnectionRecord> {
  const db = requireDb(deps);
  const encryptionKey = requireEncryptionKey();

  let username: string;
  try {
    const identity = await verifyNpmToken(input.token, deps.fetchImpl);
    username = identity.username;
  } catch (error) {
    const failure = classifyFailure(error, "connect");
    await safeAudit(db, deps, {
      userId: input.userId,
      action: CONNECTION_AUDIT_ACTIONS.connect,
      outcome: "failure",
      metadata: { provider: "npm", reason: failure.reason },
    });
    rethrowProviderFailure(error, "connect");
  }

  const now = new Date();
  const connection = await upsertConnectionWithCredential(db, {
    userId: input.userId,
    provider: "npm",
    providerAccountId: username,
    providerAccountName: username,
    scopes: [],
    lastValidatedAt: now,
    credential: encryptCredentialPayload(input.token, encryptionKey, NPM_TOKEN_KIND, null),
  });

  await safeAudit(db, deps, {
    userId: input.userId,
    connectionId: connection.id,
    action: CONNECTION_AUDIT_ACTIONS.connect,
    outcome: "success",
    metadata: { provider: "npm", accountName: username },
  });
  return toConnectionRecord(connection);
}

export async function startGithubConnect(deps: ConnectionDeps): Promise<StartOAuthConnectResult> {
  const db = requireDb(deps);
  const encryptionKey = requireEncryptionKey();
  const app = requireGithubApp(deps);

  const transaction = generateOauthTransaction(env.OAUTH_TRANSACTION_TTL_SECONDS);
  await persistOauthTransaction(db, {
    provider: "github",
    encryptionKey,
    transaction,
  });
  return {
    authorizeUrl: buildInstallUrl(app, transaction.state),
    binding: transaction.binding,
  };
}

export async function completeGithubConnect(
  deps: ConnectionDeps,
  input: {
    userId: string;
    code: string;
    state: string | undefined;
    binding: string | undefined;
    installationId: number | undefined;
    setupAction: string | undefined;
  },
): Promise<ConnectionRecord> {
  const db = requireDb(deps);
  const encryptionKey = requireEncryptionKey();
  const app = requireGithubApp(deps);

  await consumeOauthTransactionByBinding(db, {
    binding: input.binding,
    state: input.state,
    provider: "github",
    encryptionKey,
  });

  // Org installs can land here pending approval (`setup_action=request`): the
  // installation id and user code only arrive once an admin approves.
  if (input.setupAction === "request") {
    throw new ApiError(
      "VALIDATION_FAILED",
      "This GitHub App installation is awaiting organization approval.",
    );
  }
  if (input.installationId === undefined) {
    throw new ApiError("VALIDATION_FAILED", "GitHub did not report an installation.");
  }

  let userToken: string;
  let profile: GitHubUserProfile;
  let installation: GithubInstallationInfo;
  try {
    // The installation flow builds its own authorize request, so no
    // PKCE verifier or redirect_uri can be supplied here.
    userToken = await exchangeCodeForToken({
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      code: input.code,
      fetchImpl: deps.fetchImpl,
    });
    profile = await fetchGitHubUser(userToken, deps.fetchImpl);
    installation = await fetchInstallation(app, input.installationId, deps.fetchImpl);
    if (installation.suspended) {
      throw new GitHubAppError(
        "installation_fetch",
        "The GitHub App installation is suspended.",
        "not_found",
      );
    }
    if (
      !(await isInstallationAssociatedWithUser(userToken, input.installationId, deps.fetchImpl))
    ) {
      throw new ApiError(
        "PERMISSION_DENIED",
        "The GitHub App installation is not associated with your GitHub account.",
      );
    }
  } catch (error) {
    const failure = classifyFailure(error, "connect");
    await safeAudit(db, deps, {
      userId: input.userId,
      action: CONNECTION_AUDIT_ACTIONS.connect,
      outcome: "failure",
      metadata: {
        provider: "github",
        reason: failure.reason,
        installationId: String(input.installationId),
      },
    });
    rethrowProviderFailure(error, "connect");
  }

  const existingInstallation = await findGithubInstallationByInstallationId(
    db,
    BigInt(input.installationId),
  );
  if (existingInstallation && existingInstallation.connection.userId !== input.userId) {
    await safeAudit(db, deps, {
      userId: input.userId,
      action: CONNECTION_AUDIT_ACTIONS.connect,
      outcome: "failure",
      metadata: { provider: "github", reason: "installation_owned_by_other_account" },
    });
    throw new ApiError(
      "OPERATION_CONFLICT",
      "That GitHub App installation is connected by another account.",
    );
  }

  const now = new Date();
  const connection = await upsertConnectionWithCredential(db, {
    userId: input.userId,
    provider: "github",
    providerAccountId: String(installation.installationId),
    providerAccountName: installation.accountLogin,
    scopes: installation.scopes,
    lastValidatedAt: now,
    credential: encryptCredentialPayload(userToken, encryptionKey, GITHUB_APP_TOKEN_KIND, null),
  });
  try {
    await upsertGithubInstallation(db, {
      connectionId: connection.id,
      installationId: BigInt(installation.installationId),
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      await safeAudit(db, deps, {
        userId: input.userId,
        action: CONNECTION_AUDIT_ACTIONS.connect,
        outcome: "failure",
        metadata: { provider: "github", reason: "installation_owned_by_other_account" },
      });
    }
    throw error;
  }

  await safeAudit(db, deps, {
    userId: input.userId,
    connectionId: connection.id,
    action: CONNECTION_AUDIT_ACTIONS.connect,
    outcome: "success",
    metadata: {
      provider: "github",
      accountName: installation.accountLogin,
      installer: profile.login,
    },
  });
  return toConnectionRecord(connection);
}

export async function startVercelConnect(deps: ConnectionDeps): Promise<StartOAuthConnectResult> {
  const db = requireDb(deps);
  const encryptionKey = requireEncryptionKey();
  const vercel = requireVercel(deps);

  const transaction = generateOauthTransaction(env.OAUTH_TRANSACTION_TTL_SECONDS);
  await persistOauthTransaction(db, {
    provider: "vercel",
    encryptionKey,
    transaction,
  });
  return {
    authorizeUrl: buildVercelAuthorizeUrl({
      clientId: vercel.clientId,
      redirectUri: `${env.API_BASE_URL}${API_ROUTES.vercelConnectCallback}`,
      state: transaction.state,
      codeChallenge: generatePkceChallenge(transaction.codeVerifier),
    }),
    binding: transaction.binding,
  };
}

export async function completeVercelConnect(
  deps: ConnectionDeps,
  input: { userId: string; code: string; state: string; binding: string | undefined },
): Promise<ConnectionRecord> {
  const db = requireDb(deps);
  const encryptionKey = requireEncryptionKey();
  const vercel = requireVercel(deps);

  const transaction = await consumeOauthTransaction(db, {
    state: input.state,
    binding: input.binding,
    encryptionKey,
  });

  let tokens: VercelTokenSet;
  let profile: VercelUserProfile;
  try {
    tokens = await exchangeVercelCode({
      clientId: vercel.clientId,
      clientSecret: vercel.clientSecret,
      redirectUri: `${env.API_BASE_URL}${API_ROUTES.vercelConnectCallback}`,
      code: input.code,
      codeVerifier: transaction.codeVerifier,
      fetchImpl: deps.fetchImpl,
    });
    profile = await fetchVercelUser(tokens.accessToken, deps.fetchImpl);
  } catch (error) {
    const failure = classifyFailure(error, "connect");
    await safeAudit(db, deps, {
      userId: input.userId,
      action: CONNECTION_AUDIT_ACTIONS.connect,
      outcome: "failure",
      metadata: { provider: "vercel", reason: failure.reason },
    });
    rethrowProviderFailure(error, "connect");
  }

  const now = new Date();
  const credentialPayload = JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
  const connection = await upsertConnectionWithCredential(db, {
    userId: input.userId,
    provider: "vercel",
    providerAccountId: profile.providerAccountId,
    providerAccountName: profile.accountName,
    scopes: [...VERCEL_OAUTH.scopes],
    lastValidatedAt: now,
    credential: encryptCredentialPayload(
      credentialPayload,
      encryptionKey,
      VERCEL_TOKEN_KIND,
      tokens.expiresIn === null ? null : new Date(now.getTime() + tokens.expiresIn * 1000),
    ),
  });

  await safeAudit(db, deps, {
    userId: input.userId,
    connectionId: connection.id,
    action: CONNECTION_AUDIT_ACTIONS.connect,
    outcome: "success",
    metadata: { provider: "vercel", accountName: profile.accountName },
  });
  return toConnectionRecord(connection);
}

export async function refreshConnection(
  deps: ConnectionDeps,
  input: { userId: string; provider: Provider; connectionId: string },
): Promise<ConnectionRecord> {
  const db = requireDb(deps);
  const encryptionKey = requireEncryptionKey();

  const connection = await findOwnedConnection(db, {
    userId: input.userId,
    provider: input.provider,
    connectionId: input.connectionId,
  });
  if (!connection) {
    throw new ApiError("RESOURCE_NOT_FOUND", "Connection not found.");
  }

  const now = new Date();
  try {
    if (input.provider === "npm") {
      const credential = await findCredential(db, connection.id);
      if (!credential.found) {
        throw new ApiError("CONNECTION_EXPIRED", "No stored npm credential exists.");
      }
      const token = decryptCredential(credential, encryptionKey);
      const { username } = await verifyNpmToken(token, deps.fetchImpl);
      const updated = await markConnectionValidated(db, {
        connectionId: connection.id,
        now,
        accountName: username,
      });
      await safeAudit(db, deps, {
        userId: input.userId,
        connectionId: connection.id,
        action: CONNECTION_AUDIT_ACTIONS.validate,
        outcome: "success",
        metadata: { provider: "npm" },
      });
      return toConnectionRecord(updated);
    }

    if (input.provider === "github") {
      const app = requireGithubApp(deps);
      const installation = await findGithubInstallationForConnection(db, connection.id);
      if (!installation) {
        throw new ApiError("CONNECTION_EXPIRED", "No GitHub App installation is recorded.");
      }
      const info = await fetchInstallation(
        app,
        Number(installation.installationId),
        deps.fetchImpl,
      );
      if (info.suspended) {
        throw new GitHubAppError(
          "installation_fetch",
          "The GitHub App installation is suspended.",
          "not_found",
        );
      }
      const updated = await markConnectionValidated(db, {
        connectionId: connection.id,
        now,
        scopes: info.scopes,
        accountName: info.accountLogin,
      });
      await safeAudit(db, deps, {
        userId: input.userId,
        connectionId: connection.id,
        action: CONNECTION_AUDIT_ACTIONS.validate,
        outcome: "success",
        metadata: { provider: "github" },
      });
      return toConnectionRecord(updated);
    }

    const vercel = requireVercel(deps);
    const credential = await findCredential(db, connection.id);
    if (!credential.found) {
      throw new ApiError("CONNECTION_EXPIRED", "No stored Vercel credential exists.");
    }
    const stored = parseVercelStoredTokens(decryptCredential(credential, encryptionKey));
    if (!stored) {
      throw new ApiError(
        "CONNECTION_EXPIRED",
        "Stored Vercel credentials could not be read; reconnect.",
      );
    }
    if (!stored.refreshToken) {
      throw new ApiError(
        "CONNECTION_EXPIRED",
        "No Vercel refresh token is stored; reconnect to continue.",
      );
    }
    const next = await refreshVercelToken({
      clientId: vercel.clientId,
      clientSecret: vercel.clientSecret,
      refreshToken: stored.refreshToken,
      fetchImpl: deps.fetchImpl,
    });
    // Vercel rotates refresh tokens: the stored blob must be replaced in full.
    await replaceCredential(
      db,
      connection.id,
      encryptCredentialPayload(
        JSON.stringify({
          accessToken: next.accessToken,
          refreshToken: next.refreshToken ?? stored.refreshToken,
        }),
        encryptionKey,
        VERCEL_TOKEN_KIND,
        next.expiresIn === null ? null : new Date(now.getTime() + next.expiresIn * 1000),
      ),
    );
    const updated = await markConnectionValidated(db, { connectionId: connection.id, now });
    await safeAudit(db, deps, {
      userId: input.userId,
      connectionId: connection.id,
      action: CONNECTION_AUDIT_ACTIONS.validate,
      outcome: "success",
      metadata: { provider: "vercel" },
    });
    return toConnectionRecord(updated);
  } catch (error) {
    const failure = classifyFailure(error, "refresh");
    if (failure.credentialRejected) {
      try {
        await markConnectionExpired(db, connection.id, new Date());
      } catch (updateError) {
        deps.log.error({ err: updateError }, "failed to mark connection expired");
      }
    }
    await safeAudit(db, deps, {
      userId: input.userId,
      connectionId: connection.id,
      action: CONNECTION_AUDIT_ACTIONS.validate,
      outcome: "failure",
      metadata: { provider: input.provider, reason: failure.reason },
    });
    throw failure.apiError ?? error;
  }
}

export async function disconnectConnection(
  deps: ConnectionDeps,
  input: { userId: string; provider: Provider; connectionId: string },
): Promise<{ disconnected: true }> {
  const db = requireDb(deps);
  const encryptionKey = requireEncryptionKey();

  const connection = await findOwnedConnection(db, {
    userId: input.userId,
    provider: input.provider,
    connectionId: input.connectionId,
  });
  if (!connection) {
    throw new ApiError("RESOURCE_NOT_FOUND", "Connection not found.");
  }

  // Best-effort remote revocation; local credentials are removed regardless
  // (npm exposes no revocation API — revoke at npmjs.com instead).
  let revokeOutcome: "ok" | "failed" | "skipped" = "skipped";
  const credential = await findCredential(db, connection.id);
  if (credential.found) {
    try {
      const secret = decryptCredential(credential, encryptionKey);
      if (connection.provider === "github" && deps.config.githubApp) {
        revokeOutcome = (await revokeUserToken(deps.config.githubApp, secret, deps.fetchImpl))
          ? "ok"
          : "failed";
      } else if (connection.provider === "vercel" && deps.config.vercel) {
        const stored = parseVercelStoredTokens(secret);
        if (stored) {
          revokeOutcome = (await revokeVercelToken({
            clientId: deps.config.vercel.clientId,
            clientSecret: deps.config.vercel.clientSecret,
            token: stored.accessToken,
            fetchImpl: deps.fetchImpl,
          }))
            ? "ok"
            : "failed";
        }
      }
    } catch {
      revokeOutcome = "failed";
    }
  }

  await deleteConnection(db, connection.id);
  // The row is gone, so the audit event references it via resource id only.
  await safeAudit(db, deps, {
    userId: input.userId,
    action: CONNECTION_AUDIT_ACTIONS.disconnect,
    outcome: "success",
    resourceType: "provider_connection",
    resourceId: connection.id,
    metadata: { provider: input.provider, revoke: revokeOutcome },
  });
  return { disconnected: true };
}
