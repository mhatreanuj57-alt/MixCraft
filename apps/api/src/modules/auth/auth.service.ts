import type { PrismaClient, User } from "@mixcraft/database";
import type { FastifyBaseLogger } from "fastify";
import { API_ROUTES } from "../../config/constants.js";
import { env } from "../../config/env.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchGitHubUser,
  generatePkceChallenge,
  type GitHubUserProfile,
} from "../../providers/github/github.auth.js";
import { GitHubAuthError } from "../../providers/github/github.errors.js";
import {
  consumeOauthTransaction,
  generateOauthTransaction,
  persistOauthTransaction,
} from "../../security/oauth-state.js";
import { generateCsrfToken } from "../../security/csrf.js";
import { ApiError } from "../../types/api-error.js";
import { recordAuditEvent } from "../audit/audit.service.js";
import { createSession, revokeSession, type CreatedSession } from "./session.service.js";

export interface AuthDeps {
  db: PrismaClient | null;
  fetchImpl: typeof fetch;
  log: FastifyBaseLogger;
  requestId: string;
}

export interface StartGithubLoginResult {
  authorizeUrl: string;
  binding: string;
}

export interface CompletedLoginResult {
  user: User;
  session: CreatedSession;
  csrfToken: string;
}

function requireEncryptionKey(): string {
  if (!env.ENCRYPTION_KEY) {
    throw new ApiError("SERVICE_UNAVAILABLE", "ENCRYPTION_KEY is not configured.");
  }
  return env.ENCRYPTION_KEY;
}

function requireDb(deps: AuthDeps): PrismaClient {
  if (!deps.db) {
    throw new ApiError("SERVICE_UNAVAILABLE", "Database is not configured.");
  }
  return deps.db;
}

function requireConfigured(deps: AuthDeps): PrismaClient {
  const db = requireDb(deps);
  requireEncryptionKey();
  return db;
}

function requireGitHubCredentials(): { clientId: string; clientSecret: string } {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    throw new ApiError("PROVIDER_UNAVAILABLE", "GitHub sign-in is not configured on this server.");
  }
  return { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET };
}

export async function startGithubLogin(deps: AuthDeps): Promise<StartGithubLoginResult> {
  const db = requireConfigured(deps);
  const { clientId } = requireGitHubCredentials();

  const transaction = generateOauthTransaction(env.OAUTH_TRANSACTION_TTL_SECONDS);
  await persistOauthTransaction(db, {
    provider: "github",
    encryptionKey: requireEncryptionKey(),
    transaction,
  });

  return {
    authorizeUrl: buildAuthorizeUrl({
      clientId,
      redirectUri: `${env.API_BASE_URL}${API_ROUTES.githubLoginCallback}`,
      state: transaction.state,
      codeChallenge: generatePkceChallenge(transaction.codeVerifier),
    }),
    binding: transaction.binding,
  };
}

export async function completeGithubLogin(
  deps: AuthDeps,
  input: { code: string; state: string; binding: string | undefined },
): Promise<CompletedLoginResult> {
  const db = requireConfigured(deps);

  const transaction = await consumeOauthTransaction(db, {
    state: input.state,
    binding: input.binding,
    encryptionKey: requireEncryptionKey(),
  });

  const { clientId, clientSecret } = requireGitHubCredentials();

  let accessToken: string;
  let profile: GitHubUserProfile;
  try {
    accessToken = await exchangeCodeForToken({
      clientId,
      clientSecret,
      redirectUri: `${env.API_BASE_URL}${API_ROUTES.githubLoginCallback}`,
      code: input.code,
      codeVerifier: transaction.codeVerifier,
      fetchImpl: deps.fetchImpl,
    });
    profile = await fetchGitHubUser(accessToken, deps.fetchImpl);
  } catch (error) {
    // The GitHub access token is intentionally not persisted in Stage 2;
    // token storage arrives with provider connections in a later stage.
    await safeAudit(db, deps, {
      action: "auth.login",
      outcome: "failure",
      metadata: {
        provider: "github",
        reason: error instanceof GitHubAuthError ? error.reason : "unknown",
      },
    });
    if (error instanceof GitHubAuthError) {
      throw new ApiError("PROVIDER_UNAVAILABLE", "GitHub sign-in could not be completed.");
    }
    throw error;
  }

  const now = new Date();
  const user = await db.user.upsert({
    where: { githubUserId: profile.githubUserId },
    update: {
      githubLogin: profile.login,
      displayName: profile.name,
      avatarUrl: profile.avatarUrl,
      lastLoginAt: now,
    },
    create: {
      githubUserId: profile.githubUserId,
      githubLogin: profile.login,
      displayName: profile.name,
      avatarUrl: profile.avatarUrl,
      lastLoginAt: now,
    },
  });

  const session = await createSession(db, user.id, {
    idleTtlMinutes: env.SESSION_IDLE_TTL_MINUTES,
    absoluteTtlMinutes: env.SESSION_ABSOLUTE_TTL_MINUTES,
    now,
  });

  await safeAudit(db, deps, {
    userId: user.id,
    action: "auth.login",
    outcome: "success",
    metadata: { provider: "github", githubLogin: profile.login },
  });

  return { user, session, csrfToken: generateCsrfToken() };
}

export async function performLogout(
  deps: AuthDeps,
  input: { sessionId: string; userId: string },
): Promise<void> {
  const db = requireDb(deps);
  await revokeSession(db, input.sessionId);
  await safeAudit(db, deps, {
    userId: input.userId,
    action: "auth.logout",
    outcome: "success",
  });
}

/**
 * Audit is best-effort: a transient audit failure must not invalidate an
 * otherwise completed login/logout.
 */
async function safeAudit(
  db: PrismaClient,
  deps: AuthDeps,
  input: Parameters<typeof recordAuditEvent>[1],
): Promise<void> {
  try {
    await recordAuditEvent(db, { ...input, requestId: deps.requestId });
  } catch (error) {
    deps.log.error({ err: error }, "failed to record audit event");
  }
}
