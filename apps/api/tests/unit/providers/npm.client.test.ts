import { describe, expect, it } from "vitest";
import { NPM_REGISTRY } from "../../../src/config/constants.js";
import { verifyNpmToken } from "../../../src/providers/npm/npm.client.js";
import { NpmClientError } from "../../../src/providers/npm/npm.errors.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("verifyNpmToken", () => {
  it("validates the token with a Bearer header and returns the username", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      seenUrl = String(input);
      const headers = init?.headers as Record<string, string>;
      seenAuth = headers["Authorization"] ?? "";
      return jsonResponse({ username: "acme-publisher" });
    };

    const result = await verifyNpmToken("npm_test_token", fetchImpl);
    expect(result).toEqual({ username: "acme-publisher" });
    expect(seenUrl).toBe(NPM_REGISTRY.whoamiUrl);
    expect(seenAuth).toBe("Bearer npm_test_token");
  });

  it("maps 401/403 to invalid_token", async () => {
    const unauthorized: typeof fetch = async () => jsonResponse({ error: "unauthorized" }, 401);
    await expect(verifyNpmToken("bad", unauthorized)).rejects.toMatchObject({
      reason: "invalid_token",
    });

    const forbidden: typeof fetch = async () => jsonResponse({ error: "forbidden" }, 403);
    await expect(verifyNpmToken("bad", forbidden)).rejects.toMatchObject({
      reason: "invalid_token",
    });
  });

  it("maps network failures and server errors to unreachable", async () => {
    const down: typeof fetch = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(verifyNpmToken("tok", down)).rejects.toBeInstanceOf(NpmClientError);
    await expect(verifyNpmToken("tok", down)).rejects.toMatchObject({ reason: "unreachable" });

    const serverError: typeof fetch = async () => jsonResponse({ error: "boom" }, 500);
    await expect(verifyNpmToken("tok", serverError)).rejects.toMatchObject({
      reason: "unreachable",
    });
  });

  it("maps malformed whoami responses to invalid_response", async () => {
    const empty: typeof fetch = async () => jsonResponse({});
    await expect(verifyNpmToken("tok", empty)).rejects.toMatchObject({
      reason: "invalid_response",
    });

    const notJson: typeof fetch = async () => new Response("<html>nope</html>", { status: 200 });
    await expect(verifyNpmToken("tok", notJson)).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });
});
