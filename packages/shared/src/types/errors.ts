export const NORMALIZED_ERROR_CODES = [
  "AUTHENTICATION_REQUIRED",
  "CONNECTION_EXPIRED",
  "PERMISSION_DENIED",
  "RESOURCE_NOT_FOUND",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "OPERATION_CONFLICT",
  "OUTCOME_UNKNOWN",
  // Extensions to the suggested categories in architecture.md §9.
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type NormalizedErrorCode = (typeof NORMALIZED_ERROR_CODES)[number];
