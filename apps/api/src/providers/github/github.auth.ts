import { GITHUB_OAUTH } from "../../config/constants.js";
import { generatePkceChallenge } from "../../security/oauth-state.js";
import { GitHubAuthError } from "./github.errors.js";

// PKCE helper lives with the OAuth transaction utilities; re-exported here so
// existing callers keep their import path.
export { generatePkceChallenge };

export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(GITHUB_OAUTH.authorizeUrl);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // No `scope` parameter: Stage 2 login needs no GitHub permissions.
  return url.toString();
}

export interface GitHubUserProfile {
  githubUserId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export async function exchangeCodeForToken(params: {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  code: string;
  // Omitted for the GitHub App installation flow, where GitHub builds the
  // authorization redirect itself and no code_challenge can be supplied.
  codeVerifier?: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
  });
  if (params.redirectUri) {
    body.set("redirect_uri", params.redirectUri);
  }
  if (params.codeVerifier) {
    body.set("code_verifier", params.codeVerifier);
  }
  let response: Response;
  try {
    response = await params.fetchImpl(GITHUB_OAUTH.tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  } catch {
    throw new GitHubAuthError("token_exchange", "GitHub token endpoint is unreachable.");
  }
  if (!response.ok) {
    throw new GitHubAuthError("token_exchange", "GitHub rejected the authorization code.");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GitHubAuthError("token_exchange", "GitHub returned an unreadable token response.");
  }
  const token =
    typeof payload === "object" && payload !== null && "access_token" in payload
      ? (payload as { access_token?: unknown }).access_token
      : undefined;
  if (typeof token !== "string" || token.length === 0) {
    throw new GitHubAuthError("token_exchange", "GitHub did not return an access token.");
  }
  return token;
}

export async function fetchGitHubUser(
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<GitHubUserProfile> {
  let response: Response;
  try {
    response = await requestUserProfile(accessToken, fetchImpl);
  } catch {
    throw new GitHubAuthError("profile_fetch", "GitHub API is unreachable.");
  }
  if (!response.ok) {
    throw new GitHubAuthError("profile_fetch", "GitHub API rejected the access token.");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GitHubAuthError("profile_fetch", "GitHub API returned an unreadable response.");
  }
  if (typeof payload !== "object" || payload === null) {
    throw new GitHubAuthError("profile_fetch", "GitHub API returned an unexpected response.");
  }
  const { id, login, name, avatar_url } = payload as {
    id?: unknown;
    login?: unknown;
    name?: unknown;
    avatar_url?: unknown;
  };
  if (typeof id !== "number" || typeof login !== "string" || login.length === 0) {
    throw new GitHubAuthError("profile_fetch", "GitHub API returned an invalid user profile.");
  }
  return {
    githubUserId: String(id),
    login,
    name: typeof name === "string" && name.length > 0 ? name : null,
    avatarUrl: typeof avatar_url === "string" && avatar_url.length > 0 ? avatar_url : null,
  };
}

async function requestUserProfile(accessToken: string, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(`${GITHUB_OAUTH.apiUrl}/user`, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "MixCraft-Dev",
    },
  });
}
