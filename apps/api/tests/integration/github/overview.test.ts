import { createPrismaClient, type PrismaClient } from "@mixcraft/database";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { API_ROUTES, COOKIES } from "../../../src/config/constants.js";
import { env } from "../../../src/config/env.js";
import type { ConnectionsConfig } from "../../../src/modules/connections/connection.config.js";
import { requireCookieValue } from "../../helpers/http.js";
import { createProviderMock, type ProviderMock } from "../../helpers/provider-mock.js";

const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
const userAGithubId = `93${suffix}01`;
const userBGithubId = `93${suffix}02`;
const userCGithubId = `93${suffix}03`;
const userDGithubId = `93${suffix}04`;
const loginA = `overview-a-${suffix}`;
const loginB = `overview-b-${suffix}`;
const loginC = `overview-c-${suffix}`;
const loginD = `overview-d-${suffix}`;
const installationA = Number(`74${suffix}01`);
const installationC = Number(`74${suffix}03`);
const installationD = Number(`74${suffix}04`);

let db: PrismaClient;
let app: FastifyInstance;
let mock: ProviderMock;

let sessionA = "";
let sessionB = "";
let sessionC = "";
let sessionD = "";
let connectionAId = "";

interface LoginResult {
  session: string;
  csrf: string;
}

