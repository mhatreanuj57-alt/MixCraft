import Fastify from "fastify";
import { env } from "./config/env.js";
import { registerErrorHandler } from "./middleware/error-handler.js";
import { setupDatabase } from "./plugins/database.js";
import { setupSecurity } from "./plugins/security.js";
import { setupSession } from "./plugins/session.js";
import { authRoutes, type AuthRoutesOptions } from "./routes/auth.routes.js";
import { connectionsRoutes, type ConnectionsRoutesOptions } from "./routes/connections.routes.js";
import {
  githubOverviewRoutes,
  type GitHubOverviewRoutesOptions,
} from "./routes/github.routes.js";
import { healthRoutes } from "./routes/health.routes.js";

export type BuildAppOptions = AuthRoutesOptions &
  ConnectionsRoutesOptions &
  GitHubOverviewRoutesOptions;

export function buildApp(options: BuildAppOptions = {}) {
  const logLevel =
    env.NODE_ENV === "production" ? "info" : env.NODE_ENV === "test" ? "silent" : "debug";
  const app = Fastify({
    logger: {
      level: logLevel,
      // Never write credentials or session material to logs (architecture §9/§15).
      redact: {
        paths: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
        censor: "[REDACTED]",
      },
    },
    genReqId: () => crypto.randomUUID(),
  });

  // Order matters: database decoration, security/session hooks, and the error
  // handler must be in place before any route is registered (Fastify routes
  // capture the hook lists that exist at registration time).
  setupDatabase(app);
  setupSecurity(app);
  setupSession(app);
  registerErrorHandler(app);

  void app.register(healthRoutes);
  void app.register(authRoutes, { fetchImpl: options.fetchImpl });
  void app.register(connectionsRoutes, {
    fetchImpl: options.fetchImpl,
    connectionsConfig: options.connectionsConfig,
  });
  void app.register(githubOverviewRoutes, {
    fetchImpl: options.fetchImpl,
    connectionsConfig: options.connectionsConfig,
  });

  return app;
}
