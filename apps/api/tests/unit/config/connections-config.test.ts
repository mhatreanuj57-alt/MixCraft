import { describe, expect, it } from "vitest";
import { env, loadEnv, type Env } from "../../../src/config/env.js";
import { loadConnectionsConfig } from "../../../src/modules/connections/connection.config.js";

function envWith(overrides: Partial<Env>): Env {
  return { ...env, ...overrides };
}

describe("loadConnectionsConfig", () => {
  it("returns null providers when no connection credentials are set", () => {
    const config = loadConnectionsConfig();
    expect(config.githubApp).toBeNull();
    expect(config.vercel).toBeNull();
  });

  it("leaves GitHub App and Vercel connections unconfigured in Preview", () => {
    const previewEnv = loadEnv({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      DATABASE_URL: "postgresql://user:pass@preview-db.example:5432/mixcraft",
      ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
      WEB_ORIGIN: "https://mixcraft-preview.example",
      API_BASE_URL: "https://mixcraft-preview.example",
    });

    expect(loadConnectionsConfig(previewEnv)).toEqual({ githubApp: null, vercel: null });
  });

  it("builds the GitHub App config only when all five values are present", () => {
    const config = loadConnectionsConfig(
      envWith({
        GITHUB_APP_ID: "9001",
        GITHUB_APP_SLUG: "mixcraft-app",
        GITHUB_APP_CLIENT_ID: "Iv1.client",
        GITHUB_APP_CLIENT_SECRET: "app-secret",
        GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
      }),
    );
    expect(config.githubApp).toEqual({
      appId: "9001",
      slug: "mixcraft-app",
      clientId: "Iv1.client",
      clientSecret: "app-secret",
      privateKey: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
    });
    expect(config.vercel).toBeNull();
  });

  it("treats a partially configured GitHub App as not configured", () => {
    const config = loadConnectionsConfig(
      envWith({
        GITHUB_APP_ID: "9001",
        GITHUB_APP_SLUG: "mixcraft-app",
        GITHUB_APP_CLIENT_ID: "Iv1.client",
        GITHUB_APP_CLIENT_SECRET: "app-secret",
        GITHUB_APP_PRIVATE_KEY: undefined,
      }),
    );
    expect(config.githubApp).toBeNull();
  });

  it("treats a partially configured Vercel app as not configured", () => {
    const config = loadConnectionsConfig(
      envWith({ VERCEL_CLIENT_ID: "vercel-client", VERCEL_CLIENT_SECRET: undefined }),
    );
    expect(config.vercel).toBeNull();
  });

  it("builds the Vercel config when both values are present", () => {
    const config = loadConnectionsConfig(
      envWith({ VERCEL_CLIENT_ID: "vercel-client", VERCEL_CLIENT_SECRET: "vercel-secret" }),
    );
    expect(config.vercel).toEqual({
      clientId: "vercel-client",
      clientSecret: "vercel-secret",
    });
  });
});