async function loginWith(githubUser: {
  id: string;
  login: string;
  name: string;
}): Promise<LoginResult> {
  mock.state.githubUser = githubUser;
  const begin = await app.inject({ method: "GET", url: API_ROUTES.githubLogin });
  expect(begin.statusCode, begin.payload).toBe(302);
  const beginUrl = new URL(String(begin.headers.location));
  const state = beginUrl.searchParams.get("state");
  if (!state) throw new Error("login redirect is missing state");
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

async function startGithub(session: string): Promise<{ state: string; binding: string }> {
  const response = await app.inject({
    method: "GET",
    url: API_ROUTES.githubConnectStart,
    cookies: { [COOKIES.session]: session },
  });
  expect(response.statusCode).toBe(302);
  const location = new URL(String(response.headers.location));
  const state = location.searchParams.get("state");
  if (!state) throw new Error("install redirect is missing state");
  return {
    state,
    binding: requireCookieValue(response, COOKIES.githubConnectionBinding),
  };
}

async function connectGithub(session: string, installationId: number): Promise<void> {
  const { state, binding } = await startGithub(session);
  const query = new URLSearchParams({
    code: "connect-code",
    state,
    installation_id: String(installationId),
    setup_action: "install",
  });
  const response = await app.inject({
    method: "GET",
    url: `${API_ROUTES.githubConnectCallback}?${query.toString()}`,
    cookies: {
      [COOKIES.session]: session,
      [COOKIES.githubConnectionBinding]: binding,
    },
  });
  expect(response.statusCode).toBe(302);
  expect(String(response.headers.location)).toContain("status=connected");
}

function actAs(id: string, login: string, name: string): void {
  mock.state.githubUser = { id, login, name };
}

function bodyExcludes(response: LightMyRequestResponse, secrets: string[]): void {
  for (const secret of secrets) {
    expect(response.payload).not.toContain(secret);
  }
}

async function getOverview(session: string): Promise<LightMyRequestResponse> {
  return app.inject({
    method: "GET",
    url: API_ROUTES.githubOverview,
    cookies: { [COOKIES.session]: session },
  });
}

beforeAll(async () => {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set for integration tests (see vitest.config.ts)");
  }
  db = createPrismaClient(env.DATABASE_URL);
  mock = createProviderMock();
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const connectionsConfig: ConnectionsConfig = {
    githubApp: {
      appId: "9002",
      slug: "mixcraft-overview",
      clientId: "Iv1.test-overview-client",
      clientSecret: "test-overview-secret",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    },
    vercel: null,
  };
  app = buildApp({ fetchImpl: mock.fetchImpl, connectionsConfig });
  await app.ready();

  const userA = await loginWith({ id: userAGithubId, login: loginA, name: "Overview User A" });
  sessionA = userA.session;
  const userB = await loginWith({ id: userBGithubId, login: loginB, name: "Overview User B" });
  sessionB = userB.session;
  const userC = await loginWith({ id: userCGithubId, login: loginC, name: "Overview User C" });
  sessionC = userC.session;
  const userD = await loginWith({ id: userDGithubId, login: loginD, name: "Overview User D" });
  sessionD = userD.session;

  mock.state.githubInstallation.permissions = { contents: "read", metadata: "read" };
  await connectGithub(sessionA, installationA);
  await connectGithub(sessionC, installationC);

  mock.state.githubInstallation.permissions = { metadata: "read" };
  await connectGithub(sessionD, installationD);
  mock.state.githubInstallation.permissions = { contents: "read", metadata: "read" };

  const userARecord = await db.user.findUnique({ where: { githubUserId: userAGithubId } });
  if (!userARecord) throw new Error("user A was not created");
  const userAConnection = await db.providerConnection.findFirst({
    where: { userId: userARecord.id, provider: "github" },
  });
  if (!userAConnection) throw new Error("user A connection was not created");
  connectionAId = userAConnection.id;
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe("GET /api/github/overview", () => {
  it("401s without a session", async () => {
    const response = await app.inject({ method: "GET", url: API_ROUTES.githubOverview });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("returns an honest not-connected payload when GitHub is not linked", async () => {
    const response = await getOverview(sessionB);
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.connection).toBeNull();
    expect(data.repositories).toEqual([]);
    expect(data.commits).toEqual([]);
    expect(data.contributions).toBeNull();
    expect(data.sections.repositories.status).toBe("not_connected");
    expect(data.sections.commits.status).toBe("not_connected");
    expect(data.sections.contributions.status).toBe("not_connected");
  });

  it("returns repositories, commits, contributions, and caches them", async () => {
    actAs(userAGithubId, loginA, "Overview User A");
    const response = await getOverview(sessionA);
    expect(response.statusCode).toBe(200);
    const data = response.json().data;

    expect(data.connection.status).toBe("connected");
    expect(data.account.login).toBe(loginA);
    expect(data.repositories).toHaveLength(2);
    expect(data.repositoryCount).toBe(2);
    expect(data.repositories.some((repository: { private: boolean }) => repository.private)).toBe(
      true,
    );
    expect(data.commits).toHaveLength(3);
    expect(data.sections.repositories.status).toBe("ok");
    expect(data.sections.commits.status).toBe("ok");
    expect(data.sections.contributions.status).toBe("ok");
    expect(data.contributions.totalContributions).toBe(5);
    expect(data.contributions.restrictedContributions).toBe(2);
    expect(data.contributions.hasRestrictedContributions).toBe(true);
    expect(data.contributions.weeks).toHaveLength(1);
    bodyExcludes(response, ["gho_mock_token", "ghs_mock_installation_token"]);

    const callsBeforeCacheHit = mock.calls.length;
    const cached = await getOverview(sessionA);
    expect(cached.statusCode).toBe(200);
    expect(cached.json().data.commits).toHaveLength(3);
    expect(mock.calls.length).toBe(callsBeforeCacheHit);
    expect(await db.resourceCache.count({ where: { connectionId: connectionAId } })).toBe(3);
  });

  it("keeps partial commit results when one repository fails", async () => {
    actAs(userAGithubId, loginA, "Overview User A");
    await db.resourceCache.deleteMany({ where: { connectionId: connectionAId } });
    mock.state.githubCommitFailures.add("acme-corp/alpha");
    try {
      const response = await getOverview(sessionA);
      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data.commits).toHaveLength(1);
      expect(data.sections.commits.status).toBe("ok");
      expect(data.sections.commits.message).toContain("1 repositories could not be read");
    } finally {
      mock.state.githubCommitFailures.clear();
    }
  });

  it("falls back to the authenticated profile when contributions are denied", async () => {
    actAs(userCGithubId, loginC, "Overview User C");
    mock.state.githubGraphqlMode = "fail";
    try {
      const response = await getOverview(sessionC);
      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data.account.login).toBe(loginC);
      expect(data.sections.contributions.status).toBe("permission_required");
      expect(data.contributions).toBeNull();
      expect(data.commits).toHaveLength(3);
      expect(data.sections.commits.status).toBe("ok");
    } finally {
      mock.state.githubGraphqlMode = "ok";
    }
  });

  it("marks commits permission-required when Contents: read was not granted", async () => {
    actAs(userDGithubId, loginD, "Overview User D");
    const response = await getOverview(sessionD);
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.sections.repositories.status).toBe("ok");
    expect(data.sections.commits.status).toBe("permission_required");
    expect(data.sections.commits.message).toContain("Contents: read");
    expect(data.sections.contributions.status).toBe("ok");
  });
});
