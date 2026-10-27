import { createPrivateKey, sign } from "node:crypto";
import { GITHUB_OAUTH, githubAppInstallUrl } from "../../config/constants.js";
import { GitHubAppError } from "./github.errors.js";

const API_VERSION = "2022-11-28";
const JWT_VALIDITY_SECONDS = 540; // GitHub allows at most 10 minutes.

export interface GithubAppConfig {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
}

export interface GithubInstallationInfo {
  installationId: number;
  accountLogin: string;
  accountType: string;
  suspended: boolean;
  scopes: string[];
}

export interface GithubInstallationToken {
  token: string;
  expiresAt: string | null;
  permissions: Record<string, string>;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Builds the RS256 JWT GitHub App credentials are authenticated with
 * (iss = App ID, iat skewed back 60s for clock drift, exp within GitHub's 10m cap).
 */
export function buildAppJwt(config: GithubAppConfig, now: Date = new Date()): string {
  let key: ReturnType<typeof createPrivateKey>;
  try {
    key = createPrivateKey(config.privateKey);
  } catch {
    throw new GitHubAppError("jwt", "GitHub App private key could not be parsed.");
  }
  const issuedAt = Math.floor(now.getTime() / 1000) - 60;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: issuedAt, exp: issuedAt + JWT_VALIDITY_SECONDS, iss: config.appId }),
  );
  const signingInput = `${header}.${payload}`;
  let signature: Buffer;
  try {
    signature = sign("sha256", Buffer.from(signingInput, "utf8"), key);
  } catch {
    throw new GitHubAppError("jwt", "GitHub App JWT could not be signed.");
  }
  return `${signingInput}.${base64url(signature)}`;
}

export function buildInstallUrl(config: GithubAppConfig, state: string): string {
  const url = new URL(githubAppInstallUrl(config.slug));
  url.searchParams.set("state", state);
  return url.toString();
}

