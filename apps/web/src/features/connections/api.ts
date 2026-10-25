import type {
  ApiErrorBody,
  ApiSuccessResponse,
  ConnectionRefreshPayload,
  ConnectionsListPayload,
  DisconnectPayload,
  NormalizedErrorCode,
  ProviderId,
} from "@mixcraft/shared";

export const CONNECTIONS_ROUTES = {
  list: "/api/connections",
  npmConnect: "/api/connections/npm",
  githubStart: "/api/connections/github/start",
  vercelStart: "/api/connections/vercel/start",
  refresh: (provider: ProviderId, connectionId: string) =>
    `/api/connections/${provider}/${connectionId}/refresh`,
  disconnect: (provider: ProviderId, connectionId: string) =>
    `/api/connections/${provider}/${connectionId}`,
} as const;

export const CSRF_COOKIE = "mixcraft_csrf";
export const CSRF_HEADER = "x-csrf-token";

export type RequestOutcome<TPayload> =
  | { kind: "ok"; payload: TPayload }
  | { kind: "unauthenticated" }
  | { kind: "failure"; code: NormalizedErrorCode | null; message: string };

type RejectedOutcome =
  | { kind: "unauthenticated" }
  | { kind: "failure"; code: NormalizedErrorCode | null; message: string };

export function readCookieValue(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

export function csrfHeaders(csrfToken: string | null): Record<string, string> {
  return csrfToken ? { [CSRF_HEADER]: csrfToken } : {};
}

async function rejectedOutcome(response: Response): Promise<RejectedOutcome> {
  let code: NormalizedErrorCode | null = null;
  let message = `Request failed with HTTP ${response.status}.`;
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (body.error?.code && body.error.message) {
      code = body.error.code;
      message = body.error.message;
    }
  } catch {
    // Non-JSON error body: keep the generic HTTP message.
  }
  if (code === "AUTHENTICATION_REQUIRED" || (response.status === 401 && code === null)) {
    return { kind: "unauthenticated" };
  }
  return { kind: "failure", code, message };
}

async function parseEnvelope<TPayload>(response: Response): Promise<RequestOutcome<TPayload>> {
  if (response.ok) {
    const body = (await response.json()) as ApiSuccessResponse<TPayload>;
    return { kind: "ok", payload: body.data };
  }
  return rejectedOutcome(response);
}

export async function fetchConnectionsList(
  fetchImpl: typeof fetch = fetch,
): Promise<RequestOutcome<ConnectionsListPayload>> {
  const response = await fetchImpl(CONNECTIONS_ROUTES.list, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  return parseEnvelope<ConnectionsListPayload>(response);
}

export interface MutationOptions {
  fetchImpl?: typeof fetch;
  csrfToken: string | null;
}

export async function connectNpmToken(
  token: string,
  options: MutationOptions,
): Promise<RequestOutcome<ConnectionRefreshPayload>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(CONNECTIONS_ROUTES.npmConnect, {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...csrfHeaders(options.csrfToken),
    },
    body: JSON.stringify({ token }),
  });
  return parseEnvelope<ConnectionRefreshPayload>(response);
}

export async function refreshConnection(
  provider: ProviderId,
  connectionId: string,
  options: MutationOptions,
): Promise<RequestOutcome<ConnectionRefreshPayload>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(CONNECTIONS_ROUTES.refresh(provider, connectionId), {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      ...csrfHeaders(options.csrfToken),
    },
  });
  return parseEnvelope<ConnectionRefreshPayload>(response);
}

export async function disconnectConnection(
  provider: ProviderId,
  connectionId: string,
  options: MutationOptions,
): Promise<RequestOutcome<DisconnectPayload>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(CONNECTIONS_ROUTES.disconnect(provider, connectionId), {
    method: "DELETE",
    credentials: "include",
    headers: {
      accept: "application/json",
      ...csrfHeaders(options.csrfToken),
    },
  });
  return parseEnvelope<DisconnectPayload>(response);
}
