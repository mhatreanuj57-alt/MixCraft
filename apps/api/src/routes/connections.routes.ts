import type {
  ConnectionParams,
  ConnectionRefreshPayload,
  ConnectionsListPayload,
  DisconnectPayload,
  ApiSuccessResponse,
} from "@mixcraft/shared";
import {
  connectionParamsSchema,
  connectNpmSchema,
  githubConnectionCallbackQuerySchema,
  vercelConnectionCallbackQuerySchema,
} from "@mixcraft/shared";
import type { Provider } from "@mixcraft/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { API_ROUTES, COOKIES } from "../config/constants.js";
import { requireAuth } from "../middleware/require-auth.js";
import { connectionBindingCookieOptions } from "../modules/auth/auth.cookies.js";
import {
  loadConnectionsConfig,
  type ConnectionsConfig,
} from "../modules/connections/connection.config.js";
import {
  completeGithubConnect,
  completeVercelConnect,
  connectNpm,
  disconnectConnection,
  listConnections,
  refreshConnection,
  startGithubConnect,
  startVercelConnect,
  type ConnectionDeps,
} from "../modules/connections/connection.service.js";
import { ApiError } from "../types/api-error.js";
import { feedbackUrl } from "./feedback.js";

export interface ConnectionsRoutesOptions {
  fetchImpl?: typeof fetch;
  connectionsConfig?: ConnectionsConfig;
}

const CONNECTIONS_RATE_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } };

