import { defineConfig } from "vitest/config";

/**
 * Environment for the API test suite. ENCRYPTION_KEY is a fixed, clearly
 * test-only 32-byte key — never reuse it anywhere outside tests.
 */
const TEST_ENCRYPTION_KEY = Buffer.alloc(32).toString("base64");

export default defineConfig({
  test: {
    environment: "node",
    env: {
      NODE_ENV: "test",
      WEB_ORIGIN: "http://localhost:5173",
      API_BASE_URL: "http://127.0.0.1:3001",
      DATABASE_URL: "postgresql://postgres:mixcraft@127.0.0.1:5432/mixcraft?schema=public",
      GITHUB_CLIENT_ID: "test-github-client-id",
      GITHUB_CLIENT_SECRET: "test-github-client-secret",
      ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      SESSION_IDLE_TTL_MINUTES: "720",
      SESSION_ABSOLUTE_TTL_MINUTES: "10080",
      OAUTH_TRANSACTION_TTL_SECONDS: "600",
    },
  },
});
