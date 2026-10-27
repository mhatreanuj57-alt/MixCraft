import type {
  ApiErrorBody,
  ApiSuccessResponse,
  GitHubOverviewPayload,
  NormalizedErrorCode,
} from "@mixcraft/shared";

export const GITHUB_OVERVIEW_ROUTE = "/api/github/overview";

export type OverviewOutcome =
  | { kind: "ok"; payload: GitHubOverviewPayload }
  | { kind: "unauthenticated" }
  | { kind: "failure"; code: NormalizedErrorCode | null; message: string };

export interface FetchOverviewOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

async function rejectedOutcome(response: Response): Promise<OverviewOutcome> {
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

export async function fetchGitHubOverview(
  options: FetchOverviewOptions = {},
): Promise<OverviewOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(GITHUB_OVERVIEW_ROUTE, {
    credentials: "include",
    headers: { accept: "application/json" },
    signal: options.signal,
  });

  if (!response.ok) {
    return rejectedOutcome(response);
  }

  const body = (await response.json()) as ApiSuccessResponse<GitHubOverviewPayload>;
  return { kind: "ok", payload: body.data };
}
