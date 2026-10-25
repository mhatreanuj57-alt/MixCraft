import { describe, expect, it } from "vitest";
import { z } from "zod";
import { statusForError } from "../../../src/middleware/error-handler.js";
import { ApiError, ERROR_STATUS } from "../../../src/types/api-error.js";
import { NORMALIZED_ERROR_CODES } from "@mixcraft/shared";

describe("ApiError", () => {
  it("maps every normalized error code to an HTTP status", () => {
    for (const code of NORMALIZED_ERROR_CODES) {
      const error = new ApiError(code, "message");
      expect(error.status).toBe(ERROR_STATUS[code]);
      expect(error.status).toBeGreaterThanOrEqual(400);
      expect(error.status).toBeLessThan(600);
    }
  });

  it("allows an explicit status override", () => {
    expect(new ApiError("VALIDATION_FAILED", "m", 422).status).toBe(422);
  });
});

describe("statusForError", () => {
  it("passes ApiError through unchanged", () => {
    const result = statusForError(new ApiError("PROVIDER_UNAVAILABLE", "GitHub is down"));
    expect(result).toEqual({
      status: 503,
      code: "PROVIDER_UNAVAILABLE",
      message: "GitHub is down",
    });
  });

  it("normalizes ZodError to VALIDATION_FAILED", () => {
    const parsed = z.object({ name: z.string() }).safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const result = statusForError(parsed.error);
    expect(result.code).toBe("VALIDATION_FAILED");
    expect(result.status).toBe(400);
  });

  it("maps Fastify client errors by status code", () => {
    const rateLimit = Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 });
    expect(statusForError(rateLimit).code).toBe("RATE_LIMITED");
    const notFound = Object.assign(new Error("Not Found"), { statusCode: 404 });
    expect(statusForError(notFound).code).toBe("RESOURCE_NOT_FOUND");
    const badRequest = Object.assign(new Error("Bad Request"), { statusCode: 400 });
    expect(statusForError(badRequest).code).toBe("VALIDATION_FAILED");
  });

  it("falls back to INTERNAL_ERROR for unexpected errors", () => {
    const result = statusForError(new Error("boom"));
    expect(result).toEqual({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
    expect(statusForError(undefined).code).toBe("INTERNAL_ERROR");
  });

  it("treats unexpected 5xx fastify errors as INTERNAL_ERROR unless mapped", () => {
    const upstream = Object.assign(new Error("upstream"), { statusCode: 502 });
    expect(statusForError(upstream).code).toBe("OUTCOME_UNKNOWN");
    const generic = Object.assign(new Error("generic"), { statusCode: 500 });
    expect(statusForError(generic).code).toBe("INTERNAL_ERROR");
  });
});
