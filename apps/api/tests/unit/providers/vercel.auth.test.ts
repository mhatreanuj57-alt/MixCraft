import { describe, expect, it } from "vitest";
import { VERCEL_OAUTH } from "../../../src/config/constants.js";
import {
  buildVercelAuthorizeUrl,
  exchangeVercelCode,
  fetchVercelUser,
  refreshVercelToken,
  revokeVercelToken,
} from "../../../src/providers/vercel/vercel.auth.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("buildVercelAuthorizeUrl", () => {
  it("includes PKCE, scopes, and the connection callback redirect", () => {
    const url = new URL(
      buildVercelAuthorizeUrl({
        clientId: "test-vercel-client",
        redirectUri: "http://127.0.0.1:3001/api/connections/vercel/callback",
        state: "state-value",
        codeChallenge: "challenge",
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(VERCEL_OAUTH.authorizeUrl);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-vercel-client");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3001/api/connections/vercel/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("code_challenge")).toBe("challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid profile offline_access");
  });
});

describe("exchangeVercelCode", () => {
  it("exchanges the code with PKCE and parses the token set", async () => {
    let capturedBody = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe(VERCEL_OAUTH.tokenUrl);
      capturedBody = String(init?.body ?? "");
      return jsonResponse({
        access_token: "va_token",
        refresh_token: "vr_token",
        expires_in: 3600,
      });
    };

    const tokens = await exchangeVercelCode({
      clientId: "cid",
      clientSecret: "csecret",
      redirectUri: "http://127.0.0.1:3001/api/connections/vercel/callback",
      code: "auth-code",
      codeVerifier: "pkce-verifier",
      fetchImpl,
    });

    expect(tokens).toEqual({ accessToken: "va_token", refreshToken: "vr_token", expiresIn: 3600 });
    const body = new URLSearchParams(capturedBody);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toBe("pkce-verifier");
    expect(body.get("client_id")).toBe("cid");
  });

  it("maps a rejected exchange to kind=rejected", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ error: "invalid_grant" }, 400);
    await expect(
      exchangeVercelCode({
        clientId: "cid",
        clientSecret: "sec",
        redirectUri: "http://127.0.0.1:3001/api/connections/vercel/callback",
        code: "bad",
        codeVerifier: "v",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ name: "VercelAuthError", kind: "rejected" });
  });

  it("maps a network failure to kind=network", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(
      exchangeVercelCode({
        clientId: "cid",
        clientSecret: "sec",
        redirectUri: "http://127.0.0.1:3001/api/connections/vercel/callback",
        code: "code",
        codeVerifier: "v",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ kind: "network" });
  });
});

describe("refreshVercelToken", () => {
  it("sends the refresh grant and returns the rotated token set", async () => {
    let capturedBody = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      capturedBody = String(init?.body ?? "");
      return jsonResponse({
        access_token: "va_rotated",
        refresh_token: "vr_rotated",
        expires_in: 3600,
      });
    };
    const tokens = await refreshVercelToken({
      clientId: "cid",
      clientSecret: "sec",
      refreshToken: "vr_old",
      fetchImpl,
    });
    const body = new URLSearchParams(capturedBody);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("vr_old");
    expect(tokens.accessToken).toBe("va_rotated");
    expect(tokens.refreshToken).toBe("vr_rotated");
  });

  it("survives a response without a new refresh token", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ access_token: "va_only", expires_in: 60 });
    const tokens = await refreshVercelToken({
      clientId: "cid",
      clientSecret: "sec",
      refreshToken: "vr_old",
      fetchImpl,
    });
    expect(tokens.refreshToken).toBeNull();
  });

  it("maps a rejected refresh to kind=rejected", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ error: "invalid_grant" }, 401);
    await expect(
      refreshVercelToken({
        clientId: "cid",
        clientSecret: "sec",
        refreshToken: "vr_bad",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ kind: "rejected" });
  });
});

describe("fetchVercelUser", () => {
  it("accepts the wrapped /v2/user shape and prefers username", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        user: { uid: 77, username: "acme", email: "ops@acme.test", name: "Acme Inc" },
      });
    await expect(fetchVercelUser("va", fetchImpl)).resolves.toEqual({
      providerAccountId: "77",
      accountName: "acme",
    });
  });

  it("accepts a flat shape and falls back to email", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ uid: "user_1", email: "dev@example.test" });
    await expect(fetchVercelUser("va", fetchImpl)).resolves.toEqual({
      providerAccountId: "user_1",
      accountName: "dev@example.test",
    });
  });

  it("rejects an unnamed profile", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ user: { uid: 3 } });
    await expect(fetchVercelUser("va", fetchImpl)).rejects.toMatchObject({
      name: "VercelAuthError",
    });
  });

  it("maps unreachable API to kind=network", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("down");
    };
    await expect(fetchVercelUser("va", fetchImpl)).rejects.toMatchObject({ kind: "network" });
  });
});

describe("revokeVercelToken", () => {
  it("returns true on success and false on network failure", async () => {
    const okFetch: typeof fetch = async (input, init) => {
      expect(String(input)).toBe(VERCEL_OAUTH.revokeUrl);
      expect(String(init?.body ?? "")).toContain("token=va_token");
      return jsonResponse({});
    };
    await expect(
      revokeVercelToken({
        clientId: "cid",
        clientSecret: "sec",
        token: "va_token",
        fetchImpl: okFetch,
      }),
    ).resolves.toBe(true);

    const downFetch: typeof fetch = async () => {
      throw new Error("down");
    };
    await expect(
      revokeVercelToken({
        clientId: "cid",
        clientSecret: "sec",
        token: "va_token",
        fetchImpl: downFetch,
      }),
    ).resolves.toBe(false);
  });
});
