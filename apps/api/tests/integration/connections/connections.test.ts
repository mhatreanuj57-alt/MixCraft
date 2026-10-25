import { createPrismaClient, type PrismaClient } from "@mixcraft/database";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import {
  API_ROUTES,
  COOKIES,
  CONNECTION_AUDIT_ACTIONS,
  CSRF_HEADER,
} from "../../../src/config/constants.js";
import { env } from "../../../src/config/env.js";
import type { ConnectionsConfig } from "../../../src/modules/connections/connection.config.js";
import { decodeEncryptionKey, decryptSecret } from "../../../src/security/encryption.js";
import { findCookie, requireCookieValue } from "../../helpers/http.js";
import { createProviderMock, type ProviderMock } from "../../helpers/provider-mock.js";

const suiteStart = new Date();
const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
const userAGithubId = `92${suffix}01`;
const userBGithubId = `92${suffix}02`;
const loginA = `conn-a-${suffix}`;
const loginB = `conn-b-${suffix}`;

const NPM_TOKEN = "npm_mock_granular_token";

let db: PrismaClient;
let app: FastifyInstance;
let unconfiguredApp: FastifyInstance;
let mock: ProviderMock;
let connectionsConfig: ConnectionsConfig;

let sessionA = "";
let csrfA = "";
let sessionB = "";
let csrfB = "";
let userAId = "";

let npmConnectionId = "";
let githubConnectionId = "";
let vercelConnectionId = "";

function testEncryptionKey(): string {
  const key = env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY must be set for integration tests");
  return key;
}

function decryptRow(row: {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  authenticationTag: Uint8Array;
}): string {
  return decryptSecret(
    {
      ciphertext: Buffer.from(row.ciphertext),
      nonce: Buffer.from(row.nonce),
      authenticationTag: Buffer.from(row.authenticationTag),
    },
    decodeEncryptionKey(testEncryptionKey()),
  );
}

async function loginWith(githubUser: { id: string; login: string; name: string }): Promise<{
  session: string;
  csrf: string;
}> {
  mock.state.githubUser = githubUser;

  const begin = await app.inject({ method: "GET", url: API_ROUTES.githubLogin });
  expect(begin.statusCode).toBe(302);
  const beginUrl = new URL(String(begin.headers.location));
  const state = beginUrl.searchParams.get("state") as string;
  const binding = requireCookieValue(begin, COOKIES.oauthBinding);

  const callback = await app.inject({
    method: "GET",
    url: `${API_ROUTES.githubLoginCallback}?${new URLSearchParams({ state, code: "login-code" })}`,
    cookies: { [COOKIES.oauthBinding]: binding },
  });
  expect(callback.statusCode).toBe(302);
  return {
    session: requireCookieValue(callback, COOKIES.session),
    csrf: requireCookieValue(callback, COOKIES.csrf),
  };
}

function authed(
  session: string,
  csrf?: string,
): { cookies: { [key: string]: string }; headers: { [key: string]: string } } {
  return csrf
    ? {
        cookies: { [COOKIES.session]: session, [COOKIES.csrf]: csrf },
        headers: { [CSRF_HEADER]: csrf },
      }
    : { cookies: { [COOKIES.session]: session }, headers: {} };
}

async function startGithub(session: string): Promise<{ state: string; binding: string }> {
  const res = await app.inject({
    method: "GET",
    url: API_ROUTES.githubConnectStart,
    cookies: { [COOKIES.session]: session },
  });
  expect(res.statusCode).toBe(302);
  const location = new URL(String(res.headers.location));
  const state = location.searchParams.get("state");
  if (!state) throw new Error("install redirect is missing state");
  return { state, binding: requireCookieValue(res, COOKIES.githubConnectionBinding) };
}

function githubCallbackUrl(params: {
  code?: string;
  state?: string;
  installationId?: number;
  setupAction?: string;
}): string {
  const query = new URLSearchParams();
  if (params.code !== undefined) query.set("code", params.code);
  if (params.state !== undefined) query.set("state", params.state);
  if (params.installationId !== undefined)
    query.set("installation_id", String(params.installationId));
  if (params.setupAction !== undefined) query.set("setup_action", params.setupAction);
  return `${API_ROUTES.githubConnectCallback}?${query.toString()}`;
}

function githubCallbackCookies(binding: string, session?: string): Record<string, string> {
  const cookies: Record<string, string> = { [COOKIES.githubConnectionBinding]: binding };
  if (session) cookies[COOKIES.session] = session;
  return cookies;
}

