export const APP_NAME = "MixCraft";

export const API_ROUTES = {
  health: "/api/health",
  githubLogin: "/api/auth/github",
  githubLoginCallback: "/api/auth/github/callback",
  logout: "/api/auth/logout",
  me: "/api/me",
  connections: "/api/connections",
  npmConnect: "/api/connections/npm",
  githubConnectStart: "/api/connections/github/start",
  githubConnectCallback: "/api/connections/github/callback",
  vercelConnectStart: "/api/connections/vercel/start",
  vercelConnectCallback: "/api/connections/vercel/callback",
  connectionByParam: "/api/connections/:provider/:connectionId",
  connectionRefreshByParam: "/api/connections/:provider/:connectionId/refresh",
} as const;

export const COOKIES = {
  session: "mixcraft_session",
  csrf: "mixcraft_csrf",
  oauthBinding: "mixcraft_oauth_binding",
  githubConnectionBinding: "mixcraft_github_conn_binding",
  vercelConnectionBinding: "mixcraft_vercel_conn_binding",
} as const;

export const CSRF_HEADER = "x-csrf-token";

export const GITHUB_OAUTH = {
  authorizeUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  apiUrl: "https://api.github.com",
} as const;

export const VERCEL_OAUTH = {
  authorizeUrl: "https://vercel.com/oauth/authorize",
  tokenUrl: "https://api.vercel.com/login/oauth/token",
  revokeUrl: "https://api.vercel.com/login/oauth/token/revoke",
  userUrl: "https://api.vercel.com/v2/user",
  scopes: ["openid", "profile", "offline_access"],
} as const;

export const NPM_REGISTRY = {
  whoamiUrl: "https://registry.npmjs.org/-/whoami",
} as const;

export function githubAppInstallUrl(appSlug: string): string {
  return `https://github.com/apps/${appSlug}/installations/new`;
}

export const CONNECTION_AUDIT_ACTIONS = {
  connect: "connection.connect",
  validate: "connection.validate",
  disconnect: "connection.disconnect",
} as const;

export const SESSION_HASH_ALGORITHM = "sha256";