function appHeaders(jwt: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${jwt}`,
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "MixCraft-Dev",
  };
}

export async function fetchInstallation(
  config: GithubAppConfig,
  installationId: number,
  fetchImpl: typeof fetch,
): Promise<GithubInstallationInfo> {
  const jwt = buildAppJwt(config);
  let response: Response;
  try {
    response = await fetchImpl(
      `${GITHUB_OAUTH.apiUrl}/app/installations/${String(installationId)}`,
      { method: "GET", headers: appHeaders(jwt) },
    );
  } catch {
    throw new GitHubAppError("installation_fetch", "GitHub API is unreachable.", "network");
  }
  if (response.status === 404) {
    throw new GitHubAppError(
      "installation_fetch",
      "GitHub App installation was not found.",
      "not_found",
    );
  }
  if (response.status === 401) {
    throw new GitHubAppError("jwt", "GitHub rejected the App JWT.");
  }
  if (!response.ok) {
    throw new GitHubAppError("installation_fetch", "GitHub installation lookup failed.");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GitHubAppError("installation_fetch", "GitHub returned an unreadable response.");
  }
  if (typeof payload !== "object" || payload === null) {
    throw new GitHubAppError("installation_fetch", "GitHub returned an unexpected response.");
  }
  const { id, account, suspended_at, permissions } = payload as {
    id?: unknown;
    account?: { login?: unknown; type?: unknown } | null;
    suspended_at?: unknown;
    permissions?: unknown;
  };
  const login = account?.login;
  const type = account?.type;
  if (typeof id !== "number" || typeof login !== "string" || typeof type !== "string") {
    throw new GitHubAppError("installation_fetch", "GitHub returned an invalid installation.");
  }
  return {
    installationId: id,
    accountLogin: login,
    accountType: type,
    suspended: typeof suspended_at === "string" && suspended_at.length > 0,
    scopes: installationPermissionsToScopes(permissions),
  };
}

export async function createInstallationAccessToken(
  config: GithubAppConfig,
  installationId: number,
  fetchImpl: typeof fetch,
): Promise<GithubInstallationToken> {
  const jwt = buildAppJwt(config);
  let response: Response;
  try {
    response = await fetchImpl(
      `${GITHUB_OAUTH.apiUrl}/app/installations/${String(installationId)}/access_tokens`,
      { method: "POST", headers: appHeaders(jwt) },
    );
  } catch {
    throw new GitHubAppError("installation_token", "GitHub API is unreachable.", "network");
  }
  if (response.status === 404) {
    throw new GitHubAppError(
      "installation_token",
      "GitHub App installation was not found.",
      "not_found",
    );
  }
  if (response.status === 401) {
    throw new GitHubAppError("jwt", "GitHub rejected the App JWT.");
  }
  if (!response.ok) {
    throw new GitHubAppError("installation_token", "GitHub rejected the installation token request.");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GitHubAppError("installation_token", "GitHub returned an unreadable token response.");
  }
  if (typeof payload !== "object" || payload === null) {
    throw new GitHubAppError("installation_token", "GitHub returned an unexpected token response.");
  }
  const { token, expires_at, permissions } = payload as {
    token?: unknown;
    expires_at?: unknown;
    permissions?: unknown;
  };
  if (typeof token !== "string" || token.length === 0) {
    throw new GitHubAppError("installation_token", "GitHub did not return an installation token.");
  }
  const normalizedPermissions: Record<string, string> = {};
  if (typeof permissions === "object" && permissions !== null) {
    for (const [name, level] of Object.entries(permissions as Record<string, unknown>)) {
      if (typeof level === "string" && level.length > 0) {
        normalizedPermissions[name] = level;
      }
    }
  }
  return {
    token,
    expiresAt: typeof expires_at === "string" && expires_at.length > 0 ? expires_at : null,
    permissions: normalizedPermissions,
  };
}

/**
 * Verifies per GitHub's official recommendation that the installation belongs
 * to the authorizing user: a user-token request to
 * `GET /user/installations/{id}/repositories` returns 200 when associated and
 * 404 when not. The `installation_id` query parameter is spoofable, so this
 * check is mandatory before trusting it.
 */
export async function isInstallationAssociatedWithUser(
  userAccessToken: string,
  installationId: number,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${GITHUB_OAUTH.apiUrl}/user/installations/${String(installationId)}/repositories?per_page=1`,
      {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${userAccessToken}`,
          "X-GitHub-Api-Version": API_VERSION,
          "User-Agent": "MixCraft-Dev",
        },
      },
    );
  } catch {
    throw new GitHubAppError("association_check", "GitHub API is unreachable.", "network");
  }
  if (response.ok) {
    return true;
  }
  if (response.status === 404) {
    return false;
  }
  if (response.status === 401) {
    throw new GitHubAppError("association_check", "GitHub rejected the user access token.");
  }
  throw new GitHubAppError("association_check", "GitHub association check failed.");
}

/**
 * Best-effort revocation of the App's user access token on disconnect
 * (`DELETE /applications/{client_id}/token`). Local credentials are removed
 * regardless of this outcome.
 */
export async function revokeUserToken(
  config: Pick<GithubAppConfig, "clientId" | "clientSecret">,
  token: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetchImpl(`${GITHUB_OAUTH.apiUrl}/applications/${config.clientId}/token`, {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "MixCraft-Dev",
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      },
      body: JSON.stringify({ token }),
    });
  } catch {
    return false;
  }
  return response.ok;
}

/** Maps an installation's `permissions` object (e.g. `{contents:"read"}`) to scope strings. */
export function installationPermissionsToScopes(permissions: unknown): string[] {
  if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
    return [];
  }
  const scopes: string[] = [];
  for (const [name, level] of Object.entries(permissions as Record<string, unknown>)) {
    if (typeof level === "string" && level.length > 0) {
      scopes.push(`${name}:${level}`);
    }
  }
  return scopes.sort();
}
