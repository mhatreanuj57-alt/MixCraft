export type NpmClientErrorReason = "unreachable" | "invalid_token" | "invalid_response";

export class NpmClientError extends Error {
  readonly reason: NpmClientErrorReason;

  constructor(reason: NpmClientErrorReason, message: string) {
    super(message);
    this.name = "NpmClientError";
    this.reason = reason;
  }
}
