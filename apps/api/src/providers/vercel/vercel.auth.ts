import { VERCEL_OAUTH } from "../../config/constants.js";
import { VercelAuthError } from "./vercel.errors.js";

export interface VercelTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
}

export function buildVercelAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(VERCEL_OAUTH.authorizeUrl);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", VERCEL_OAUTH.scopes.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function requestTokenSet(
  body: URLSearchParams,
  fetchImpl: typeof fetch,
  reason: "token_exchange" | "refresh",
): Promise<VercelTokenSet> {
  let response: Response;
  try {
    response = await fetchImpl(VERCEL_OAUTH.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
  } catch {
    throw new VercelAuthError(reason, "Vercel token endpoint is unreachable.", "network");
  }
  if (!response.ok) {
    throw new VercelAuthError(reason, "Vercel rejected the token request.");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new VercelAuthError(reason, "Vercel returned an unreadable token response.");
  }
  if (typeof payload !== "object" || payload === null) {
    throw new VercelAuthError(reason, "Vercel returned an unexpected token response.");
  }
  const { access_token, refresh_token, expires_in } = payload as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof access_token !== "string" || access_token.length === 0) {
    throw new VercelAuthError(reason, "Vercel did not return an access token.");
  }
  return {
    accessToken: access_token,
    refreshToken:
      typeof refresh_token === "string" && refresh_token.length > 0 ? refresh_token : null,
    expiresIn: typeof expires_in === "number" && expires_in > 0 ? expires_in : null,
  };
}

export async function exchangeVercelCode(params: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  fetchImpl: typeof fetch;
}): Promise<VercelTokenSet> {
  return requestTokenSet(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      code: params.code,
      code_verifier: params.codeVerifier,
    }),
    params.fetchImpl,
    "token_exchange",
  );
}

/**
 * Vercel issues rotating refresh tokens: every refresh returns a new
 * refresh_token and invalidates the previous one, so the stored blob must be
 * replaced after each successful refresh.
 */
export async function refreshVercelToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl: typeof fetch;
}): Promise<VercelTokenSet> {
  return requestTokenSet(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: params.clientId,
      client_secret: params.clientSecret,
      refresh_token: params.refreshToken,
    }),
    params.fetchImpl,
    "refresh",
  );
}

/** Best-effort revocation on disconnect; local credentials are removed regardless. */
export async function revokeVercelToken(params: {
  clientId: string;
  clientSecret: string;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<boolean> {
  let response: Response;
  try {
    response = await params.fetchImpl(VERCEL_OAUTH.revokeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${params.clientId}:${params.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ token: params.token }).toString(),
    });
  } catch {
    return false;
  }
  return response.ok;
}

export interface VercelUserProfile {
  providerAccountId: string;
  accountName: string;
}

export async function fetchVercelUser(
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<VercelUserProfile> {
  let response: Response;
  try {
    response = await fetchImpl(VERCEL_OAUTH.userUrl, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new VercelAuthError("profile_fetch", "Vercel API is unreachable.", "network");
  }
  if (response.status === 401 || response.status === 403) {
    throw new VercelAuthError("profile_fetch", "Vercel rejected the access token.");
  }
  if (!response.ok) {
    throw new VercelAuthError("profile_fetch", "Vercel profile lookup failed.");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new VercelAuthError("profile_fetch", "Vercel returned an unreadable response.");
  }
  if (typeof payload !== "object" || payload === null) {
    throw new VercelAuthError("profile_fetch", "Vercel returned an unexpected response.");
  }
  // `/v2/user` wraps the profile in `user`; accept a flat shape as well.
  const raw = payload as Record<string, unknown>;
  const nested = typeof raw.user === "object" && raw.user !== null ? raw.user : null;
  const user = (nested ?? raw) as Record<string, unknown>;
  const uid = user.uid ?? user.id;
  if (typeof uid !== "number" && (typeof uid !== "string" || uid.length === 0)) {
    throw new VercelAuthError("profile_fetch", "Vercel returned an invalid user profile.");
  }
  const candidates = [user.username, user.email, user.name];
  const accountName = candidates.find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (!accountName) {
    throw new VercelAuthError("profile_fetch", "Vercel returned an unnamed account.");
  }
  return { providerAccountId: String(uid), accountName };
}