export async function connectionsRoutes(
  app: FastifyInstance,
  options: ConnectionsRoutesOptions = {},
): Promise<void> {
  const fetchImpl: typeof fetch = options.fetchImpl ?? fetch;
  const config: ConnectionsConfig = options.connectionsConfig ?? loadConnectionsConfig();

  function depsFor(request: FastifyRequest): ConnectionDeps {
    return {
      db: app.database.db,
      fetchImpl,
      log: request.log,
      requestId: String(request.id),
      config,
    };
  }

  function authenticatedUserId(request: FastifyRequest): string {
    const auth = request.auth;
    if (!auth) {
      throw new ApiError("AUTHENTICATION_REQUIRED", "Authentication is required.");
    }
    return auth.user.id;
  }

  function sendPayload<T>(request: FastifyRequest, reply: FastifyReply, payload: T): FastifyReply {
    const response: ApiSuccessResponse<T> = {
      data: payload,
      meta: { requestId: request.id },
    };
    return reply.send(response);
  }

  /** OAuth callbacks answer with a redirect to the web app, never JSON. */
  function sendErrorFeedback(
    reply: FastifyReply,
    provider: string,
    errorCode: string,
    clearBinding: () => void,
  ): FastifyReply {
    clearBinding();
    return reply.redirect(feedbackUrl(provider, { error: errorCode }));
  }

  // Connection responses must never be cached.
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  app.get(API_ROUTES.connections, { preHandler: requireAuth }, async (request, reply) => {
    const payload: ConnectionsListPayload = await listConnections(
      depsFor(request),
      authenticatedUserId(request),
    );
    return sendPayload(request, reply, payload);
  });

  app.post(
    API_ROUTES.npmConnect,
    { preHandler: requireAuth, config: CONNECTIONS_RATE_LIMIT },
    async (request, reply) => {
      const parsed = connectNpmSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        throw new ApiError("VALIDATION_FAILED", "Invalid npm connect payload.");
      }
      const connection = await connectNpm(depsFor(request), {
        userId: authenticatedUserId(request),
        token: parsed.data.token,
      });
      const payload: ConnectionRefreshPayload = { connection };
      return sendPayload(request, reply, payload);
    },
  );

  app.get(
    API_ROUTES.githubConnectStart,
    { preHandler: requireAuth, config: CONNECTIONS_RATE_LIMIT },
    async (request, reply) => {
      const { authorizeUrl, binding } = await startGithubConnect(depsFor(request));
      reply.setCookie(
        COOKIES.githubConnectionBinding,
        binding,
        connectionBindingCookieOptions("github"),
      );
      return reply.redirect(authorizeUrl);
    },
  );

  app.get(
    API_ROUTES.githubConnectCallback,
    { config: CONNECTIONS_RATE_LIMIT },
    async (request, reply) => {
      const clearBinding = () =>
        reply.clearCookie(
          COOKIES.githubConnectionBinding,
          connectionBindingCookieOptions("github"),
        );
      const parsed = githubConnectionCallbackQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendErrorFeedback(reply, "github", "VALIDATION_FAILED", clearBinding);
      }
      const query = parsed.data;
      if (query.error || !query.code) {
        return sendErrorFeedback(reply, "github", "VALIDATION_FAILED", clearBinding);
      }
      if (!request.auth) {
        return sendErrorFeedback(reply, "github", "AUTHENTICATION_REQUIRED", clearBinding);
      }

      try {
        await completeGithubConnect(depsFor(request), {
          userId: request.auth.user.id,
          code: query.code,
          state: query.state,
          binding: request.cookies[COOKIES.githubConnectionBinding],
          installationId:
            query.installation_id === undefined ? undefined : Number(query.installation_id),
          setupAction: query.setup_action,
        });
      } catch (error) {
        const errorCode = error instanceof ApiError ? error.code : "OUTCOME_UNKNOWN";
        request.log.error({ err: error, code: errorCode }, "github connection callback failed");
        return sendErrorFeedback(reply, "github", errorCode, clearBinding);
      }

      clearBinding();
      return reply.redirect(feedbackUrl("github", { status: "connected" }));
    },
  );

  app.get(
    API_ROUTES.vercelConnectStart,
    { preHandler: requireAuth, config: CONNECTIONS_RATE_LIMIT },
    async (request, reply) => {
      const { authorizeUrl, binding } = await startVercelConnect(depsFor(request));
      reply.setCookie(
        COOKIES.vercelConnectionBinding,
        binding,
        connectionBindingCookieOptions("vercel"),
      );
      return reply.redirect(authorizeUrl);
    },
  );

  app.get(
    API_ROUTES.vercelConnectCallback,
    { config: CONNECTIONS_RATE_LIMIT },
    async (request, reply) => {
      const clearBinding = () =>
        reply.clearCookie(
          COOKIES.vercelConnectionBinding,
          connectionBindingCookieOptions("vercel"),
        );
      const parsed = vercelConnectionCallbackQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendErrorFeedback(reply, "vercel", "VALIDATION_FAILED", clearBinding);
      }
      const query = parsed.data;
      if (query.error || !query.code || !query.state) {
        return sendErrorFeedback(reply, "vercel", "VALIDATION_FAILED", clearBinding);
      }
      if (!request.auth) {
        return sendErrorFeedback(reply, "vercel", "AUTHENTICATION_REQUIRED", clearBinding);
      }

      try {
        await completeVercelConnect(depsFor(request), {
          userId: request.auth.user.id,
          code: query.code,
          state: query.state,
          binding: request.cookies[COOKIES.vercelConnectionBinding],
        });
      } catch (error) {
        const errorCode = error instanceof ApiError ? error.code : "OUTCOME_UNKNOWN";
        request.log.error({ err: error, code: errorCode }, "vercel connection callback failed");
        return sendErrorFeedback(reply, "vercel", errorCode, clearBinding);
      }

      clearBinding();
      return reply.redirect(feedbackUrl("vercel", { status: "connected" }));
    },
  );

  app.post(
    API_ROUTES.connectionRefreshByParam,
    { preHandler: requireAuth, config: CONNECTIONS_RATE_LIMIT },
    async (request, reply) => {
      const params = parseConnectionParams(request);
      const connection = await refreshConnection(depsFor(request), {
        userId: authenticatedUserId(request),
        provider: params.provider,
        connectionId: params.connectionId,
      });
      const payload: ConnectionRefreshPayload = { connection };
      return sendPayload(request, reply, payload);
    },
  );

  app.delete(
    API_ROUTES.connectionByParam,
    { preHandler: requireAuth, config: CONNECTIONS_RATE_LIMIT },
    async (request, reply) => {
      const params = parseConnectionParams(request);
      const result = await disconnectConnection(depsFor(request), {
        userId: authenticatedUserId(request),
        provider: params.provider,
        connectionId: params.connectionId,
      });
      const payload: DisconnectPayload = result;
      return sendPayload(request, reply, payload);
    },
  );
}

function parseConnectionParams(request: FastifyRequest): {
  provider: Provider;
  connectionId: string;
} {
  const parsed = connectionParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", "Invalid connection parameters.");
  }
  const params: ConnectionParams = parsed.data;
  return { provider: params.provider as Provider, connectionId: params.connectionId };
}
