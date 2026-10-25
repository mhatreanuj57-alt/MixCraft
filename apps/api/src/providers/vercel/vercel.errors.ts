export type VercelAuthErrorReason =
  "authorize" | "token_exchange" | "refresh" | "revoke" | "profile_fetch";

/**
 * `network` = Vercel unreachable (temporary); `rejected` = Vercel refused the
 * request (invalid/expired code, token, or refresh grant).
 */
export type VercelAuthErrorKind = "network" | "rejected";

export class VercelAuthError extends Error {
  readonly reason: VercelAuthErrorReason;
  readonly kind: VercelAuthErrorKind;

  constructor(
    reason: VercelAuthErrorReason,
    message: string,
    kind: VercelAuthErrorKind = "rejected",
  ) {
    super(message);
    this.name = "VercelAuthError";
    this.reason = reason;
    this.kind = kind;
  }
}
