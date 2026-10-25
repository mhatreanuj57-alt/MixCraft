import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { COOKIES, CSRF_HEADER } from "../config/constants.js";
import { env } from "../config/env.js";
import { csrfTokensMatch, isOriginAllowed } from "../security/csrf.js";
import { ApiError } from "../types/api-error.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const GLOBAL_RATE_LIMIT = { max: 600, timeWindow: "1 minute" };

function csrfHeaderToken(request: FastifyRequest): string | undefined {
  const value = request.headers[CSRF_HEADER];
  return typeof value === "string" ? value : undefined;
}

export function setupSecurity(app: FastifyInstance): void {
  void app.register(cookie);
  void app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", CSRF_HEADER],
  });
  void app.register(rateLimit, GLOBAL_RATE_LIMIT);

  // Double-submit CSRF + origin allowlist on every unsafe method. Routes may
  // opt out via `config: { skipCsrf: true }` (signature-verified webhooks later).
  app.addHook("preHandler", async (request) => {
    if (!UNSAFE_METHODS.has(request.method)) {
      return;
    }
    if (request.routeOptions.config.skipCsrf === true) {
      return;
    }
    if (!isOriginAllowed(request.headers.origin, [env.WEB_ORIGIN, env.API_BASE_URL])) {
      throw new ApiError("PERMISSION_DENIED", "Request origin is not allowed.");
    }
    if (!csrfTokensMatch(request.cookies[COOKIES.csrf], csrfHeaderToken(request))) {
      throw new ApiError("PERMISSION_DENIED", "Invalid or missing CSRF token.");
    }
  });
}
