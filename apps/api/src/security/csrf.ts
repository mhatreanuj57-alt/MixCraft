import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function csrfTokensMatch(
  cookieToken: string | undefined,
  headerToken: string | undefined,
): boolean {
  if (!cookieToken || !headerToken) {
    return false;
  }
  return timingSafeEqual(digest(cookieToken), digest(headerToken));
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (origin === undefined || origin === "") {
    // Non-browser clients do not send Origin; the double-submit token is still required.
    return true;
  }
  return allowedOrigins.includes(origin);
}
