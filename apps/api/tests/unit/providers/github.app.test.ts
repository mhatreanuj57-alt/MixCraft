import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildAppJwt,
  buildInstallUrl,
  fetchInstallation,
  installationPermissionsToScopes,
  isInstallationAssociatedWithUser,
  revokeUserToken,
  type GithubAppConfig,
} from "../../../src/providers/github/github.app.js";
import { GitHubAppError } from "../../../src/providers/github/github.errors.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const config: GithubAppConfig = {
  appId: "123456",
  slug: "mixcraft-app",
  clientId: "Iv1.test-client",
  clientSecret: "test-client-secret",
  privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("buildAppJwt", () => {
  it("signs a valid RS256 JWT within GitHub's 10-minute cap", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const jwt = buildAppJwt(config, now);
    const [headerPart, payloadPart, signaturePart] = jwt.split(".");
    expect(headerPart).toBeDefined();
    expect(payloadPart).toBeDefined();
    expect(signaturePart).toBeDefined();

    const header = JSON.parse(Buffer.from(headerPart as string, "base64url").toString()) as {
      alg?: string;
      typ?: string;
    };
    const payload = JSON.parse(Buffer.from(payloadPart as string, "base64url").toString()) as {
      iss?: string;
      iat?: number;
      exp?: number;
    };

    expect(header.alg).toBe("RS256");
    expect(header.typ).toBe("JWT");
    expect(payload.iss).toBe(config.appId);
    expect(payload.iat).toBe(Math.floor(now.getTime() / 1000) - 60);
    expect(payload.exp).toBe((payload.iat as number) + 540);
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(600);

    const valid = verify(
      "sha256",
      Buffer.from(`${headerPart}.${payloadPart}`, "utf8"),
      publicKey,
      Buffer.from(signaturePart as string, "base64url"),
    );
    expect(valid).toBe(true);
  });

  it("rejects an unparseable private key with GitHubAppError", () => {
    expect(() => buildAppJwt({ ...config, privateKey: "not-a-pem-key" })).toThrowError(
      GitHubAppError,
    );
  });
});

describe("buildInstallUrl", () => {
  it("points at the app's install page and echoes state", () => {
    const url = new URL(buildInstallUrl(config, "state-value"));
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://github.com/apps/mixcraft-app/installations/new",
    );
    expect(url.searchParams.get("state")).toBe("state-value");
  });
});

describe("installationPermissionsToScopes", () => {
  it("maps and sorts permissions into scope strings", () => {
    expect(installationPermissionsToScopes({ contents: "write", metadata: "read" })).toEqual([
      "contents:write",
      "metadata:read",
    ]);
  });

  it("returns an empty list for non-object permissions", () => {
    expect(installationPermissionsToScopes(undefined)).toEqual([]);
    expect(installationPermissionsToScopes(null)).toEqual([]);
    expect(installationPermissionsToScopes(["contents", "read"])).toEqual([]);
    expect(installationPermissionsToScopes("contents:read")).toEqual([]);
    expect(installationPermissionsToScopes({ contents: 42 })).toEqual([]);
  });
});

describe("fetchInstallation", () => {
  it("parses the installation and derives scopes from permissions", async () => {
    const seen: { authorization?: string } = {};
    const fetchImpl: typeof fetch = async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      seen.authorization = headers["Authorization"];
      return jsonResponse({
        id: 424242,
        account: { login: "acme-corp", type: "Organization" },
        suspended_at: null,
        permissions: { contents: "read", issues: "write" },
      });
    };

    const info = await fetchInstallation(config, 424242, fetchImpl);
    expect(info).toEqual({
      installationId: 424242,
      accountLogin: "acme-corp",
      accountType: "Organization",
      suspended: false,
      scopes: ["contents:read", "issues:write"],
    });
    expect(seen.authorization?.startsWith("Bearer ")).toBe(true);
    expect(seen.authorization?.slice("Bearer ".length).split(".")).toHaveLength(3);
  });

  it("marks a suspended installation", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        id: 7,
        account: { login: "acme", type: "User" },
        suspended_at: "2026-01-01T00:00:00Z",
        permissions: {},
      });
    const info = await fetchInstallation(config, 7, fetchImpl);
    expect(info.suspended).toBe(true);
  });

  it("classifies 404 as not_found", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({}, 404);
    await expect(fetchInstallation(config, 1, fetchImpl)).rejects.toMatchObject({
      name: "GitHubAppError",
      kind: "not_found",
    });
  });

  it("classifies network failures as network", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(fetchInstallation(config, 1, fetchImpl)).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("classifies a rejected App JWT as rejected", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ message: "Bad credentials" }, 401);
    await expect(fetchInstallation(config, 1, fetchImpl)).rejects.toMatchObject({
      kind: "rejected",
    });
  });
});

describe("isInstallationAssociatedWithUser", () => {
  it("returns true on 200 and false on 404", async () => {
    const okFetch: typeof fetch = async () => jsonResponse({ repositories: [] });
    await expect(isInstallationAssociatedWithUser("ghu_token", 5, okFetch)).resolves.toBe(true);

    const missingFetch: typeof fetch = async () => jsonResponse({}, 404);
    await expect(isInstallationAssociatedWithUser("ghu_token", 5, missingFetch)).resolves.toBe(
      false,
    );
  });

  it("rejects a bad user token and unreachable API distinctly", async () => {
    const unauthorized: typeof fetch = async () =>
      jsonResponse({ message: "Bad credentials" }, 401);
    await expect(isInstallationAssociatedWithUser("bad", 5, unauthorized)).rejects.toMatchObject({
      kind: "rejected",
    });

    const unreachable: typeof fetch = async () => {
      throw new Error("down");
    };
    await expect(isInstallationAssociatedWithUser("ghu", 5, unreachable)).rejects.toMatchObject({
      kind: "network",
    });
  });
});

describe("revokeUserToken", () => {
  it("returns true on success and false on network failure", async () => {
    const okFetch: typeof fetch = async (_input, init) => {
      expect(init?.method).toBe("DELETE");
      return new Response(null, { status: 204 });
    };
    await expect(revokeUserToken(config, "gho_token", okFetch)).resolves.toBe(true);

    const downFetch: typeof fetch = async () => {
      throw new Error("down");
    };
    await expect(revokeUserToken(config, "gho_token", downFetch)).resolves.toBe(false);
  });
});
