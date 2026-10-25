import {
  connectionRedirectQuerySchema,
  PROVIDER_META,
  type NormalizedErrorCode,
  type ProviderId,
} from "@mixcraft/shared";

export interface ConnectionsFeedback {
  provider: ProviderId;
  status?: "connected";
  error?: string;
}

export interface FeedbackBanner {
  tone: "success" | "danger";
  title: string;
  detail: string;
}

const ERROR_MESSAGES: Record<NormalizedErrorCode, string> = {
  AUTHENTICATION_REQUIRED: "Your session expired. Sign in again to continue.",
  CONNECTION_EXPIRED: "This connection expired. Refresh it or connect the account again.",
  PERMISSION_DENIED: "MixCraft does not have access to that account with the current permissions.",
  RESOURCE_NOT_FOUND: "That connection no longer exists. It may have been removed.",
  VALIDATION_FAILED: "The provider rejected these connection details.",
  RATE_LIMITED: "The provider is rate limiting MixCraft. Try again in a moment.",
  PROVIDER_UNAVAILABLE:
    "The provider could not be reached, or this server is missing its credentials for it.",
  OPERATION_CONFLICT: "That installation already belongs to another MixCraft account.",
  OUTCOME_UNKNOWN: "The provider answered in an unexpected way. Check the connection status.",
  SERVICE_UNAVAILABLE: "This action is temporarily unavailable. Try again shortly.",
  INTERNAL_ERROR: "Something went wrong on the MixCraft server.",
};

const FALLBACK_MESSAGE = "The connection could not be completed.";

export function providerLabel(provider: ProviderId): string {
  const meta = PROVIDER_META.find((entry) => entry.id === provider);
  return meta ? meta.label : provider;
}

export function connectionErrorMessage(code: string): string {
  return (ERROR_MESSAGES as Record<string, string>)[code] ?? FALLBACK_MESSAGE;
}

export function parseConnectionsFeedback(search: string): ConnectionsFeedback | null {
  const query = new URLSearchParams(search);
  if (![...query.keys()].length) {
    return null;
  }
  const parsed = connectionRedirectQuerySchema.safeParse(Object.fromEntries(query.entries()));
  if (!parsed.success) {
    return null;
  }
  const data = parsed.data;
  if (!data.provider) {
    return null;
  }
  return { provider: data.provider, status: data.status, error: data.error };
}

export function feedbackBanner(feedback: ConnectionsFeedback): FeedbackBanner {
  const label = providerLabel(feedback.provider);
  if (feedback.error) {
    return {
      tone: "danger",
      title: `${label} connection failed`,
      detail: connectionErrorMessage(feedback.error),
    };
  }
  if (feedback.status === "connected") {
    return {
      tone: "success",
      title: `${label} connected`,
      detail: `${label} is now linked to this workspace.`,
    };
  }
  return {
    tone: "success",
    title: `${label} updated`,
    detail: `${label} connection state changed. Review the status below.`,
  };
}

export function connectionStatusTone(
  status: "connected" | "disconnected" | "pending" | "expired",
): "connected" | "attention" | "idle" {
  if (status === "connected") return "connected";
  if (status === "expired" || status === "pending") return "attention";
  return "idle";
}
