import type { Env } from "../../config/env.js";
import { env as defaultEnv } from "../../config/env.js";
import type { GithubAppConfig } from "../../providers/github/github.app.js";

export interface VercelAppConfig {
  clientId: string;
  clientSecret: string;
}

export interface ConnectionsConfig {
  githubApp: GithubAppConfig | null;
  vercel: VercelAppConfig | null;
}

/**
 * Connection providers are optional: a partially or unset configuration is
 * reported honestly as "not configured" (503 PROVIDER_UNAVAILABLE) instead of
 * failing at boot, so environments without provider credentials still run.
 */
export function loadConnectionsConfig(source: Env = defaultEnv): ConnectionsConfig {
  const githubApp: GithubAppConfig | null =
    source.GITHUB_APP_ID &&
    source.GITHUB_APP_SLUG &&
    source.GITHUB_APP_CLIENT_ID &&
    source.GITHUB_APP_CLIENT_SECRET &&
    source.GITHUB_APP_PRIVATE_KEY
      ? {
          appId: source.GITHUB_APP_ID,
          slug: source.GITHUB_APP_SLUG,
          clientId: source.GITHUB_APP_CLIENT_ID,
          clientSecret: source.GITHUB_APP_CLIENT_SECRET,
          privateKey: source.GITHUB_APP_PRIVATE_KEY,
        }
      : null;
  const vercel: VercelAppConfig | null =
    source.VERCEL_CLIENT_ID && source.VERCEL_CLIENT_SECRET
      ? { clientId: source.VERCEL_CLIENT_ID, clientSecret: source.VERCEL_CLIENT_SECRET }
      : null;
  return { githubApp, vercel };
}
