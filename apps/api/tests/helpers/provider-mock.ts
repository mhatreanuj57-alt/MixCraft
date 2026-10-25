import { GITHUB_OAUTH, NPM_REGISTRY, VERCEL_OAUTH } from "../../src/config/constants.js";

export type MockMode = "ok" | "fail" | "unreachable";

export interface ProviderMockCall {
  kind:
    | "github_token"
    | "github_user"
    | "github_installation"
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
      permissions: { contents: "read", metadata: "read" },
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
