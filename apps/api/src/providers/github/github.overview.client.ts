import type {
  GitHubAccountSummary,
  GitHubCommitSummary,
  GitHubContributionCalendar,
  GitHubContributionDay,
  GitHubContributionLevel,
  GitHubContributionWeek,
  GitHubRepositorySummary,
} from "@mixcraft/shared";
import { GITHUB_OAUTH } from "../../config/constants.js";
import { GitHubOverviewError } from "./github.errors.js";

const API_VERSION = "2022-11-28";
const MAX_REPOSITORY_PAGES = 3;
const REPOSITORIES_PER_PAGE = 100;

const CONTRIBUTIONS_QUERY = `
  query MixCraftContributions($from: DateTime!, $to: DateTime!) {
    viewer {
      login
      name
      avatarUrl
      contributionsCollection(from: $from, to: $to) {
        restrictedContributionsCount
        hasAnyRestrictedContributions
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
              contributionLevel
            }
          }
        }
      }
    }
  }
`;

export interface InstallationRepositoriesResult {
  repositories: GitHubRepositorySummary[];
  totalCount: number;
  truncated: boolean;
}

export interface ContributionCalendarResult {
  account: GitHubAccountSummary;
  calendar: GitHubContributionCalendar;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function apiHeaders(token: string, accept = "application/vnd.github+json"): Record<string, string> {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "MixCraft-Dev",
  };
}

function responseError(response: Response, section: string): GitHubOverviewError {
  if (response.status === 401 || response.status === 403) {
    if (response.headers.get("x-ratelimit-remaining") === "0") {
      return new GitHubOverviewError(
        "rate_limited",
        `GitHub rate-limited the ${section} request.`,
        response.status,
      );
    }
    return new GitHubOverviewError(
      "permission",
      `GitHub denied the ${section} request for this connection.`,
      response.status,
    );
  }
  if (response.status === 404) {
    return new GitHubOverviewError(
      "not_found",
      `GitHub could not find the requested ${section} resource.`,
      response.status,
    );
  }
  if (response.status === 429) {
    return new GitHubOverviewError(
      "rate_limited",
      `GitHub rate-limited the ${section} request.`,
      response.status,
    );
  }
  return new GitHubOverviewError(
    "unexpected",
    `GitHub returned HTTP ${response.status} for the ${section} request.`,
    response.status,
  );
}

async function readJson(response: Response, section: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new GitHubOverviewError(
      "unexpected",
      `GitHub returned an unreadable ${section} response.`,
      response.status,
    );
  }
}

export function mapRepository(value: unknown): GitHubRepositorySummary | null {
  const repository = asRecord(value);
  if (!repository) return null;
  const owner = asRecord(repository.owner);
  const id = asNumber(repository.id);
  const name = asString(repository.name);
  const fullName = asString(repository.full_name);
  const ownerLogin = asString(owner?.login);
  const htmlUrl = asString(repository.html_url);
  const defaultBranch = asString(repository.default_branch);
  if (
    id === null ||
    !name ||
    !fullName ||
    !ownerLogin ||
    !htmlUrl ||
    !defaultBranch ||
    typeof repository.private !== "boolean"
  ) {
    return null;
  }
  return {
    id,
    name,
    fullName,
    owner: ownerLogin,
    private: repository.private,
    description: asString(repository.description),
    language: asString(repository.language),
    stargazersCount: asNumber(repository.stargazers_count) ?? 0,
    forksCount: asNumber(repository.forks_count) ?? 0,
    openIssuesCount: asNumber(repository.open_issues_count) ?? 0,
    htmlUrl,
    defaultBranch,
    pushedAt: asString(repository.pushed_at),
    updatedAt: asString(repository.updated_at),
  };
}

export function mapCommit(
  value: unknown,
  repository: GitHubRepositorySummary,
): GitHubCommitSummary | null {
  const commit = asRecord(value);
  if (!commit) return null;
  const sha = asString(commit.sha);
  const htmlUrl = asString(commit.html_url);
  const commitData = asRecord(commit.commit);
  const author = asRecord(commit.author);
  const commitAuthor = asRecord(commitData?.author);
  const message = asString(commitData?.message);
  if (!sha || !htmlUrl || !message) return null;
  return {
    sha,
    message: message.split("\n")[0]?.trim() || "No commit message",
    htmlUrl,
    authorLogin: asString(author?.login),
    authoredAt: asString(commitAuthor?.date),
    repository: {
      fullName: repository.fullName,
      htmlUrl: repository.htmlUrl,
      private: repository.private,
    },
  };
}

function contributionLevel(value: unknown): GitHubContributionLevel {
  if (value === "FIRST_QUARTILE") return 1;
  if (value === "SECOND_QUARTILE") return 2;
  if (value === "THIRD_QUARTILE") return 3;
  if (value === "FOURTH_QUARTILE") return 4;
  return 0;
}

function mapContributionDay(value: unknown): GitHubContributionDay | null {
  const day = asRecord(value);
  const date = asString(day?.date);
  const count = asNumber(day?.contributionCount);
  if (!date || count === null) return null;
  return { date, count, level: contributionLevel(day?.contributionLevel) };
}

