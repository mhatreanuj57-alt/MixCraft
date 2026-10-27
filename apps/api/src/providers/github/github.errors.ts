export type GitHubAuthErrorReason = "token_exchange" | "profile_fetch";

export class GitHubAuthError extends Error {
  readonly reason: GitHubAuthErrorReason;

  constructor(reason: GitHubAuthErrorReason, message: string) {
    super(message);
    this.name = "GitHubAuthError";
    this.reason = reason;
  }
}

export type GitHubAppErrorReason =
  | "jwt"
  | "installation_fetch"
  | "installation_token"
  | "association_check"
  | "token_revoke"
  | "unexpected_response";

/**
 * `network` = GitHub unreachable (temporary); `not_found` = the installation no
 * longer exists (credential no longer valid); `rejected` = GitHub refused the
 * request (usually a server-side App credential problem).
 */
export type GitHubAppErrorKind = "network" | "not_found" | "rejected";

export class GitHubAppError extends Error {
  readonly reason: GitHubAppErrorReason;
  readonly kind: GitHubAppErrorKind;

  constructor(
    reason: GitHubAppErrorReason,
    message: string,
    kind: GitHubAppErrorKind = "rejected",
  ) {
    super(message);
    this.name = "GitHubAppError";
    this.reason = reason;
    this.kind = kind;
  }
}

export type GitHubOverviewErrorKind =
  | "network"
  | "permission"
  | "not_found"
  | "rate_limited"
  | "unexpected";

export class GitHubOverviewError extends Error {
  readonly kind: GitHubOverviewErrorKind;
  readonly status: number | null;

  constructor(kind: GitHubOverviewErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "GitHubOverviewError";
    this.kind = kind;
    this.status = status;
  }
}
