import type { ConnectionRecord, ConnectionsListPayload } from "@mixcraft/shared";
import { describe, expect, it, vi } from "vitest";
import {
  connectNpmToken,
  csrfHeaders,
  disconnectConnection,
  fetchConnectionsList,
  readCookieValue,
  refreshConnection,
} from "../../src/features/connections/api";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const connection: ConnectionRecord = {
  id: "9c9f6a52-0f2f-4c46-9f0f-2b3d3a7a1111",
  provider: "npm",
  status: "connected",
  accountName: "acme-publisher",
  lastValidatedAt: "2026-10-25T12:00:00.000Z",
  createdAt: "2026-10-25T12:00:00.000Z",
};

const listPayload: ConnectionsListPayload = {
  connections: [connection],
  configured: { github: true, npm: true, vercel: false },
};

describe("readCookieValue", () => {
  it("reads a named cookie from a cookie header string", () => {
    const cookies = "mixcraft_session=abc; mixcraft_csrf=tok%2F1; other=x";
    expect(readCookieValue(cookies, "mixcraft_csrf")).toBe("tok/1");
    expect(readCookieValue(cookies, "missing")).toBeNull();
    expect(readCookieValue("malformed", "mixcraft_csrf")).toBeNull();
  });
});

describe("csrfHeaders", () => {
  it("omits the header when no token is available", () => {
    expect(csrfHeaders(null)).toEqual({});
    expect(csrfHeaders("token")).toEqual({ "x-csrf-token": "token" });
  });
});

describe("fetchConnectionsList", () => {
  it("returns the payload on success", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: listPayload, meta: { requestId: "req-1" } }));
    const outcome = await fetchConnectionsList(fetchImpl);
    expect(outcome).toEqual({ kind: "ok", payload: listPayload });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/connections",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("maps 401 to the unauthenticated outcome", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "AUTHENTICATION_REQUIRED", message: "Sign in", requestId: "r" } },
          401,
        ),
      );
    const outcome = await fetchConnectionsList(fetchImpl);
    expect(outcome).toEqual({ kind: "unauthenticated" });
  });
});

describe("refreshConnection", () => {
  it("POSTs to the provider-specific refresh route with the CSRF header", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { connection }, meta: { requestId: "req-2" } }));
    const outcome = await refreshConnection("npm", connection.id, {
      fetchImpl,
      csrfToken: "csrf-token",
    });
    expect(outcome.kind).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/connections/npm/${connection.id}/refresh`,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ "x-csrf-token": "csrf-token" }),
      }),
    );
  });

  it("surfaces CONNECTION_EXPIRED as a failure code", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "CONNECTION_EXPIRED", message: "expired", requestId: "r" } },
          401,
        ),
      );
    const outcome = await refreshConnection("vercel", connection.id, {
      fetchImpl,
      csrfToken: null,
    });
    expect(outcome).toEqual({
      kind: "failure",
      code: "CONNECTION_EXPIRED",
      message: "expired",
    });
  });

  it("passes through other API errors with their code", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "RESOURCE_NOT_FOUND", message: "gone", requestId: "r" } },
          404,
        ),
      );
    const outcome = await refreshConnection("github", connection.id, {
      fetchImpl,
      csrfToken: null,
    });
    expect(outcome).toEqual({ kind: "failure", code: "RESOURCE_NOT_FOUND", message: "gone" });
  });

  it("falls back to a generic message for non-JSON failures", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html>proxy error</html>", { status: 502 }));
    const outcome = await refreshConnection("npm", connection.id, {
      fetchImpl,
      csrfToken: null,
    });
    expect(outcome.kind).toBe("failure");
    if (outcome.kind === "failure") {
      expect(outcome.code).toBeNull();
      expect(outcome.message).toBe("Request failed with HTTP 502.");
    }
  });
});

describe("disconnectConnection", () => {
  it("DELETEs the connection and returns the confirmation payload", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ data: { disconnected: true }, meta: { requestId: "req-3" } }),
      );
    const outcome = await disconnectConnection("vercel", connection.id, {
      fetchImpl,
      csrfToken: "csrf-token",
    });
    expect(outcome).toEqual({ kind: "ok", payload: { disconnected: true } });
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/connections/vercel/${connection.id}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("connectNpmToken", () => {
  it("POSTs the token as JSON and never returns it", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { connection }, meta: { requestId: "req-4" } }));
    const outcome = await connectNpmToken("npm_secret_token", {
      fetchImpl,
      csrfToken: "csrf-token",
    });
    expect(outcome.kind).toBe("ok");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/connections/npm");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ token: "npm_secret_token" }));
    expect(JSON.stringify(outcome)).not.toContain("npm_secret_token");
  });

  it("maps a rejected token to VALIDATION_FAILED", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "VALIDATION_FAILED", message: "bad token", requestId: "r" } },
          400,
        ),
      );
    const outcome = await connectNpmToken("bad", { fetchImpl, csrfToken: "csrf-token" });
    expect(outcome).toEqual({ kind: "failure", code: "VALIDATION_FAILED", message: "bad token" });
  });
});
