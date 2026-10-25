import type { LightMyRequestResponse } from "fastify";

export interface ParsedCookie {
  name: string;
  value: string;
  path?: string;
  httpOnly: boolean;
  sameSite?: string;
}

export function findCookie(res: LightMyRequestResponse, name: string): ParsedCookie | undefined {
  const cookie = res.cookies.find((entry) => entry.name === name);
  if (!cookie) {
    return undefined;
  }
  return {
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    httpOnly: cookie.httpOnly === true,
    sameSite: cookie.sameSite,
  };
}

export function requireCookieValue(res: LightMyRequestResponse, name: string): string {
  const cookie = findCookie(res, name);
  if (!cookie) {
    throw new Error(`Expected response to set cookie "${name}"`);
  }
  return cookie.value;
}
