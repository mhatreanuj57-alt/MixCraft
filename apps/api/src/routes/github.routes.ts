import type { ApiSuccessResponse, GitHubOverviewPayload } from "@mixcraft/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { API_ROUTES } from "../config/constants.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  loadConnectionsConfig,
  type ConnectionsConfig,
} from "../modules/connections/connection.config.js";
import { getGitHubOverview } from "../modules/github/github.overview.service.js";
import { ApiError } from "../types/api-error.js";

export interface GitHubOverviewRoutesOptions {
  fetchImpl?: typeof fetch;
  connectionsConfig?: ConnectionsConfig;
}

const GITHUB_OVERVIEW_RATE_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } };

export async function githubOverviewRoutes(
  app: FastifyInstance,
  options: GitHubOverviewRoutesOptions = {},
): Promise<void> {
  const fetchImpl: typeof fetch = options.fetchImpl ?? fetch;
  const config: ConnectionsConfig = options.connectionsConfig ?? loadConnectionsConfig();

  function authenticatedUserId(request: FastifyRequest): string {
    const auth = request.auth;
    if (!auth) {
      throw new ApiError("AUTHENTICATION_REQUIRED", "Authentication is required.");
    }
    return auth.user.id;
  }

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  app.get(
    API_ROUTES.githubOverview,
    { preHandler: requireAuth, config: GITHUB_OVERVIEW_RATE_LIMIT },
    async (request, reply) => {
      const payload = await getGitHubOverview(
        {
          db: app.database.db,
          fetchImpl,
          log: request.log,
          requestId: String(request.id),
          config,
        },
        authenticatedUserId(request),
      );
      const response: ApiSuccessResponse<GitHubOverviewPayload> = {
        data: payload,
        meta: { requestId: request.id },
      };
      return reply.send(response);
    },
  );
}
