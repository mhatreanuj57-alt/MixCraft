import type { ApiSuccessResponse } from "@mixcraft/shared";
import {
  githubCallbackQuerySchema,
  type GithubCallbackQuery,
  type LogoutPayload,
  type MePayload,
} from "@mixcraft/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { API_ROUTES, COOKIES } from "../config/constants.js";
import { env } from "../config/env.js";
import { statusForError } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  csrfCookieOptions,
  oauthBindingCookieOptions,
  sessionCookieOptions,
} from "../modules/auth/auth.cookies.js";
import {
  completeGithubLogin,
  performLogout,
  startGithubLogin,
  type AuthDeps,
} from "../modules/auth/auth.service.js";
import { ApiError } from "../types/api-error.js";
import { feedbackUrl, prefersHtml } from "./feedback.js";

export interface AuthRoutesOptions {
  fetchImpl?: typeof fetch;
}

const AUTH_RATE_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } };

export async function authRoutes(
  app: FastifyInstance,
  options: AuthRoutesOptions = {},
): Promise<void> {
  const fetchImpl: typeof fetch = options.fetchImpl ?? fetch;

  function depsFor(request: FastifyRequest): AuthDeps {
    return {
      db: app.database.db,
      fetchImpl,
      log: request.log,
      requestId: String(request.id),
    };
  }

  // Auth responses must never be cached.
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  app.get(API_ROUTES.githubLogin, { config: AUTH_RATE_LIMIT }, async (request, reply) => {
    try {
      const { authorizeUrl, binding } = await startGithubLogin(depsFor(request));
      reply.setCookie(COOKIES.oauthBinding, binding, oauthBindingCookieOptions());
      return reply.redirect(authorizeUrl);
    } catch (error) {
      if (!prefersHtml(request)) {
        throw error;
      }
      const { code } = statusForError(error);
      return reply.redirect(feedbackUrl("github", { error: code }));
    }
  });

  app.get(API_ROUTES.githubLoginCallback, { config: AUTH_RATE_LIMIT }, async (request, reply) => {
    try {
      const parsed = githubCallbackQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ApiError("VALIDATION_FAILED", "Invalid OAuth callback query.");
      }
      const query: GithubCallbackQuery = parsed.data;
      if (query.error) {
        throw new ApiError("VALIDATION_FAILED", "GitHub sign-in was not completed.");
      }
      if (!query.code || !query.state) {
        throw new ApiError("VALIDATION_FAILED", "Missing OAuth callback parameters.");
      }

      const result = await completeGithubLogin(depsFor(request), {
        code: query.code,
        state: query.state,
        binding: request.cookies[COOKIES.oauthBinding],
      });

      reply.setCookie(COOKIES.session, result.session.secret, sessionCookieOptions());
      reply.setCookie(COOKIES.csrf, result.csrfToken, csrfCookieOptions());
      reply.clearCookie(COOKIES.oauthBinding, oauthBindingCookieOptions());
      return reply.redirect(env.WEB_ORIGIN);
    } catch (error) {
      if (!prefersHtml(request)) {
        throw error;
      }
      reply.clearCookie(COOKIES.oauthBinding, oauthBindingCookieOptions());
      const { code } = statusForError(error);
      return reply.redirect(feedbackUrl("github", { error: code }));
    }
  });

  app.post(API_ROUTES.logout, { preHandler: requireAuth }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) {
      throw new ApiError("AUTHENTICATION_REQUIRED", "Authentication is required.");
    }
    await performLogout(depsFor(request), {
      sessionId: auth.session.id,
      userId: auth.user.id,
    });
    reply.clearCookie(COOKIES.session, { path: "/" });
    reply.clearCookie(COOKIES.csrf, { path: "/" });
    const response: ApiSuccessResponse<LogoutPayload> = {
      data: { loggedOut: true },
      meta: { requestId: request.id },
    };
    return reply.send(response);
  });

  app.get(API_ROUTES.me, { preHandler: requireAuth }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) {
      throw new ApiError("AUTHENTICATION_REQUIRED", "Authentication is required.");
    }
    const payload: MePayload = {
      id: auth.user.id,
      githubLogin: auth.user.githubLogin,
      displayName: auth.user.displayName,
      avatarUrl: auth.user.avatarUrl,
      createdAt: auth.user.createdAt.toISOString(),
      lastLoginAt: auth.user.lastLoginAt?.toISOString() ?? null,
    };
    const response: ApiSuccessResponse<MePayload> = {
      data: payload,
      meta: { requestId: request.id },
    };
    return reply.send(response);
  });
}
