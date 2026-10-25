import type { NormalizedErrorCode } from "@mixcraft/shared";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { ApiError } from "../types/api-error.js";

export interface ErrorEnvelope {
  error: { code: NormalizedErrorCode; message: string; requestId: string };
}

function statusToCode(status: number): NormalizedErrorCode {
  if (status === 400) return "VALIDATION_FAILED";
  if (status === 401) return "AUTHENTICATION_REQUIRED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "RESOURCE_NOT_FOUND";
  if (status === 409) return "OPERATION_CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status === 502) return "OUTCOME_UNKNOWN";
  if (status === 503) return "PROVIDER_UNAVAILABLE";
  if (status >= 400 && status < 500) return "VALIDATION_FAILED";
  return "INTERNAL_ERROR";
}

export function statusForError(error: unknown): {
  status: number;
  code: NormalizedErrorCode;
  message: string;
} {
  if (error instanceof ApiError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof ZodError) {
    return { status: 400, code: "VALIDATION_FAILED", message: "Request validation failed." };
  }
  const statusCode = (error as FastifyError | undefined)?.statusCode;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 600) {
    return {
      status: statusCode,
      code: statusToCode(statusCode),
      message: (error as FastifyError).message || "Request could not be processed.",
    };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
  };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(function errorHandler(
    error: FastifyError,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const requestId = String(request.id);
    const { status, code, message } = statusForError(error);
    if (status >= 500) {
      request.log.error({ err: error }, "request failed");
    }
    const envelope: ErrorEnvelope = { error: { code, message, requestId } };
    return reply.status(status).send(envelope);
  });

  app.setNotFoundHandler((request, reply) => {
    const envelope: ErrorEnvelope = {
      error: {
        code: "RESOURCE_NOT_FOUND",
        message: "Route not found.",
        requestId: String(request.id),
      },
    };
    return reply.status(404).send(envelope);
  });
}
