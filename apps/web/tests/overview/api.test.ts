import type { GitHubOverviewPayload } from "@mixcraft/shared";
import { describe, expect, it, vi } from "vitest";
import { fetchGitHubOverview, GITHUB_OVERVIEW_ROUTE } from "../../src/features/overview/api";

const payload: GitHubOverviewPayload = {
  connection: {
    id: "connection-1",
    status: "connected",
    accountName: "octocat",
    lastValidatedAt: null,
  },
  account: {
    login: "octocat",
    name: "The Octocat",
    avatarUrl: null,
  },
  repositories: [],
  repositoryCount: 0,
  commits: [],
  contributions: null,
  sections: {
    repositories: { status: "empty", message: null },
    commits: { status: "empty", message: null },
    contributions: { status: "empty", message: null },
  },
  fetchedAt: "2026-01-01T00:00:00.000Z",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchGitHubOverview", () => {
  it("requests the overview route with credentials and returns the payload", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(response({ data: payload }));
    const controller = new AbortController();

    const outcome = await fetchGitHubOverview({
      fetchImpl: fetchMock,
      signal: controller.signal,
    });

    expect(outcome).toEqual({ kind: "ok", payload });
    expect(fetchMock).toHaveBeenCalledWith(
      GITHUB_OVERVIEW_ROUTE,
      expect.objectContaining({
        credentials: "include",
        headers: { accept: "application/json" },
        signal: controller.signal,
      }),
    );
  });

  it("returns unauthenticated for AUTHENTICATION_REQUIRED", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      response(
        {
          error: {
            code: "AUTHENTICATION_REQUIRED",
            message: "Sign in with GitHub to continue.",
          },
        },
        401,
      ),
    );

    const outcome = await fetchGitHubOverview({ fetchImpl: fetchMock });

    expect(outcome).toEqual({ kind: "unauthenticated" });
  });

  it("treats a non-JSON 401 as unauthenticated", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));

    const outcome = await fetchGitHubOverview({ fetchImpl: fetchMock });

    expect(outcome).toEqual({ kind: "unauthenticated" });
  });

  it("preserves normalized API errors", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      response(
        {
          error: {
            code: "PERMISSION_DENIED",
            message: "The GitHub App installation needs Contents: read.",
          },
        },
        403,
      ),
    );

    const outcome = await fetchGitHubOverview({ fetchImpl: fetchMock });

    expect(outcome).toEqual({
      kind: "failure",
      code: "PERMISSION_DENIED",
      message: "The GitHub App installation needs Contents: read.",
    });
  });

  it("falls back to the HTTP status for non-JSON failures", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(new Response("Gateway error", { status: 502 }));

    const outcome = await fetchGitHubOverview({ fetchImpl: fetchMock });

    expect(outcome).toEqual({
      kind: "failure",
      code: null,
      message: "Request failed with HTTP 502.",
    });
  });
});
