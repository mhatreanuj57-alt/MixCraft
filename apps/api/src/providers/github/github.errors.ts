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
  "jwt" | "installation_fetch" | "association_check" | "token_revoke" | "unexpected_response";

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
