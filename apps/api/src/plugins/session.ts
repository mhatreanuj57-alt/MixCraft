import type { FastifyInstance } from "fastify";
import { COOKIES } from "../config/constants.js";
import { env } from "../config/env.js";
import { resolveSession } from "../modules/auth/session.service.js";

export function setupSession(app: FastifyInstance): void {
  app.decorateRequest("auth", null);
  app.decorateRequest("authUnavailable", false);

  app.addHook("preHandler", async (request, reply) => {
    request.auth = null;
    request.authUnavailable = false;

    const secret = request.cookies[COOKIES.session];
    if (!secret) {
      return;
    }
    const { db, configured } = app.database;
    if (!configured || !db) {
      request.authUnavailable = true;
      return;
    }
    try {
      const resolved = await resolveSession(db, secret, {
        idleTtlMinutes: env.SESSION_IDLE_TTL_MINUTES,
      });
      if (resolved) {
        request.auth = resolved;
      } else {
        // Unknown/expired/revoked session: drop the stale cookie and leave the
        // request unauthenticated (require-auth answers 401).
        reply.clearCookie(COOKIES.session, { path: "/" });
      }
    } catch (error) {
      request.log.error({ err: error }, "session verification failed");
      request.authUnavailable = true;
    }
  });
}
