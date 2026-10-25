import { GITHUB_OAUTH } from "../../src/config/constants.js";

export interface GitHubMockProfile {
  githubUserId: string;
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface GitHubMock {
  fetchImpl: typeof fetch;
  tokenRequests: URLSearchParams[];
  profileRequests: number;
  setTokenFailure(fail: boolean): void;
}

/**
 * Mocked GitHub OAuth + API endpoints for integration tests (architecture §15:
 * deterministic mocks, clearly labelled — no live provider calls in tests).
 */
export function createGitHubMock(profile: GitHubMockProfile): GitHubMock {
  const tokenRequests: URLSearchParams[] = [];
  let profileRequests = 0;
  let tokenFailure = false;

  const jsonResponse = (payload: unknown, status = 200): Response =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });

  const fetchImpl: typeof fetch = async (input, init) => {
    const raw =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw);

    if (`${url.origin}${url.pathname}` === GITHUB_OAUTH.tokenUrl) {
      tokenRequests.push(new URLSearchParams(String(init?.body ?? "")));
      if (tokenFailure) {
        // GitHub returns 200 with an error body for a bad verification code.
        return jsonResponse({ error: "bad_verification_code", error_description: "..." });
      }
      return jsonResponse({ access_token: "gho_mock_token", token_type: "bearer", scope: "" });
    }

    if (url.origin === "https://api.github.com" && url.pathname === "/user") {
      profileRequests += 1;
      const headers = (init?.headers ?? {}) as Record<string, unknown>;
      if (headers["Authorization"] !== "Bearer gho_mock_token") {
        return jsonResponse({ message: "Bad credentials" }, 401);
      }
      return jsonResponse({
        id: Number(profile.githubUserId),
        login: profile.login,
        name: profile.name ?? null,
        avatar_url: profile.avatarUrl ?? `https://avatars.example/${profile.login}.png`,
      });
    }

    throw new Error(`Unexpected outbound request in test: ${url.toString()}`);
  };

  return {
    fetchImpl,
    tokenRequests,
    get profileRequests() {
      return profileRequests;
    },
    setTokenFailure(fail: boolean) {
      tokenFailure = fail;
    },
  };
}
