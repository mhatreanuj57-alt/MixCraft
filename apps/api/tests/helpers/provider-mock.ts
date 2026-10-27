import { GITHUB_OAUTH, NPM_REGISTRY, VERCEL_OAUTH } from "../../src/config/constants.js";

export type MockMode = "ok" | "fail" | "unreachable";

export interface ProviderMockCall {
  kind:
    | "github_token"
    | "github_user"
    | "github_installation"
    | "github_installation_token"
    | "github_repositories"
    | "github_commits"
    | "github_graphql"
    | "github_association"
    | "github_revoke"
    | "npm_whoami"
    | "vercel_token"
    | "vercel_user"
    | "vercel_revoke";
  detail?: string;
}

/**
 * Deterministic mock of every provider endpoint Stage 3 calls (architecture
 * §15: tests never touch live providers). Controls are plain fields tests
 * flip between cases.
 */
export function createProviderMock() {
  let vercelTokenCounter = 0;
  const calls: ProviderMockCall[] = [];

  const state = {
    githubUser: { id: "9100000001", login: "conn-user-a", name: "Connection User A" },
    npmUsername: "acme-publisher",
    npmMode: "ok" as MockMode,
    githubTokenMode: "ok" as MockMode,
    githubInstallation: {
      accountLogin: "acme-corp",
      accountType: "Organization",
      suspended: false,
      permissions: { contents: "read", metadata: "read" } as Record<string, string>,
    },
    githubInstallationTokenMode: "ok" as MockMode,
    githubInstallationToken: "ghs_mock_installation_token",
    githubRepositoriesMode: "ok" as MockMode,
    githubCommitsMode: "ok" as MockMode,
    githubGraphqlMode: "ok" as MockMode,
    githubRepositories: [
      {
        id: 101,
        name: "alpha",
        full_name: "acme-corp/alpha",
        owner: { login: "acme-corp" },
        private: false,
        description: "Public product repository",
        language: "TypeScript",
        stargazers_count: 42,
        forks_count: 5,
        open_issues_count: 3,
        html_url: "https://github.com/acme-corp/alpha",
        default_branch: "main",
        pushed_at: "2026-10-26T12:00:00Z",
        updated_at: "2026-10-26T12:00:00Z",
      },
      {
        id: 102,
        name: "private-repo",
        full_name: "acme-corp/private-repo",
        owner: { login: "acme-corp" },
        private: true,
        description: "Internal repository",
        language: "Go",
        stargazers_count: 7,
        forks_count: 1,
        open_issues_count: 0,
        html_url: "https://github.com/acme-corp/private-repo",
        default_branch: "main",
        pushed_at: "2026-10-25T12:00:00Z",
        updated_at: "2026-10-25T12:00:00Z",
      },
    ],
    githubCommits: {
      "acme-corp/alpha": [
        {
          sha: "a".repeat(40),
          html_url: "https://github.com/acme-corp/alpha/commit/aaaaaaaa",
          commit: {
            message: "Add overview endpoint",
            author: { date: "2026-10-26T11:00:00Z" },
          },
          author: { login: "conn-user-a" },
        },
        {
          sha: "b".repeat(40),
          html_url: "https://github.com/acme-corp/alpha/commit/bbbbbbbb",
          commit: {
            message: "Wire overview data",
            author: { date: "2026-10-24T11:00:00Z" },
          },
          author: { login: "conn-user-a" },
        },
      ],
      "acme-corp/private-repo": [
        {
          sha: "c".repeat(40),
          html_url: "https://github.com/acme-corp/private-repo/commit/cccccccc",
          commit: {
            message: "Private repository fix",
            author: { date: "2026-10-23T11:00:00Z" },
          },
          author: { login: "conn-user-a" },
        },
      ],
    } as Record<string, unknown[]>,
    githubCommitFailures: new Set<string>(),
    githubContributions: {
      restrictedContributionsCount: 2,
      hasAnyRestrictedContributions: true,
      contributionCalendar: {
        totalContributions: 5,
        weeks: [
          {
            contributionDays: [
              { date: "2026-10-20", contributionCount: 1, contributionLevel: "FIRST_QUARTILE" },
              { date: "2026-10-21", contributionCount: 2, contributionLevel: "SECOND_QUARTILE" },
              { date: "2026-10-22", contributionCount: 0, contributionLevel: "NONE" },
              { date: "2026-10-23", contributionCount: 2, contributionLevel: "THIRD_QUARTILE" },
            ],
          },
        ],
      },
    },
    missingInstallations: new Set<number>(),
    association: "ok" as "ok" | "missing" | "unauthorized",
    githubRevoke: "ok" as MockMode,
    vercelTokenMode: "ok" as MockMode,
    vercelRefreshMode: "ok" as MockMode,
    vercelRevoke: "ok" as MockMode,
    vercelUser: {
      uid: 777001,
      username: "acme-vercel",
      email: "ops@acme.test",
      name: "Acme",
    },
    calls,
  };

  const json = (payload: unknown, status = 200): Response =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });

  const failOrThrow = (
    mode: MockMode,
    failPayload: unknown,
    failStatus: number,
  ): Response | null => {
    if (mode === "unreachable") {
      throw new Error("mock network failure");
    }
    if (mode === "fail") {
      return json(failPayload, failStatus);
    }
    return null;
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const raw =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw);
    const path = url.pathname;
    const body = new URLSearchParams(String(init?.body ?? ""));

    // --- GitHub OAuth (login + App installation connection) ---
    if (`${url.origin}${path}` === GITHUB_OAUTH.tokenUrl) {
      const verifier = body.get("code_verifier");
      calls.push({ kind: "github_token", detail: verifier ? "with_verifier" : "no_verifier" });
      const failure = failOrThrow(
        state.githubTokenMode,
        { error: "bad_verification_code", error_description: "mock" },
        200,
      );
      if (failure) return failure;
      return json({ access_token: "gho_mock_token", token_type: "bearer", scope: "" });
    }

    if (url.origin === "https://api.github.com") {
      const authHeader = String((init?.headers as Record<string, string>)["Authorization"] ?? "");

      if (path === "/user") {
        calls.push({ kind: "github_user" });
        if (authHeader !== "Bearer gho_mock_token") {
          return json({ message: "Bad credentials" }, 401);
        }
        return json({
          id: Number(state.githubUser.id),
          login: state.githubUser.login,
          name: state.githubUser.name,
          avatar_url: `https://avatars.example/${state.githubUser.login}.png`,
        });
      }

      const installMatch = /^\/app\/installations\/(\d+)$/.exec(path);
      if (installMatch) {
        const installationId = Number(installMatch[1]);
        calls.push({ kind: "github_installation", detail: String(installationId) });
        if (!authHeader.startsWith("Bearer ")) {
          return json({ message: "Bad credentials" }, 401);
        }
        if (state.missingInstallations.has(installationId)) {
          return json({ message: "Not Found" }, 404);
        }
        return json({
          id: installationId,
          account: {
            login: state.githubInstallation.accountLogin,
            type: state.githubInstallation.accountType,
          },
          suspended_at: state.githubInstallation.suspended ? "2026-01-01T00:00:00Z" : null,
          permissions: state.githubInstallation.permissions,
        });
      }

      const installationTokenMatch = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path);
      if (installationTokenMatch && init?.method === "POST") {
        calls.push({ kind: "github_installation_token", detail: installationTokenMatch[1] as string });
        const failure = failOrThrow(
          state.githubInstallationTokenMode,
          { message: "Bad credentials" },
          401,
        );
        if (failure) return failure;
        return json({
          token: state.githubInstallationToken,
          expires_at: "2026-10-27T13:00:00Z",
          permissions: state.githubInstallation.permissions,
        });
      }

      if (path === "/installation/repositories" && init?.method === "GET") {
        calls.push({ kind: "github_repositories" });
        if (authHeader !== `Bearer ${state.githubInstallationToken}`) {
          return json({ message: "Bad credentials" }, 401);
        }
        const failure = failOrThrow(
          state.githubRepositoriesMode,
          { message: "Resource not accessible by integration" },
          403,
        );
        if (failure) return failure;
        const page = Number(url.searchParams.get("page") ?? "1");
        const perPage = Number(url.searchParams.get("per_page") ?? "100");
        const start = (page - 1) * perPage;
        return json({
          total_count: state.githubRepositories.length,
          repositories: state.githubRepositories.slice(start, start + perPage),
        });
      }

      const commitsMatch = /^\/repos\/([^/]+)\/([^/]+)\/commits$/.exec(path);
      if (commitsMatch && init?.method === "GET") {
        const fullName = `${commitsMatch[1]}/${commitsMatch[2]}`;
        calls.push({ kind: "github_commits", detail: fullName });
        if (authHeader !== `Bearer ${state.githubInstallationToken}`) {
          return json({ message: "Bad credentials" }, 401);
        }
        if (state.githubCommitFailures.has(fullName)) {
          return json({ message: "Resource not accessible by integration" }, 403);
        }
        const failure = failOrThrow(
          state.githubCommitsMode,
          { message: "Resource not accessible by integration" },
          403,
        );
        if (failure) return failure;
        return json(state.githubCommits[fullName] ?? []);
      }

      if (path === "/graphql" && init?.method === "POST") {
        calls.push({ kind: "github_graphql" });
        if (authHeader !== "Bearer gho_mock_token") {
          return json({ message: "Bad credentials" }, 401);
        }
        const failure = failOrThrow(
          state.githubGraphqlMode,
          { message: "Resource not accessible by integration" },
          403,
        );
        if (failure) return failure;
        return json({
          data: {
            viewer: {
              login: state.githubUser.login,
              name: state.githubUser.name,
              avatarUrl: `https://avatars.example/${state.githubUser.login}.png`,
              contributionsCollection: state.githubContributions,
            },
          },
        });
      }

      const associationMatch = /^\/user\/installations\/(\d+)\/repositories$/.exec(path);
      if (associationMatch) {
        calls.push({ kind: "github_association", detail: associationMatch[1] as string });
        if (state.association === "unauthorized") {
          return json({ message: "Bad credentials" }, 401);
        }
        if (state.association === "missing") {
          return json({ message: "Not Found" }, 404);
        }
        return json({ repositories: [], total_count: 0 });
      }

      if (/^\/applications\/[^/]+\/token$/.test(path) && init?.method === "DELETE") {
        calls.push({ kind: "github_revoke" });
        if (state.githubRevoke === "unreachable") {
          throw new Error("mock network failure");
        }
        if (state.githubRevoke === "fail") {
          return json({ message: "Bad credentials" }, 401);
        }
        return new Response(null, { status: 204 });
      }
    }

    // --- npm registry ---
    if (`${url.origin}${path}` === NPM_REGISTRY.whoamiUrl) {
      calls.push({ kind: "npm_whoami" });
      const failure = failOrThrow(state.npmMode, { error: "unauthorized" }, 401);
      if (failure) return failure;
      return json({ username: state.npmUsername });
    }

    // --- Vercel ---
    if (`${url.origin}${path}` === VERCEL_OAUTH.tokenUrl) {
      const grant = body.get("grant_type");
      calls.push({ kind: "vercel_token", detail: grant ?? "unknown" });
      if (grant === "refresh_token") {
        const failure = failOrThrow(state.vercelRefreshMode, { error: "invalid_grant" }, 401);
        if (failure) return failure;
      } else {
        const failure = failOrThrow(state.vercelTokenMode, { error: "invalid_grant" }, 400);
        if (failure) return failure;
      }
      vercelTokenCounter += 1;
      return json({
        access_token: `va_token_${vercelTokenCounter}`,
        refresh_token: `vr_token_${vercelTokenCounter}`,
        expires_in: 3600,
        token_type: "Bearer",
      });
    }

    if (`${url.origin}${path}` === VERCEL_OAUTH.userUrl) {
      calls.push({ kind: "vercel_user" });
      return json({ user: state.vercelUser });
    }

    if (`${url.origin}${path}` === VERCEL_OAUTH.revokeUrl) {
      calls.push({ kind: "vercel_revoke" });
      if (state.vercelRevoke === "unreachable") {
        throw new Error("mock network failure");
      }
      if (state.vercelRevoke === "fail") {
        return json({ error: "invalid_token" }, 400);
      }
      return json({});
    }

    throw new Error(`Unexpected outbound request in test: ${url.toString()}`);
  };

  return {
    fetchImpl,
    state,
    calls,
    callsOf(kind: ProviderMockCall["kind"]): ProviderMockCall[] {
      return calls.filter((call) => call.kind === kind);
    },
  };
}

export type ProviderMock = ReturnType<typeof createProviderMock>;
