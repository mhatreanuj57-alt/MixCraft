import { NPM_REGISTRY } from "../../config/constants.js";
import { NpmClientError } from "./npm.errors.js";

/**
 * Validates a granular access token against the npm registry and returns the
 * account it belongs to. npm exposes no permission-introspection endpoint, so
 * the granted scopes cannot be read back and are not recorded.
 */
export async function verifyNpmToken(
  token: string,
  fetchImpl: typeof fetch,
): Promise<{ username: string }> {
  let response: Response;
  try {
    response = await fetchImpl(NPM_REGISTRY.whoamiUrl, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new NpmClientError("unreachable", "npm registry is unreachable.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new NpmClientError("invalid_token", "npm rejected the access token.");
  }
  if (!response.ok) {
    throw new NpmClientError("unreachable", "npm registry token check failed.");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new NpmClientError("invalid_response", "npm returned an unreadable response.");
  }
  const username =
    typeof payload === "object" && payload !== null
      ? (payload as { username?: unknown }).username
      : undefined;
  if (typeof username !== "string" || username.length === 0) {
    throw new NpmClientError("invalid_response", "npm returned an invalid whoami response.");
  }
  return { username };
}
