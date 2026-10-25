import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env.js";

const VALID_KEY = Buffer.alloc(32).toString("base64");

describe("loadEnv", () => {
  it("applies defaults for an empty environment", () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.API_PORT).toBe(3001);
    expect(env.API_HOST).toBe("127.0.0.1");
    expect(env.WEB_ORIGIN).toBe("http://localhost:5173");
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("coerces a valid port string to a number", () => {
    const env = loadEnv({ API_PORT: "4000" });
    expect(env.API_PORT).toBe(4000);
  });

  it("rejects an out-of-range port", () => {
    expect(() => loadEnv({ API_PORT: "0" })).toThrow(/API_PORT/);
  });

  it("rejects an invalid web origin", () => {
    expect(() => loadEnv({ WEB_ORIGIN: "not-a-url" })).toThrow(/WEB_ORIGIN/);
  });

  it("rejects an unknown node environment", () => {
    expect(() => loadEnv({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });

  it("applies Stage 2 session and OAuth defaults", () => {
    const env = loadEnv({});
    expect(env.API_BASE_URL).toBe("http://127.0.0.1:3001");
    expect(env.SESSION_IDLE_TTL_MINUTES).toBe(720);
    expect(env.SESSION_ABSOLUTE_TTL_MINUTES).toBe(10080);
    expect(env.OAUTH_TRANSACTION_TTL_SECONDS).toBe(600);
  });

  it("treats empty strings as unset", () => {
    const env = loadEnv({ DATABASE_URL: "", GITHUB_CLIENT_ID: "" });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.GITHUB_CLIENT_ID).toBeUndefined();
  });

  it("accepts a 32-byte base64 ENCRYPTION_KEY", () => {
    const env = loadEnv({ ENCRYPTION_KEY: VALID_KEY });
    expect(env.ENCRYPTION_KEY).toBe(VALID_KEY);
  });

  it("accepts a 64-character hex ENCRYPTION_KEY", () => {
    const hexKey = "ab".repeat(32);
    const env = loadEnv({ ENCRYPTION_KEY: hexKey });
    expect(env.ENCRYPTION_KEY).toBe(hexKey);
  });

  it("rejects an ENCRYPTION_KEY that does not decode to 32 bytes", () => {
    expect(() => loadEnv({ ENCRYPTION_KEY: "dG9vLXNob3J0" })).toThrow(/ENCRYPTION_KEY/);
    expect(() => loadEnv({ ENCRYPTION_KEY: "not base64!!!" })).toThrow(/ENCRYPTION_KEY/);
  });

  it("rejects an absolute TTL below the idle TTL", () => {
    expect(() =>
      loadEnv({ SESSION_IDLE_TTL_MINUTES: "1000", SESSION_ABSOLUTE_TTL_MINUTES: "500" }),
    ).toThrow(/SESSION_ABSOLUTE_TTL_MINUTES/);
  });

  it("rejects an out-of-range OAuth transaction TTL", () => {
    expect(() => loadEnv({ OAUTH_TRANSACTION_TTL_SECONDS: "30" })).toThrow(
      /OAUTH_TRANSACTION_TTL_SECONDS/,
    );
    expect(() => loadEnv({ OAUTH_TRANSACTION_TTL_SECONDS: "7200" })).toThrow(
      /OAUTH_TRANSACTION_TTL_SECONDS/,
    );
  });

  it("requires GitHub credentials, database, and encryption key in production", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/GITHUB_CLIENT_ID/);
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/ENCRYPTION_KEY/);
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/API_BASE_URL/);
  });

  it("requires GitHub App and Vercel connection credentials in production", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/GITHUB_APP_ID/);
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/GITHUB_APP_SLUG/);
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/GITHUB_APP_CLIENT_ID/);
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/GITHUB_APP_CLIENT_SECRET/);
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/GITHUB_APP_PRIVATE_KEY/);
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/VERCEL_CLIENT_ID/);
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/VERCEL_CLIENT_SECRET/);
  });

  it("leaves connection credentials unset by default", () => {
    const env = loadEnv({});
    expect(env.GITHUB_APP_ID).toBeUndefined();
    expect(env.GITHUB_APP_SLUG).toBeUndefined();
    expect(env.GITHUB_APP_CLIENT_ID).toBeUndefined();
    expect(env.VERCEL_CLIENT_ID).toBeUndefined();
  });

  it("accepts a complete production environment", () => {
    const env = loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@db.example:5432/mixcraft",
      GITHUB_CLIENT_ID: "client-id",
      GITHUB_CLIENT_SECRET: "client-secret",
      ENCRYPTION_KEY: VALID_KEY,
      API_BASE_URL: "https://api.mixcraft.example",
      GITHUB_APP_ID: "123456",
      GITHUB_APP_SLUG: "mixcraft-app",
      GITHUB_APP_CLIENT_ID: "Iv1.app-client-id",
      GITHUB_APP_CLIENT_SECRET: "app-client-secret",
      GITHUB_APP_PRIVATE_KEY:
        "-----BEGIN RSA PRIVATE KEY-----\nmock\n-----END RSA PRIVATE KEY-----",
      VERCEL_CLIENT_ID: "vercel-client-id",
      VERCEL_CLIENT_SECRET: "vercel-client-secret",
    });
    expect(env.API_BASE_URL).toBe("https://api.mixcraft.example");
    expect(env.GITHUB_CLIENT_ID).toBe("client-id");
    expect(env.GITHUB_APP_SLUG).toBe("mixcraft-app");
    expect(env.VERCEL_CLIENT_ID).toBe("vercel-client-id");
  });
});
