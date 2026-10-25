import type { FastifyRequest } from "fastify";
import { env } from "../config/env.js";

/**
 * Builds the web-app feedback URL for redirect flows: the Connections page
 * parses it into the shared banner, so error presentation lives in one place.
 */
export function feedbackUrl(provider: string, params: Record<string, string>): string {
  const url = new URL("/connections", env.WEB_ORIGIN);
  url.searchParams.set("provider", provider);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * True for browser page navigations (Accept prefers text/html and does not
 * include application/json). API clients and header-less requests are treated
 * as JSON consumers so the error envelope contract stays intact.
 */
export function prefersHtml(request: FastifyRequest): boolean {
  const accept = request.headers.accept;
  if (!accept) {
    return false;
  }
  return accept.includes("text/html") && !accept.includes("application/json");
}