function expectFeedback(res: LightMyRequestResponse, provider: string): URL {
  expect(res.statusCode).toBe(302);
  const location = new URL(String(res.headers.location));
  expect(`${location.origin}${location.pathname}`).toBe(`${env.WEB_ORIGIN}/connections`);
  expect(location.searchParams.get("provider")).toBe(provider);
  return location;
}

function bodyExcludes(res: LightMyRequestResponse, secrets: string[]): void {
  const payload = res.payload;
  for (const secret of secrets) {
    expect(payload).not.toContain(secret);
  }
}

beforeAll(async () => {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set for integration tests (see vitest.config.ts)");
  }
  db = createPrismaClient(env.DATABASE_URL);
  mock = createProviderMock();

  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  connectionsConfig = {
    githubApp: {
      appId: "9001",
      slug: "mixcraft-app",
      clientId: "Iv1.test-app-client",
      clientSecret: "test-app-secret",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    },
    vercel: { clientId: "test-vercel-client", clientSecret: "test-vercel-secret" },
  };

  app = buildApp({ fetchImpl: mock.fetchImpl, connectionsConfig });
  unconfiguredApp = buildApp({
    fetchImpl: mock.fetchImpl,
    connectionsConfig: { githubApp: null, vercel: null },
  });
  await app.ready();
  await unconfiguredApp.ready();

  const userA = await loginWith({ id: userAGithubId, login: loginA, name: "Connection User A" });
  sessionA = userA.session;
  csrfA = userA.csrf;
  const userB = await loginWith({ id: userBGithubId, login: loginB, name: "Connection User B" });
  sessionB = userB.session;
  csrfB = userB.csrf;

  const userARecord = await db.user.findUnique({ where: { githubUserId: userAGithubId } });
  if (!userARecord) throw new Error("userA was not created by the login flow");
  userAId = userARecord.id;
});

afterAll(async () => {
  const users = await db.user.findMany({
    where: { githubUserId: { in: [userAGithubId, userBGithubId] } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  await db.auditEvent.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { createdAt: { gte: suiteStart }, action: { startsWith: "connection." } },
      ],
    },
  });
  await db.user.deleteMany({ where: { githubUserId: { in: [userAGithubId, userBGithubId] } } });
  await db.oauthTransaction.deleteMany({ where: { createdAt: { gte: suiteStart } } });
  await app.close();
  await unconfiguredApp.close();
  await db.$disconnect();
});

