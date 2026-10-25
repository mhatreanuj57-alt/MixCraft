import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "../types/api-error.js";

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (request.auth) {
    return;
  }
  if (request.authUnavailable || !request.server.database.configured) {
    throw new ApiError("SERVICE_UNAVAILABLE", "Authentication is temporarily unavailable.");
  }
  throw new ApiError("AUTHENTICATION_REQUIRED", "Authentication is required.");
}
