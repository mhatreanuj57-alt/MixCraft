import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config/env.js")>();
  return {
    ...actual,
    env: { ...actual.env, GITHUB_CLIENT_ID: undefined, GITHUB_CLIENT_SECRET: undefined },
  };
});

const { startGithubLogin } = await import("../../../src/modules/auth/auth.service.js");

const testLog = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => testLog,
} as unknown as FastifyBaseLogger;

const deps = {
  db: null,
  fetchImpl: (() => {}) as unknown as typeof fetch,
  log: testLog,
  requestId: "req-1",
};

describe("startGithubLogin configuration guards", () => {
  it("fails with SERVICE_UNAVAILABLE when the database is not configured", async () => {
    await expect(startGithubLogin(deps)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
    });
  });

  it("fails with PROVIDER_UNAVAILABLE when GitHub credentials are missing", async () => {
    await expect(
      startGithubLogin({ ...deps, db: {} as NonNullable<typeof deps.db> }),
    ).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      status: 503,
      message: "GitHub sign-in is not configured on this server.",
    });
  });
});