describe("authentication and validation gates", () => {
  it("401s GET /api/connections without a session", async () => {
    const res = await app.inject({ method: "GET", url: API_ROUTES.connections });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("401s POST /api/connections/npm without a session (CSRF satisfied)", async () => {
    const res = await app.inject({
      method: "POST",
      url: API_ROUTES.npmConnect,
      cookies: { [COOKIES.csrf]: csrfA },
      headers: { [CSRF_HEADER]: csrfA },
      payload: { token: NPM_TOKEN },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("403s POST /api/connections/npm without the CSRF header", async () => {
    const res = await app.inject({
      method: "POST",
      url: API_ROUTES.npmConnect,
      cookies: { [COOKIES.session]: sessionA },
      payload: { token: NPM_TOKEN },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("PERMISSION_DENIED");
  });

  it("400s POST /api/connections/npm with an empty token", async () => {
    const res = await app.inject({
      method: "POST",
      url: API_ROUTES.npmConnect,
      ...authed(sessionA, csrfA),
      payload: { token: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("401s the GitHub and Vercel start routes without a session", async () => {
    const github = await app.inject({ method: "GET", url: API_ROUTES.githubConnectStart });
    expect(github.statusCode).toBe(401);
    const vercel = await app.inject({ method: "GET", url: API_ROUTES.vercelConnectStart });
    expect(vercel.statusCode).toBe(401);
  });

  it("404s refresh and disconnect for malformed connection ids", async () => {
    const refresh = await app.inject({
      method: "POST",
      url: "/api/connections/npm/not-a-uuid/refresh",
      ...authed(sessionA, csrfA),
    });
    expect(refresh.statusCode).toBe(400);
    expect(refresh.json().error.code).toBe("VALIDATION_FAILED");

    const disconnect = await app.inject({
      method: "DELETE",
      url: "/api/connections/npm/not-a-uuid",
      ...authed(sessionA, csrfA),
    });
    expect(disconnect.statusCode).toBe(400);
    expect(disconnect.json().error.code).toBe("VALIDATION_FAILED");
  });
});

describe("npm connect, refresh, disconnect", () => {
  it("connects with a valid token, storing it encrypted and never echoing it", async () => {
    const res = await app.inject({
      method: "POST",
      url: API_ROUTES.npmConnect,
      ...authed(sessionA, csrfA),
      payload: { token: NPM_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const connection = res.json().data.connection;
    expect(connection.provider).toBe("npm");
    expect(connection.status).toBe("connected");
    expect(connection.accountName).toBe("acme-publisher");
    expect(connection.lastValidatedAt).toBeTruthy();
    bodyExcludes(res, [NPM_TOKEN]);
    npmConnectionId = connection.id;

    const row = await db.providerConnection.findUnique({ where: { id: npmConnectionId } });
    expect(row?.status).toBe("connected");

    const credential = await db.encryptedCredential.findUnique({
      where: { connectionId: npmConnectionId },
    });
    expect(credential).not.toBeNull();
    expect(credential?.credentialKind).toBe("npm_token");
    expect(decryptRow(credential!)).toBe(NPM_TOKEN);
    expect(Buffer.from(credential!.ciphertext).toString("utf8")).not.toContain(NPM_TOKEN);

    const audit = await db.auditEvent.findMany({
      where: {
        userId: row?.userId,
        connectionId: npmConnectionId,
        action: CONNECTION_AUDIT_ACTIONS.connect,
        outcome: "success",
      },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.resourceType ?? null).toBeNull();
  });

  it("reports configured providers and lists the npm connection", async () => {
    const res = await app.inject({
      method: "GET",
      url: API_ROUTES.connections,
      cookies: { [COOKIES.session]: sessionA },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.configured).toEqual({ github: true, npm: true, vercel: true });
    const npm = body.data.connections.find(
      (entry: { provider: string }) => entry.provider === "npm",
    );
    expect(npm?.accountName).toBe("acme-publisher");
    bodyExcludes(res, [NPM_TOKEN]);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("upserts instead of duplicating on repeated connects", async () => {
    const res = await app.inject({
      method: "POST",
      url: API_ROUTES.npmConnect,
      ...authed(sessionA, csrfA),
      payload: { token: NPM_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.connection.id).toBe(npmConnectionId);

    const rows = await db.providerConnection.findMany({
      where: { userId: userAId, provider: "npm", providerAccountId: "acme-publisher" },
    });
    expect(rows).toHaveLength(1);
  });

  it("maps a rejected npm token to VALIDATION_FAILED and audits the failure", async () => {
    mock.state.npmMode = "fail";
    try {
      const res = await app.inject({
        method: "POST",
        url: API_ROUTES.npmConnect,
        ...authed(sessionA, csrfA),
        payload: { token: "npm_rejected_token" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_FAILED");
      bodyExcludes(res, ["npm_rejected_token"]);
    } finally {
      mock.state.npmMode = "ok";
    }
    const failures = await db.auditEvent.findMany({
      where: {
        action: CONNECTION_AUDIT_ACTIONS.connect,
        outcome: "failure",
        metadata: { path: ["reason"], equals: "invalid_token" },
        createdAt: { gte: suiteStart },
      },
    });
    expect(failures.length).toBeGreaterThan(0);
  });

  it("maps an unreachable npm registry to PROVIDER_UNAVAILABLE", async () => {
    mock.state.npmMode = "unreachable";
    try {
      const res = await app.inject({
        method: "POST",
        url: API_ROUTES.npmConnect,
        ...authed(sessionA, csrfA),
        payload: { token: NPM_TOKEN },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("PROVIDER_UNAVAILABLE");
    } finally {
      mock.state.npmMode = "ok";
    }
  });

  it("refreshes the npm connection by re-validating the stored token", async () => {
    const before = await db.providerConnection.findUnique({ where: { id: npmConnectionId } });
    const res = await app.inject({
      method: "POST",
      url: `/api/connections/npm/${npmConnectionId}/refresh`,
      ...authed(sessionA, csrfA),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.connection.status).toBe("connected");
    bodyExcludes(res, [NPM_TOKEN]);

    const after = await db.providerConnection.findUnique({ where: { id: npmConnectionId } });
    expect(after?.lastValidatedAt?.getTime()).toBeGreaterThanOrEqual(
      before?.lastValidatedAt?.getTime() ?? 0,
    );
    expect(mock.callsOf("npm_whoami").length).toBeGreaterThan(0);
  });

  it("marks the connection expired when a refresh finds the token invalid", async () => {
    mock.state.npmMode = "fail";
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/connections/npm/${npmConnectionId}/refresh`,
        ...authed(sessionA, csrfA),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("CONNECTION_EXPIRED");
    } finally {
      mock.state.npmMode = "ok";
    }
    const row = await db.providerConnection.findUnique({ where: { id: npmConnectionId } });
    expect(row?.status).toBe("expired");

    const audit = await db.auditEvent.findMany({
      where: {
        connectionId: npmConnectionId,
        action: CONNECTION_AUDIT_ACTIONS.validate,
        outcome: "failure",
      },
    });
    expect(audit).toHaveLength(1);
  });

  it("403s disconnect without CSRF, then disconnects and skips npm revocation", async () => {
    const missingCsrf = await app.inject({
      method: "DELETE",
      url: `/api/connections/npm/${npmConnectionId}`,
      cookies: { [COOKIES.session]: sessionA },
    });
    expect(missingCsrf.statusCode).toBe(403);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/connections/npm/${npmConnectionId}`,
      ...authed(sessionA, csrfA),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ disconnected: true });

    expect(await db.providerConnection.findUnique({ where: { id: npmConnectionId } })).toBeNull();
    expect(
      await db.encryptedCredential.findUnique({ where: { connectionId: npmConnectionId } }),
    ).toBeNull();

    const audit = await db.auditEvent.findFirst({
      where: { action: CONNECTION_AUDIT_ACTIONS.disconnect, resourceId: npmConnectionId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.resourceType).toBe("provider_connection");
    expect((audit?.metadata as { revoke?: string })?.revoke).toBe("skipped");
  });
});

describe("GitHub App install flow", () => {
  it("start redirects to the app's install page with a scoped binding cookie", async () => {
    const res = await app.inject({
      method: "GET",
      url: API_ROUTES.githubConnectStart,
      cookies: { [COOKIES.session]: sessionA },
    });
    expect(res.statusCode).toBe(302);
    const location = new URL(String(res.headers.location));
    expect(`${location.origin}${location.pathname}`).toBe(
      "https://github.com/apps/mixcraft-app/installations/new",
    );
    expect(location.searchParams.get("state")).toBeTruthy();

    const binding = findCookie(res, COOKIES.githubConnectionBinding);
    expect(binding).toBeDefined();
    expect(binding?.httpOnly).toBe(true);
    expect(binding?.sameSite?.toLowerCase()).toBe("lax");
    expect(binding?.path).toBe("/api/connections/github");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("answers an unauthenticated callback with an error redirect, not JSON", async () => {
    const { state, binding } = await startGithub(sessionA);
    const res = await app.inject({
      method: "GET",
      url: githubCallbackUrl({
        code: "gh-code",
        state,
        installationId: 500111,
        setupAction: "install",
      }),
      cookies: githubCallbackCookies(binding),
    });
    const location = expectFeedback(res, "github");
    expect(location.searchParams.get("error")).toBe("AUTHENTICATION_REQUIRED");
    expect(findCookie(res, COOKIES.githubConnectionBinding)?.value).toBe("");
  });

  it("redirects VALIDATION_FAILED when the binding cookie is missing", async () => {
    const { state } = await startGithub(sessionA);
    const res = await app.inject({
      method: "GET",
      url: githubCallbackUrl({
        code: "gh-code",
        state,
        installationId: 500111,
        setupAction: "install",
      }),
      cookies: { [COOKIES.session]: sessionA },
    });
    const location = expectFeedback(res, "github");
    expect(location.searchParams.get("error")).toBe("VALIDATION_FAILED");
  });

  it("redirects PERMISSION_DENIED when the binding does not match", async () => {
    const { state } = await startGithub(sessionA);
    const res = await app.inject({
      method: "GET",
      url: githubCallbackUrl({
        code: "gh-code",
        state,
        installationId: 500111,
        setupAction: "install",
      }),
      cookies: githubCallbackCookies("attacker-binding", sessionA),
    });
    const location = expectFeedback(res, "github");
    expect(location.searchParams.get("error")).toBe("PERMISSION_DENIED");
  });

  it("completes the installation flow and stores an encrypted user token", async () => {
    mock.state.githubUser = { id: userAGithubId, login: loginA, name: "Connection User A" };
    const { state, binding } = await startGithub(sessionA);
    const res = await app.inject({
      method: "GET",
      url: githubCallbackUrl({
        code: "gh-code",
        state,
        installationId: 500111,
        setupAction: "install",
      }),
      cookies: githubCallbackCookies(binding, sessionA),
    });
    const location = expectFeedback(res, "github");
    expect(location.searchParams.get("status")).toBe("connected");

    const connection = await db.providerConnection.findFirst({
      where: { provider: "github", providerAccountId: "500111" },
    });
    expect(connection).not.toBeNull();
    expect(connection?.providerAccountName).toBe("acme-corp");
    expect(connection?.status).toBe("connected");
    expect(connection?.scopes).toEqual(["contents:read", "metadata:read"]);
    githubConnectionId = connection?.id as string;

    const credential = await db.encryptedCredential.findUnique({
      where: { connectionId: githubConnectionId },
    });
    expect(decryptRow(credential!)).toBe("gho_mock_token");

    const installation = await db.githubInstallation.findUnique({
      where: { installationId: 500111n },
    });
    expect(installation?.connectionId).toBe(githubConnectionId);
    expect(installation?.accountLogin).toBe("acme-corp");

    // The install-flow exchange has no PKCE verifier or redirect_uri to send.
    const tokenCalls = mock.callsOf("github_token");
    expect(tokenCalls.at(-1)?.detail).toBe("no_verifier");
    expect(mock.callsOf("github_installation").length).toBeGreaterThan(0);
    expect(mock.callsOf("github_association").length).toBeGreaterThan(0);
  });

  it("lists the connected GitHub account without exposing the token", async () => {
    const res = await app.inject({
      method: "GET",
      url: API_ROUTES.connections,
      cookies: { [COOKIES.session]: sessionA },
    });
    const github = res
      .json()
      .data.connections.find((entry: { provider: string }) => entry.provider === "github");
    expect(github?.status).toBe("connected");
    expect(github?.accountName).toBe("acme-corp");
    bodyExcludes(res, ["gho_mock_token"]);
  });

  it("rejects a replayed callback with OPERATION_CONFLICT feedback", async () => {
    const { state, binding } = await startGithub(sessionA);
    const url = githubCallbackUrl({
      code: "gh-code",
      state,
      installationId: 500111,
      setupAction: "install",
    });
    const first = await app.inject({
      method: "GET",
      url,
      cookies: githubCallbackCookies(binding, sessionA),
    });
    expect(expectFeedback(first, "github").searchParams.get("status")).toBe("connected");

    const replay = await app.inject({
      method: "GET",
      url,
      cookies: githubCallbackCookies(binding, sessionA),
    });
    const location = expectFeedback(replay, "github");
    expect(location.searchParams.get("error")).toBe("OPERATION_CONFLICT");
  });

  it("completes when GitHub omits state (binding-only path)", async () => {
    const { binding } = await startGithub(sessionA);
    const res = await app.inject({
      method: "GET",
      url: githubCallbackUrl({ code: "gh-code", installationId: 500444, setupAction: "install" }),
      cookies: githubCallbackCookies(binding, sessionA),
    });
    expect(expectFeedback(res, "github").searchParams.get("status")).toBe("connected");

    const connection = await db.providerConnection.findFirst({
      where: { provider: "github", providerAccountId: "500444" },
    });
    expect(connection?.providerAccountName).toBe("acme-corp");
  });

  it("answers setup_action=request with VALIDATION_FAILED feedback", async () => {
    const { state, binding } = await startGithub(sessionA);
    const res = await app.inject({
      method: "GET",
      url: githubCallbackUrl({
        code: "gh-code",
        state,
        installationId: 500555,
        setupAction: "request",
      }),
      cookies: githubCallbackCookies(binding, sessionA),
    });
    const location = expectFeedback(res, "github");
    expect(location.searchParams.get("error")).toBe("VALIDATION_FAILED");
    expect(
      await db.providerConnection.findFirst({ where: { providerAccountId: "500555" } }),
    ).toBeNull();
  });

  it("rejects an installation that is not associated with the authorizing user", async () => {
    mock.state.association = "missing";
    try {
      const { state, binding } = await startGithub(sessionA);
      const res = await app.inject({
        method: "GET",
        url: githubCallbackUrl({
          code: "gh-code",
          state,
          installationId: 500666,
          setupAction: "install",
        }),
        cookies: githubCallbackCookies(binding, sessionA),
      });
      const location = expectFeedback(res, "github");
      expect(location.searchParams.get("error")).toBe("PERMISSION_DENIED");
      expect(
        await db.providerConnection.findFirst({ where: { providerAccountId: "500666" } }),
      ).toBeNull();

      const audit = await db.auditEvent.findFirst({
        where: {
          action: CONNECTION_AUDIT_ACTIONS.connect,
          outcome: "failure",
          metadata: { path: ["reason"], equals: "permission_denied" },
          createdAt: { gte: suiteStart },
        },
      });
      expect(audit).not.toBeNull();
    } finally {
      mock.state.association = "ok";
    }
  });

  it("maps a missing installation to VALIDATION_FAILED feedback", async () => {
    mock.state.missingInstallations.add(500777);
    try {
      const { state, binding } = await startGithub(sessionA);
      const res = await app.inject({
        method: "GET",
        url: githubCallbackUrl({
          code: "gh-code",
          state,
          installationId: 500777,
          setupAction: "install",
        }),
        cookies: githubCallbackCookies(binding, sessionA),
      });
      const location = expectFeedback(res, "github");
      expect(location.searchParams.get("error")).toBe("VALIDATION_FAILED");
    } finally {
      mock.state.missingInstallations.delete(500777);
    }
  });

  it("maps a failed token exchange to PROVIDER_UNAVAILABLE feedback", async () => {
    mock.state.githubTokenMode = "fail";
    try {
      const { state, binding } = await startGithub(sessionA);
      const res = await app.inject({
        method: "GET",
        url: githubCallbackUrl({
          code: "bad-code",
          state,
          installationId: 500888,
          setupAction: "install",
        }),
        cookies: githubCallbackCookies(binding, sessionA),
      });
      const location = expectFeedback(res, "github");
      expect(location.searchParams.get("error")).toBe("PROVIDER_UNAVAILABLE");
      expect(
        await db.providerConnection.findFirst({ where: { providerAccountId: "500888" } }),
      ).toBeNull();
    } finally {
      mock.state.githubTokenMode = "ok";
    }
  });

  it("refreshes from the App installation and updates scopes", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/connections/github/${githubConnectionId}/refresh`,
      ...authed(sessionA, csrfA),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.connection.status).toBe("connected");
    bodyExcludes(res, ["gho_mock_token"]);
  });

  it("marks the connection expired when the installation is suspended on refresh", async () => {
    mock.state.githubInstallation.suspended = true;
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/connections/github/${githubConnectionId}/refresh`,
        ...authed(sessionA, csrfA),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("CONNECTION_EXPIRED");
    } finally {
      mock.state.githubInstallation.suspended = false;
    }
    const row = await db.providerConnection.findUnique({ where: { id: githubConnectionId } });
    expect(row?.status).toBe("expired");
  });
});

describe("installation ownership conflicts", () => {
  it("rejects a second account connecting an installation another account owns", async () => {
    // userB owns installation 500222 first.
    const startB = await app.inject({
      method: "GET",
      url: API_ROUTES.githubConnectStart,
      cookies: { [COOKIES.session]: sessionB },
    });
    expect(startB.statusCode).toBe(302);
    const stateB = new URL(String(startB.headers.location)).searchParams.get("state") as string;
    const bindingB = requireCookieValue(startB, COOKIES.githubConnectionBinding);

    mock.state.githubUser = { id: userBGithubId, login: loginB, name: "Connection User B" };
    const connectB = await app.inject({
      method: "GET",
      url: githubCallbackUrl({
        code: "gh-code",
        state: stateB,
        installationId: 500222,
        setupAction: "install",
      }),
      cookies: { [COOKIES.session]: sessionB, [COOKIES.githubConnectionBinding]: bindingB },
    });
    expect(expectFeedback(connectB, "github").searchParams.get("status")).toBe("connected");

    // userA tries the same installation.
    mock.state.githubUser = { id: userAGithubId, login: loginA, name: "Connection User A" };
    const { state: stateA, binding: bindingA } = await startGithub(sessionA);
    const conflict = await app.inject({
      method: "GET",
      url: githubCallbackUrl({
        code: "gh-code",
        state: stateA,
        installationId: 500222,
        setupAction: "install",
      }),
      cookies: githubCallbackCookies(bindingA, sessionA),
    });
    const location = expectFeedback(conflict, "github");
    expect(location.searchParams.get("error")).toBe("OPERATION_CONFLICT");

    const installation = await db.githubInstallation.findUnique({
      where: { installationId: 500222n },
    });
    const ownerConnection = await db.providerConnection.findUnique({
      where: { id: installation?.connectionId as string },
    });
    expect(ownerConnection?.userId).not.toBe(
      (await db.user.findUnique({ where: { githubUserId: userAGithubId } }))?.id,
    );
  });
});

describe("Vercel OAuth flow", () => {
  it("start redirects to Vercel with PKCE and a scoped binding cookie", async () => {
    const res = await app.inject({
      method: "GET",
      url: API_ROUTES.vercelConnectStart,
      cookies: { [COOKIES.session]: sessionA },
    });
    expect(res.statusCode).toBe(302);
    const location = new URL(String(res.headers.location));
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toBeTruthy();
    expect(location.searchParams.get("scope")).toBe("openid profile offline_access");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("redirect_uri")).toBe(
      `${env.API_BASE_URL}${API_ROUTES.vercelConnectCallback}`,
    );

    const binding = findCookie(res, COOKIES.vercelConnectionBinding);
    expect(binding?.httpOnly).toBe(true);
    expect(binding?.path).toBe("/api/connections/vercel");
  });

  it("reports the provider as unconfigured when credentials are absent", async () => {
    const start = await unconfiguredApp.inject({
      method: "GET",
      url: API_ROUTES.vercelConnectStart,
      cookies: { [COOKIES.session]: sessionA },
    });
    expect(start.statusCode).toBe(503);
    expect(start.json().error.code).toBe("PROVIDER_UNAVAILABLE");

    const githubStart = await unconfiguredApp.inject({
      method: "GET",
      url: API_ROUTES.githubConnectStart,
      cookies: { [COOKIES.session]: sessionA },
    });
    expect(githubStart.statusCode).toBe(503);
    expect(githubStart.json().error.code).toBe("PROVIDER_UNAVAILABLE");

    const list = await unconfiguredApp.inject({
      method: "GET",
      url: API_ROUTES.connections,
      cookies: { [COOKIES.session]: sessionA },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.configured).toEqual({ github: false, npm: true, vercel: false });
  });

  it("completes the callback and stores rotated Vercel tokens encrypted", async () => {
    const start = await app.inject({
      method: "GET",
      url: API_ROUTES.vercelConnectStart,
      cookies: { [COOKIES.session]: sessionA },
    });
    const state = new URL(String(start.headers.location)).searchParams.get("state") as string;
    const binding = requireCookieValue(start, COOKIES.vercelConnectionBinding);

    const res = await app.inject({
      method: "GET",
      url: `${API_ROUTES.vercelConnectCallback}?${new URLSearchParams({
        code: "vercel-code",
        state,
      })}`,
      cookies: { [COOKIES.session]: sessionA, [COOKIES.vercelConnectionBinding]: binding },
    });
    const location = expectFeedback(res, "vercel");
    expect(location.searchParams.get("status")).toBe("connected");

    const connection = await db.providerConnection.findFirst({
      where: { provider: "vercel", userId: userAId },
      orderBy: { createdAt: "desc" },
    });
    expect(connection?.providerAccountName).toBe("acme-vercel");
    vercelConnectionId = connection?.id as string;

    const credential = await db.encryptedCredential.findUnique({
      where: { connectionId: vercelConnectionId },
    });
    expect(credential?.credentialKind).toBe("vercel_oauth_tokens");
    const stored = JSON.parse(decryptRow(credential!)) as {
      accessToken: string;
      refreshToken: string;
    };
    expect(stored.accessToken).toBe("va_token_1");
    expect(stored.refreshToken).toBe("vr_token_1");

    const tokenCall = mock
      .callsOf("vercel_token")
      .find((call) => call.detail === "authorization_code");
    expect(tokenCall).toBeDefined();
  });

  it("answers a replayed callback with OPERATION_CONFLICT feedback", async () => {
    const start = await app.inject({
      method: "GET",
      url: API_ROUTES.vercelConnectStart,
      cookies: { [COOKIES.session]: sessionA },
    });
    const state = new URL(String(start.headers.location)).searchParams.get("state") as string;
    const binding = requireCookieValue(start, COOKIES.vercelConnectionBinding);
    const url = `${API_ROUTES.vercelConnectCallback}?${new URLSearchParams({
      code: "vercel-code",
      state,
    })}`;
    const cookies = { [COOKIES.session]: sessionA, [COOKIES.vercelConnectionBinding]: binding };

    const first = await app.inject({ method: "GET", url, cookies });
    expect(expectFeedback(first, "vercel").searchParams.get("status")).toBe("connected");

    const replay = await app.inject({ method: "GET", url, cookies });
    const location = expectFeedback(replay, "vercel");
    expect(location.searchParams.get("error")).toBe("OPERATION_CONFLICT");
  });

  it("refreshes by rotating and re-encrypting the stored token pair", async () => {
    const before = await db.encryptedCredential.findUnique({
      where: { connectionId: vercelConnectionId },
    });
    const beforeTokens = JSON.parse(decryptRow(before!)) as {
      accessToken: string;
      refreshToken: string;
    };

    const res = await app.inject({
      method: "POST",
      url: `/api/connections/vercel/${vercelConnectionId}/refresh`,
      ...authed(sessionA, csrfA),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.connection.status).toBe("connected");
    bodyExcludes(res, [beforeTokens.accessToken, beforeTokens.refreshToken]);

    const credential = await db.encryptedCredential.findUnique({
      where: { connectionId: vercelConnectionId },
    });
    const stored = JSON.parse(decryptRow(credential!)) as {
      accessToken: string;
      refreshToken: string;
    };
    expect(stored.accessToken).toMatch(/^va_token_\d+$/);
    expect(stored.refreshToken).toMatch(/^vr_token_\d+$/);
    expect(stored.accessToken).not.toBe(beforeTokens.accessToken);
    expect(stored.refreshToken).not.toBe(beforeTokens.refreshToken);
    expect(mock.callsOf("vercel_token").some((call) => call.detail === "refresh_token")).toBe(true);
  });

  it("marks the connection expired when the refresh grant is rejected", async () => {
    mock.state.vercelRefreshMode = "fail";
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/connections/vercel/${vercelConnectionId}/refresh`,
        ...authed(sessionA, csrfA),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("CONNECTION_EXPIRED");
    } finally {
      mock.state.vercelRefreshMode = "ok";
    }
    const row = await db.providerConnection.findUnique({ where: { id: vercelConnectionId } });
    expect(row?.status).toBe("expired");
  });

  it("revokes remotely on disconnect and records the outcome", async () => {
    const revokesBefore = mock.callsOf("vercel_revoke").length;
    const res = await app.inject({
      method: "DELETE",
      url: `/api/connections/vercel/${vercelConnectionId}`,
      ...authed(sessionA, csrfA),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ disconnected: true });

    expect(
      await db.providerConnection.findUnique({ where: { id: vercelConnectionId } }),
    ).toBeNull();
    expect(
      await db.encryptedCredential.findUnique({ where: { connectionId: vercelConnectionId } }),
    ).toBeNull();
    expect(mock.callsOf("vercel_revoke").length).toBe(revokesBefore + 1);

    const audit = await db.auditEvent.findFirst({
      where: { action: CONNECTION_AUDIT_ACTIONS.disconnect, resourceId: vercelConnectionId },
      orderBy: { createdAt: "desc" },
    });
    expect((audit?.metadata as { revoke?: string })?.revoke).toBe("ok");
    expect(audit?.connectionId).toBeNull();
  });
});

describe("cross-account access and contract details", () => {
  it("404s refresh and disconnect for another account's connection", async () => {
    const refresh = await app.inject({
      method: "POST",
      url: `/api/connections/github/${githubConnectionId}/refresh`,
      ...authed(sessionB, csrfB),
    });
    expect(refresh.statusCode).toBe(404);
    expect(refresh.json().error.code).toBe("RESOURCE_NOT_FOUND");

    const disconnect = await app.inject({
      method: "DELETE",
      url: `/api/connections/github/${githubConnectionId}`,
      ...authed(sessionB, csrfB),
    });
    expect(disconnect.statusCode).toBe(404);
    expect(disconnect.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("keeps each account's connection list isolated", async () => {
    const listB = await app.inject({
      method: "GET",
      url: API_ROUTES.connections,
      cookies: { [COOKIES.session]: sessionB },
    });
    expect(listB.statusCode).toBe(200);
    const providersB = listB
      .json()
      .data.connections.map((entry: { provider: string }) => entry.provider);
    expect(providersB).toEqual(["github"]);
    bodyExcludes(listB, ["gho_mock_token"]);
  });
});
