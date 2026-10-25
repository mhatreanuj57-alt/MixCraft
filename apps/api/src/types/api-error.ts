import type { NormalizedErrorCode } from "@mixcraft/shared";

export const ERROR_STATUS: Record<NormalizedErrorCode, number> = {
  AUTHENTICATION_REQUIRED: 401,
  CONNECTION_EXPIRED: 401,
  PERMISSION_DENIED: 403,
  RESOURCE_NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
  OPERATION_CONFLICT: 409,
  OUTCOME_UNKNOWN: 502,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly code: NormalizedErrorCode;
  readonly status: number;

  constructor(code: NormalizedErrorCode, message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status ?? ERROR_STATUS[code];
  }
}
