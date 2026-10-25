import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../../src/app.js";
import { API_ROUTES, COOKIES } from "../../../src/config/constants.js";
import { env } from "../../../src/config/env.js";

vi.mock("../../../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config/env.js")>();
  return {
    ...actual,
    env: { ...actual.env, GITHUB_CLIENT_ID: undefined, GITHUB_CLIENT_SECRET: undefined },
  };
});

const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

let app: FastifyInstance;

beforeAll(async () => {
  expect(env.GITHUB_CLIENT_ID).toBeUndefined();
  expect(env.GITHUB_CLIENT_SECRET).toBeUndefined();
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/auth/github with missing OAuth credentials", () => {
  it("redirects browser navigations to the Connections feedback banner", async () => {
    const res = await app.inject({
      method: "GET",
      url: API_ROUTES.githubLogin,
      headers: { accept: BROWSER_ACCEPT },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(
      `${env.WEB_ORIGIN}/connections?provider=github&error=PROVIDER_UNAVAILABLE`,
    );
    expect(res.cookies.some((cookie) => cookie.name === COOKIES.oauthBinding)).toBe(false);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("returns the JSON envelope when the client prefers application/json", async () => {
    const res = await app.inject({
      method: "GET",
      url: API_ROUTES.githubLogin,
      headers: { accept: "application/json" },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(body.error.message).toBe("GitHub sign-in is not configured on this server.");
    expect(body.error.requestId).toBeTruthy();
  });

  it("returns the JSON envelope when no Accept header is sent (API default)", async () => {
    const res = await app.inject({ method: "GET", url: API_ROUTES.githubLogin });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(res.cookies.some((cookie) => cookie.name === COOKIES.oauthBinding)).toBe(false);
  });
});
