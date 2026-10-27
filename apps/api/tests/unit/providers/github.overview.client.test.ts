import { describe, expect, it } from "vitest";
import {
  fetchContributionCalendar,
  listAuthoredCommits,
  listInstallationRepositories,
  mapCommit,
  mapRepository,
} from "../../../src/providers/github/github.overview.client.js";
import type { GitHubRepositorySummary } from "@mixcraft/shared";

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const rawRepository = {
  id: 101,
  name: "alpha",
  full_name: "acme/alpha",
  owner: { login: "acme" },
  private: true,
  description: "Internal repository",
  language: "TypeScript",
  stargazers_count: 12,
  forks_count: 3,
  open_issues_count: 2,
  html_url: "https://github.com/acme/alpha",
  default_branch: "main",
  pushed_at: "2026-10-26T12:00:00Z",
  updated_at: "2026-10-26T12:00:00Z",
};

const repository: GitHubRepositorySummary = {
  id: 101,
  name: "alpha",
  fullName: "acme/alpha",
  owner: "acme",
  private: true,
  description: "Internal repository",
  language: "TypeScript",
  stargazersCount: 12,
  forksCount: 3,
  openIssuesCount: 2,
  htmlUrl: "https://github.com/acme/alpha",
  defaultBranch: "main",
  pushedAt: "2026-10-26T12:00:00Z",
  updatedAt: "2026-10-26T12:00:00Z",
};

const rawCommit = {
  sha: "a".repeat(40),
  html_url: "https://github.com/acme/alpha/commit/aaaaaaaa",
  commit: {
    message: "Add overview endpoint\n\nLonger explanation",
    author: { date: "2026-10-26T11:00:00Z" },
  },
  author: { login: "conn-user" },
};

describe("GitHub overview mapping", () => {
  it("maps repository and commit payloads", () => {
    expect(mapRepository(rawRepository)).toEqual(repository);
    expect(mapCommit(rawCommit, repository)).toEqual({
      sha: "a".repeat(40),
      message: "Add overview endpoint",
      htmlUrl: "https://github.com/acme/alpha/commit/aaaaaaaa",
      authorLogin: "conn-user",
      authoredAt: "2026-10-26T11:00:00Z",
      repository: {
        fullName: "acme/alpha",
        htmlUrl: "https://github.com/acme/alpha",
        private: true,
      },
    });
  });

  it("rejects incomplete payloads", () => {
    expect(mapRepository({ ...rawRepository, full_name: undefined })).toBeNull();
    expect(mapRepository(null)).toBeNull();
    expect(mapCommit({ ...rawCommit, sha: undefined }, repository)).toBeNull();
  });
});

describe("listInstallationRepositories", () => {
  it("deduplicates repositories and reports the total count", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      return jsonResponse({
        total_count: 1,
        repositories: [rawRepository, rawRepository],
      });
    };

    const result = await listInstallationRepositories("ghs_token", fetchImpl);
    expect(result.repositories).toEqual([repository]);
    expect(result.totalCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(seen[0]).toContain("per_page=100");
  });

  it("maps a permission rejection", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ message: "Resource not accessible by integration" }, 403);
    await expect(listInstallationRepositories("ghs_token", fetchImpl)).rejects.toMatchObject({
      kind: "permission",
      status: 403,
    });
  });

  it("maps a rate-limit rejection", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ message: "API rate limit exceeded" }, 403, {
        "x-ratelimit-remaining": "0",
      });
    await expect(listInstallationRepositories("ghs_token", fetchImpl)).rejects.toMatchObject({
      kind: "rate_limited",
    });
  });
});

describe("listAuthoredCommits", () => {
  it("requests commits filtered by author and maps them", async () => {
    let requestedUrl = "";
    const fetchImpl: typeof fetch = async (input) => {
      requestedUrl = String(input);
      return jsonResponse([rawCommit]);
    };

    const commits = await listAuthoredCommits("ghs_token", repository, "conn-user", fetchImpl);
    expect(commits).toHaveLength(1);
    expect(requestedUrl).toContain("/repos/acme/alpha/commits?author=conn-user&per_page=3");
  });

  it("treats an empty repository conflict as no commits", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ message: "Git Repository is empty." }, 409);
    await expect(listAuthoredCommits("ghs_token", repository, "conn-user", fetchImpl)).resolves.toEqual(
      [],
    );
  });
});

describe("fetchContributionCalendar", () => {
  it("maps viewer, restricted counts, and contribution levels", async () => {
    let authorization = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      authorization = (init?.headers as Record<string, string>)["Authorization"] ?? "";
      return jsonResponse({
        data: {
          viewer: {
            login: "conn-user",
            name: "Connection User",
            avatarUrl: "https://avatars.example/conn-user.png",
            contributionsCollection: {
              restrictedContributionsCount: 3,
              hasAnyRestrictedContributions: true,
              contributionCalendar: {
                totalContributions: 6,
                weeks: [
                  {
                    contributionDays: [
                      {
                        date: "2026-10-20",
                        contributionCount: 1,
                        contributionLevel: "FIRST_QUARTILE",
                      },
                      {
                        date: "2026-10-21",
                        contributionCount: 5,
                        contributionLevel: "FOURTH_QUARTILE",
                      },
                      {
                        date: "2026-10-22",
                        contributionCount: 0,
                        contributionLevel: "NONE",
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      });
    };

    const result = await fetchContributionCalendar(
      "gho_token",
      new Date("2025-10-27T00:00:00Z"),
      new Date("2026-10-27T00:00:00Z"),
      fetchImpl,
    );
    expect(authorization).toBe("Bearer gho_token");
    expect(result.account).toEqual({
      login: "conn-user",
      name: "Connection User",
      avatarUrl: "https://avatars.example/conn-user.png",
    });
    expect(result.calendar).toEqual({
      totalContributions: 6,
      restrictedContributions: 3,
      hasRestrictedContributions: true,
      weeks: [
        {
          days: [
            { date: "2026-10-20", count: 1, level: 1 },
            { date: "2026-10-21", count: 5, level: 4 },
            { date: "2026-10-22", count: 0, level: 0 },
          ],
        },
      ],
    });
  });

  it("maps GraphQL permission errors", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }],
      });
    await expect(
      fetchContributionCalendar(
        "gho_token",
        new Date("2025-10-27T00:00:00Z"),
        new Date("2026-10-27T00:00:00Z"),
        fetchImpl,
      ),
    ).rejects.toMatchObject({ kind: "permission" });
  });

  it("maps network failures", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(
      fetchContributionCalendar(
        "gho_token",
        new Date("2025-10-27T00:00:00Z"),
        new Date("2026-10-27T00:00:00Z"),
        fetchImpl,
      ),
    ).rejects.toMatchObject({ kind: "network" });
  });
});