export async function listInstallationRepositories(
  token: string,
  fetchImpl: typeof fetch,
): Promise<InstallationRepositoriesResult> {
  const repositories = new Map<number, GitHubRepositorySummary>();
  let totalCount: number | null = null;

  for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
    let response: Response;
    try {
      response = await fetchImpl(
        `${GITHUB_OAUTH.apiUrl}/installation/repositories?per_page=${REPOSITORIES_PER_PAGE}&page=${page}`,
        { method: "GET", headers: apiHeaders(token) },
      );
    } catch {
      throw new GitHubOverviewError("network", "GitHub API is unreachable.");
    }
    if (!response.ok) {
      throw responseError(response, "repositories");
    }
    const payload = asRecord(await readJson(response, "repositories"));
    const pageRepositories = payload?.repositories;
    if (!Array.isArray(pageRepositories)) {
      throw new GitHubOverviewError("unexpected", "GitHub returned an invalid repository list.");
    }
    const reportedTotal = asNumber(payload?.total_count);
    if (reportedTotal !== null) {
      totalCount = reportedTotal;
    }
    for (const repositoryValue of pageRepositories) {
      const repository = mapRepository(repositoryValue);
      if (repository) {
        repositories.set(repository.id, repository);
      }
    }
    if (pageRepositories.length < REPOSITORIES_PER_PAGE) {
      break;
    }
    if (totalCount !== null && repositories.size >= totalCount) {
      break;
    }
  }

  const resolvedTotalCount = totalCount ?? repositories.size;
  return {
    repositories: [...repositories.values()],
    totalCount: resolvedTotalCount,
    truncated: resolvedTotalCount > repositories.size,
  };
}

export async function listAuthoredCommits(
  token: string,
  repository: GitHubRepositorySummary,
  login: string,
  fetchImpl: typeof fetch,
  perPage = 3,
): Promise<GitHubCommitSummary[]> {
  const repositoryPath = repository.fullName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  let response: Response;
  try {
    response = await fetchImpl(
      `${GITHUB_OAUTH.apiUrl}/repos/${repositoryPath}/commits?author=${encodeURIComponent(login)}&per_page=${perPage}`,
      { method: "GET", headers: apiHeaders(token) },
    );
  } catch {
    throw new GitHubOverviewError("network", "GitHub API is unreachable.");
  }
  if (response.status === 409) {
    return [];
  }
  if (!response.ok) {
    throw responseError(response, "commits");
  }
  const payload = await readJson(response, "commits");
  if (!Array.isArray(payload)) {
    throw new GitHubOverviewError("unexpected", "GitHub returned an invalid commit list.");
  }
  return payload
    .map((value) => mapCommit(value, repository))
    .filter((commit): commit is GitHubCommitSummary => commit !== null);
}

export async function fetchContributionCalendar(
  token: string,
  from: Date,
  to: Date,
  fetchImpl: typeof fetch,
): Promise<ContributionCalendarResult> {
  let response: Response;
  try {
    response = await fetchImpl(`${GITHUB_OAUTH.apiUrl}/graphql`, {
      method: "POST",
      headers: {
        ...apiHeaders(token, "application/json"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: CONTRIBUTIONS_QUERY,
        variables: { from: from.toISOString(), to: to.toISOString() },
      }),
    });
  } catch {
    throw new GitHubOverviewError("network", "GitHub GraphQL API is unreachable.");
  }
  if (!response.ok) {
    throw responseError(response, "contributions");
  }
  const payload = asRecord(await readJson(response, "contributions"));
  const graphqlErrors = payload?.errors;
  if (Array.isArray(graphqlErrors) && graphqlErrors.length > 0) {
    const firstError = asRecord(graphqlErrors[0]);
    const message = asString(firstError?.message) ?? "GitHub rejected the contributions query.";
    const type = asString(firstError?.type);
    if (type === "FORBIDDEN" || /scope|permission|access/i.test(message)) {
      throw new GitHubOverviewError("permission", message);
    }
    throw new GitHubOverviewError("unexpected", message);
  }

  const data = asRecord(payload?.data);
  const viewer = asRecord(data?.viewer);
  const login = asString(viewer?.login);
  if (!viewer || !login) {
    throw new GitHubOverviewError("unexpected", "GitHub returned an invalid viewer.");
  }
  const collection = asRecord(viewer.contributionsCollection);
  const calendarData = asRecord(collection?.contributionCalendar);
  const rawWeeks = calendarData?.weeks;
  if (!Array.isArray(rawWeeks)) {
    throw new GitHubOverviewError("unexpected", "GitHub returned an invalid contribution calendar.");
  }

  const weeks: GitHubContributionWeek[] = [];
  for (const rawWeek of rawWeeks) {
    const week = asRecord(rawWeek);
    const rawDays = week?.contributionDays;
    if (!Array.isArray(rawDays)) continue;
    const days = rawDays
      .map((value) => mapContributionDay(value))
      .filter((day): day is GitHubContributionDay => day !== null);
    if (days.length > 0) {
      weeks.push({ days });
    }
  }

  return {
    account: {
      login,
      name: asString(viewer.name),
      avatarUrl: asString(viewer.avatarUrl),
    },
    calendar: {
      totalContributions: asNumber(calendarData?.totalContributions) ?? 0,
      restrictedContributions: asNumber(collection?.restrictedContributionsCount) ?? 0,
      hasRestrictedContributions: collection?.hasAnyRestrictedContributions === true,
      weeks,
    },
  };
}
