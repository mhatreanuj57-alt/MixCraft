import type { CookieSerializeOptions } from "@fastify/cookie";
import { API_ROUTES } from "../../config/constants.js";
import { env } from "../../config/env.js";

const secure = env.NODE_ENV === "production";

export function sessionCookieOptions(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: env.SESSION_ABSOLUTE_TTL_MINUTES * 60,
  };
}

export function csrfCookieOptions(): CookieSerializeOptions {
  return {
    // Readable by the web client so it can echo the token in the x-csrf-token header.
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: env.SESSION_ABSOLUTE_TTL_MINUTES * 60,
  };
}

export function oauthBindingCookieOptions(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: API_ROUTES.githubLogin,
    maxAge: env.OAUTH_TRANSACTION_TTL_SECONDS,
  };
}

/**
 * Provider connection binding cookies are scoped to the provider's
 * start/callback paths so login and connection transactions stay separate
 * (GitHub's installation redirect may not echo `state`, so the binding is the
 * primary CSRF defense there).
 */
export function connectionBindingCookieOptions(
  provider: "github" | "vercel",
): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    // Covers that provider's /start and /callback routes only.
    path: provider === "github" ? "/api/connections/github" : "/api/connections/vercel",
    maxAge: env.OAUTH_TRANSACTION_TTL_SECONDS,
  };
}
