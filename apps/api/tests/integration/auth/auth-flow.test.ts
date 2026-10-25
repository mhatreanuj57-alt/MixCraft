import { createPrismaClient, type PrismaClient } from "@mixcraft/database";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { API_ROUTES, COOKIES, CSRF_HEADER, GITHUB_OAUTH } from "../../../src/config/constants.js";
import { env } from "../../../src/config/env.js";
import { createGitHubMock, type GitHubMock } from "../../helpers/github-mock.js";
import { findCookie, requireCookieValue } from "../../helpers/http.js";

const suiteStart = new Date();
const githubUserId = String(9_000_000_000 + Math.floor(Math.random() * 1_000_000));
const testLogin = `mock-octocat-${githubUserId.slice(-6)}`;
const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

let db: PrismaClient;
let app: FastifyInstance;
let mock: GitHubMock;

beforeAll(async () => {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set for integration tests (see vitest.config.ts)");
  }
  db = createPrismaClient(env.DATABASE_URL);
  mock = createGitHubMock({ githubUserId, login: testLogin, name: "Mock Octocat" });
  app = buildApp({ fetchImpl: mock.fetchImpl });
  await app.ready();
});

afterAll(async () => {
  const users = await db.user.findMany({ where: { githubUserId }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  if (userIds.length > 0) {
    await db.auditEvent.deleteMany({ where: { userId: { in: userIds } } });
  }
  await db.user.deleteMany({ where: { githubUserId } });
  await db.oauthTransaction.deleteMany({
    where: { provider: "github", createdAt: { gte: suiteStart } },
  });
  await app.close();
  await db.$disconnect();
});

async function beginLogin(): Promise<{ state: string; binding: string }> {
  const res = await app.inject({ method: "GET", url: API_ROUTES.githubLogin });
  expect(res.statusCode).toBe(302);
  const location = new URL(String(res.headers.location));
  const state = location.searchParams.get("state");
  if (!state) throw new Error("authorize redirect is missing state");
  return { state, binding: requireCookieValue(res, COOKIES.oauthBinding) };
}

async function completeCallback(params: {
  state: string;
  binding?: string;
  code?: string;
  error?: string;
  accept?: string;
}): Promise<LightMyRequestResponse> {
  const query = new URLSearchParams();
  query.set("state", params.state);
  if (params.error) query.set("error", params.error);
  if (params.code !== undefined || !params.error) query.set("code", params.code ?? "test-code");
  return app.inject({
    method: "GET",
    url: `${API_ROUTES.githubLoginCallback}?${query.toString()}`,
    cookies: params.binding ? { [COOKIES.oauthBinding]: params.binding } : {},
    headers: params.accept ? { accept: params.accept } : {},
  });
}

async function loginAsTestUser(): Promise<{ session: string; csrf: string }> {
  const { state, binding } = await beginLogin();
  const res = await completeCallback({ state, binding });
  expect(res.statusCode).toBe(302);
  return {
    session: requireCookieValue(res, COOKIES.session),
    csrf: requireCookieValue(res, COOKIES.csrf),
  };
}

describe("GET /api/auth/github", () => {
  it("redirects to GitHub with PKCE and no scopes, setting a restrictive binding cookie", async () => {
    const res = await app.inject({ method: "GET", url: API_ROUTES.githubLogin });
    expect(res.statusCode).toBe(302);

    const location = new URL(String(res.headers.location));
    expect(`${location.origin}${location.pathname}`).toBe(GITHUB_OAUTH.authorizeUrl);
    expect(location.searchParams.get("client_id")).toBe("test-github-client-id");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toBeTruthy();
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("scope")).toBeNull();

    const binding = findCookie(res, COOKIES.oauthBinding);
    expect(binding).toBeDefined();
    expect(binding?.httpOnly).toBe(true);
    expect(binding?.path).toBe(API_ROUTES.githubLogin);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("issues a fresh state and binding on every attempt", async () => {
    const a = await beginLogin();
    const b = await beginLogin();
    expect(a.state).not.toBe(b.state);
    expect(a.binding).not.toBe(b.binding);
  });
});

describe("GET /api/auth/github/callback", () => {
  it("completes login with PKCE exchange and persists exactly one user", async () => {
    const tokensBefore = mock.tokenRequests.length;
    const profilesBefore = mock.profileRequests;
    const { state, binding } = await beginLogin();

    const res = await completeCallback({ state, binding });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(env.WEB_ORIGIN);

    const session = findCookie(res, COOKIES.session);
    const csrf = findCookie(res, COOKIES.csrf);
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite?.toLowerCase()).toBe("lax");
    expect(csrf?.httpOnly).toBe(false);
    // The binding cookie is actively cleared (deletion cookie with empty value).
    expect(findCookie(res, COOKIES.oauthBinding)?.value).toBe("");

    expect(mock.tokenRequests.length).toBe(tokensBefore + 1);
    const tokenRequest = mock.tokenRequests.at(-1);
    expect(tokenRequest?.get("client_id")).toBe("test-github-client-id");
    expect(tokenRequest?.get("code")).toBe("test-code");
    expect(tokenRequest?.get("code_verifier")).toBeTruthy();
    expect(mock.profileRequests).toBe(profilesBefore + 1);

    const users = await db.user.findMany({ where: { githubUserId } });
    expect(users).toHaveLength(1);
    expect(users[0]?.githubLogin).toBe(testLogin);
    expect(users[0]?.displayName).toBe("Mock Octocat");
    expect(users[0]?.lastLoginAt).not.toBeNull();

    const loginAudits = await db.auditEvent.findMany({
      where: { userId: users[0]?.id, action: "auth.login", outcome: "success" },
    });
    expect(loginAudits).toHaveLength(1);
  });

  it("returns the signed-in profile from GET /api/me", async () => {
    const { session } = await loginAsTestUser();
    const res = await app.inject({
      method: "GET",
      url: API_ROUTES.me,
      cookies: { [COOKIES.session]: session },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.githubLogin).toBe(testLogin);
    expect(body.data.displayName).toBe("Mock Octocat");
    expect(typeof body.data.createdAt).toBe("string");
    expect(body.meta.requestId).toBeTruthy();
  });

  it("401s GET /api/me without a session", async () => {
    const res = await app.inject({ method: "GET", url: API_ROUTES.me });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("AUTHENTICATION_REQUIRED");
    expect(res.json().error.requestId).toBeTruthy();
  });

  it("does not create a duplicate user on repeated logins", async () => {
    await loginAsTestUser();
    const users = await db.user.findMany({ where: { githubUserId } });
    expect(users).toHaveLength(1);
  });

  it("rejects a callback without the binding cookie", async () => {
    const { state } = await beginLogin();
    const res = await completeCallback({ state });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a callback with a mismatched binding cookie", async () => {
    const { state } = await beginLogin();
    const res = await completeCallback({ state, binding: "attacker-binding-value" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("PERMISSION_DENIED");
  });

  it("rejects an unknown state", async () => {
    const res = await completeCallback({ state: "made-up-state", binding: "whatever" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("enforces single-use state (replay → 409)", async () => {
    const { state, binding } = await beginLogin();
    const first = await completeCallback({ state, binding });
    expect(first.statusCode).toBe(302);

    const replay = await completeCallback({ state, binding });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error.code).toBe("OPERATION_CONFLICT");
  });

  it("maps a GitHub token failure to PROVIDER_UNAVAILABLE and audits it", async () => {
    const { state, binding } = await beginLogin();
    mock.setTokenFailure(true);
    try {
      const res = await completeCallback({ state, binding });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("PROVIDER_UNAVAILABLE");
    } finally {
      mock.setTokenFailure(false);
    }
    const failures = await db.auditEvent.findMany({
      where: { action: "auth.login", outcome: "failure", createdAt: { gte: suiteStart } },
    });
    expect(failures.length).toBeGreaterThan(0);
  });

  it("rejects provider errors returned by GitHub (e.g. user denied)", async () => {
    const { state, binding } = await beginLogin();
    const res = await completeCallback({ state, binding, error: "access_denied" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });
});

describe("browser navigations receive redirects instead of raw JSON", () => {
  const feedbackLocation = (error: string) =>
    `${env.WEB_ORIGIN}/connections?provider=github&error=${error}`;

  it("still starts the login when the client prefers HTML", async () => {
    const res = await app.inject({
      method: "GET",
      url: API_ROUTES.githubLogin,
      headers: { accept: BROWSER_ACCEPT },
    });
    expect(res.statusCode).toBe(302);
    const location = new URL(String(res.headers.location));
    expect(`${location.origin}${location.pathname}`).toBe(GITHUB_OAUTH.authorizeUrl);
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(findCookie(res, COOKIES.oauthBinding)).toBeDefined();
  });

  it("redirects a denied GitHub consent to the Connections banner", async () => {
    const { state, binding } = await beginLogin();
    const res = await completeCallback({
      state,
      binding,
      error: "access_denied",
      accept: BROWSER_ACCEPT,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(feedbackLocation("VALIDATION_FAILED"));
    expect(findCookie(res, COOKIES.oauthBinding)?.value).toBe("");
  });

  it("redirects an unknown state failure to the Connections banner", async () => {
    const res = await completeCallback({
      state: "made-up-state",
      binding: "whatever",
      accept: BROWSER_ACCEPT,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(feedbackLocation("VALIDATION_FAILED"));
  });

  it("redirects a token-exchange failure as PROVIDER_UNAVAILABLE", async () => {
    const { state, binding } = await beginLogin();
    mock.setTokenFailure(true);
    try {
      const res = await completeCallback({ state, binding, accept: BROWSER_ACCEPT });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(feedbackLocation("PROVIDER_UNAVAILABLE"));
      expect(findCookie(res, COOKIES.oauthBinding)?.value).toBe("");
    } finally {
      mock.setTokenFailure(false);
    }
  });

  it("still answers the JSON envelope when the client prefers application/json", async () => {
    const { state, binding } = await beginLogin();
    mock.setTokenFailure(true);
    try {
      const res = await completeCallback({ state, binding, accept: "application/json" });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(res.json().error.requestId).toBeTruthy();
    } finally {
      mock.setTokenFailure(false);
    }
  });
});

describe("POST /api/auth/logout", () => {
  it("403s when the CSRF header is missing", async () => {
    const { session, csrf } = await loginAsTestUser();
    const res = await app.inject({
      method: "POST",
      url: API_ROUTES.logout,
      cookies: { [COOKIES.session]: session, [COOKIES.csrf]: csrf },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("PERMISSION_DENIED");
  });

  it("403s when the CSRF header does not match the cookie", async () => {
    const { session } = await loginAsTestUser();
    const res = await app.inject({
      method: "POST",
      url: API_ROUTES.logout,
      cookies: { [COOKIES.session]: session, [COOKIES.csrf]: "cookie-token" },
      headers: { [CSRF_HEADER]: "header-token" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("PERMISSION_DENIED");
  });

  it("403s for a disallowed Origin even with a valid CSRF pair", async () => {
    const { session, csrf } = await loginAsTestUser();
    const res = await app.inject({
      method: "POST",
      url: API_ROUTES.logout,
      cookies: { [COOKIES.session]: session, [COOKIES.csrf]: csrf },
      headers: { [CSRF_HEADER]: csrf, origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("PERMISSION_DENIED");
  });

  it("401s when unauthenticated (valid CSRF pair, no session)", async () => {
    const res = await app.inject({
      method: "POST",
      url: API_ROUTES.logout,
      cookies: { [COOKIES.csrf]: "anonymous-token" },
      headers: { [CSRF_HEADER]: "anonymous-token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("revokes the session and clears cookies when CSRF is valid", async () => {
    const { session, csrf } = await loginAsTestUser();
    const res = await app.inject({
      method: "POST",
      url: API_ROUTES.logout,
      cookies: { [COOKIES.session]: session, [COOKIES.csrf]: csrf },
      headers: { [CSRF_HEADER]: csrf },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ loggedOut: true });
    expect(findCookie(res, COOKIES.session)?.value).toBe("");

    const after = await app.inject({
      method: "GET",
      url: API_ROUTES.me,
      cookies: { [COOKIES.session]: session },
    });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe("AUTHENTICATION_REQUIRED");
  });
});

describe("misc contract", () => {
  it("GET /api/health reports database connectivity", async () => {
    const res = await app.inject({ method: "GET", url: API_ROUTES.health });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.status).toBe("ok");
    expect(body.data.environment).toBe("test");
    expect(body.data.database).toBe("connected");
  });

  it("returns RESOURCE_NOT_FOUND for unknown routes", async () => {
    const res = await app.inject({ method: "GET", url: "/api/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
    expect(res.json().error.requestId).toBeTruthy();
  });
});
