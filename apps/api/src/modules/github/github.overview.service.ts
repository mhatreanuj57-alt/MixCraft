import type {
  GitHubAccountSummary,
  GitHubCommitSummary,
  GitHubConnectionSummary,
  GitHubContributionCalendar,
  GitHubOverviewPayload,
  GitHubRepositorySummary,
  GitHubSectionState,
} from "@mixcraft/shared";
import type { PrismaClient, ProviderConnection } from "@mixcraft/database";
import { Prisma } from "@mixcraft/database";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../../config/env.js";
import { createInstallationAccessToken } from "../../providers/github/github.app.js";
import { fetchGitHubUser } from "../../providers/github/github.auth.js";
import {
  fetchContributionCalendar,
  listAuthoredCommits,
  listInstallationRepositories,
  type ContributionCalendarResult,
  type InstallationRepositoriesResult,
} from "../../providers/github/github.overview.client.js";
import { GitHubAppError, GitHubOverviewError } from "../../providers/github/github.errors.js";
import { decodeEncryptionKey, decryptSecret } from "../../security/encryption.js";
import { ApiError } from "../../types/api-error.js";
import type { ConnectionsConfig } from "../connections/connection.config.js";
import {
  findCredential,
  findGithubInstallationForConnection,
} from "../connections/connection.repository.js";

const REPOSITORY_TTL_MS = 5 * 60 * 1000;
const COMMITS_TTL_MS = 5 * 60 * 1000;
const CONTRIBUTIONS_TTL_MS = 15 * 60 * 1000;
const MAX_COMMIT_REPOSITORIES = 12;
const MAX_COMMITS = 20;
const COMMIT_CONCURRENCY = 4;
const GITHUB_USER_TOKEN_KIND = "github_user_token";

const RESOURCE_TYPES = {
  repositories: "github_repositories",
  commits: "github_commits",
  contributions: "github_contributions",
} as const;

export interface GitHubOverviewDeps {
  db: PrismaClient | null;
  fetchImpl: typeof fetch;
  log: FastifyBaseLogger;
  requestId: string;
  config: ConnectionsConfig;
  now?: () => Date;
}

interface RepositoryCache {
  repositories: GitHubRepositorySummary[];
  totalCount: number;
  truncated: boolean;
}

interface CommitCache {
  commits: GitHubCommitSummary[];
  failedRepositories: number;
}

type ContributionCache = ContributionCalendarResult;
type StoredCredential = Awaited<ReturnType<typeof findCredential>>;

function requireDb(deps: GitHubOverviewDeps): PrismaClient {
  if (!deps.db) {
    throw new ApiError("SERVICE_UNAVAILABLE", "Database is not configured.");
  }
  return deps.db;
}

function requireEncryptionKey(): string {
  if (!env.ENCRYPTION_KEY) {
    throw new ApiError("SERVICE_UNAVAILABLE", "ENCRYPTION_KEY is not configured.");
  }
  return env.ENCRYPTION_KEY;
}

function toConnectionSummary(connection: ProviderConnection): GitHubConnectionSummary {
  return {
    id: connection.id,
    status: connection.status,
    accountName: connection.providerAccountName,
    lastValidatedAt: connection.lastValidatedAt?.toISOString() ?? null,
  };
}

function section(status: GitHubSectionState["status"], message: string | null = null): GitHubSectionState {
  return { status, message };
}

function sectionError(error: unknown): GitHubSectionState {
  if (error instanceof GitHubOverviewError) {
    if (error.kind === "permission") {
      return section("permission_required", error.message);
    }
    if (error.kind === "rate_limited") {
      return section("unavailable", "GitHub rate limit reached. Try again shortly.");
    }
    if (error.kind === "network") {
      return section("unavailable", "GitHub could not be reached. Try again shortly.");
    }
    if (error.kind === "not_found") {
      return section("unavailable", "GitHub could not find the requested resource.");
    }
    return section("unavailable", "GitHub returned an unexpected response.");
  }
  if (error instanceof GitHubAppError) {
    if (error.kind === "not_found") {
      return section("permission_required", "The GitHub App installation is missing or revoked.");
    }
    if (error.kind === "network") {
      return section("unavailable", "GitHub could not be reached. Try again shortly.");
    }
    return section("unavailable", "GitHub rejected the App installation request.");
  }
  return section("unavailable", "The GitHub section could not be loaded.");
}

function notConnectedPayload(now: Date): GitHubOverviewPayload {
  return {
    connection: null,
    account: null,
    repositories: [],
    repositoryCount: 0,
    commits: [],
    contributions: null,
    sections: {
      repositories: section("not_connected", "Connect GitHub to see your repositories."),
      commits: section("not_connected", "Connect GitHub to see recent commits."),
      contributions: section("not_connected", "Connect GitHub to see contribution activity."),
    },
    fetchedAt: now.toISOString(),
  };
}

function unavailablePayload(
  connection: GitHubConnectionSummary,
  now: Date,
  message: string,
): GitHubOverviewPayload {
  return {
    connection,
    account: null,
    repositories: [],
    repositoryCount: 0,
    commits: [],
    contributions: null,
    sections: {
      repositories: section("unavailable", message),
      commits: section("unavailable", message),
      contributions: section("unavailable", message),
    },
    fetchedAt: now.toISOString(),
  };
}

function decryptUserToken(
  credential: StoredCredential,
  encryptionKey: string,
): string | null {
  if (!credential.found || credential.kind !== GITHUB_USER_TOKEN_KIND) {
    return null;
  }
  try {
    return decryptSecret(
      {
        ciphertext: Buffer.from(credential.ciphertext),
        nonce: Buffer.from(credential.nonce),
        authenticationTag: Buffer.from(credential.authenticationTag),
      },
      decodeEncryptionKey(encryptionKey),
    );
  } catch {
    return null;
  }
}

function cacheKey(connection: ProviderConnection, resource: string): string {
  return `${connection.providerAccountId}:${resource}`;
}

async function readCache<T>(
  db: PrismaClient,
  connectionId: string,
  resourceType: string,
  providerResourceId: string,
  now: Date,
  log: FastifyBaseLogger,
): Promise<T | null> {
  try {
    const row = await db.resourceCache.findUnique({
      where: {
        connectionId_resourceType_providerResourceId: {
          connectionId,
          resourceType,
          providerResourceId,
        },
      },
    });
    if (!row || row.expiresAt.getTime() <= now.getTime()) {
      return null;
    }
    return row.payload as T;
  } catch (error) {
    log.warn({ err: error, resourceType }, "github overview cache read failed");
    return null;
  }
}

async function writeCache(
  db: PrismaClient,
  connectionId: string,
  resourceType: string,
  providerResourceId: string,
  payload: unknown,
  now: Date,
  ttlMs: number,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const expiresAt = new Date(now.getTime() + ttlMs);
    await db.resourceCache.upsert({
      where: {
        connectionId_resourceType_providerResourceId: {
          connectionId,
          resourceType,
          providerResourceId,
        },
      },
      update: {
        provider: "github",
        payload: payload as Prisma.InputJsonValue,
        fetchedAt: now,
        expiresAt,
      },
      create: {
        connectionId,
        provider: "github",
        resourceType,
        providerResourceId,
        payload: payload as Prisma.InputJsonValue,
        fetchedAt: now,
        expiresAt,
      },
    });
  } catch (error) {
    log.warn({ err: error, resourceType }, "github overview cache write failed");
  }
}

function repositoryActivity(repository: GitHubRepositorySummary): number {
  const value = repository.pushedAt ?? repository.updatedAt;
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function commitActivity(commit: GitHubCommitSummary): number {
  if (!commit.authoredAt) return 0;
  const timestamp = Date.parse(commit.authoredAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function contributionRange(now: Date): { from: Date; to: Date } {
  const to = new Date(now);
  const from = new Date(
    Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), to.getUTCDate() + 1),
  );
  return { from, to };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await mapper(item);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function getGitHubOverview(
  deps: GitHubOverviewDeps,
  userId: string,
): Promise<GitHubOverviewPayload> {
  const db = requireDb(deps);
  const encryptionKey = requireEncryptionKey();
  const now = deps.now?.() ?? new Date();
  const connection = await db.providerConnection.findFirst({
    where: { userId, provider: "github" },
    orderBy: { updatedAt: "desc" },
  });
  if (!connection) {
    return notConnectedPayload(now);
  }

  const summary = toConnectionSummary(connection);
  if (connection.status !== "connected") {
    return unavailablePayload(
      summary,
      now,
      "Reconnect GitHub to refresh this overview with current credentials.",
    );
  }

  const installation = await findGithubInstallationForConnection(db, connection.id);
  const credential = await findCredential(db, connection.id);
  const userToken = decryptUserToken(credential, encryptionKey);

  let installationTokenPromise: Promise<string> | null = null;
  const installationToken = (): Promise<string> => {
    if (!deps.config.githubApp || !installation) {
      throw new ApiError("PROVIDER_UNAVAILABLE", "GitHub App connections are not configured.");
    }
    installationTokenPromise ??= createInstallationAccessToken(
      deps.config.githubApp,
      Number(installation.installationId),
      deps.fetchImpl,
    ).then((token) => token.token);
    return installationTokenPromise;
  };

  let account: GitHubAccountSummary | null = null;
  let commitLogin: string | null = null;

  const repositoriesResult = await loadRepositories(
    deps,
    db,
    connection,
    installation,
    now,
    installationToken,
  );
  const contributionsResult = await loadContributions(deps, db, connection, userToken, now);
  account = contributionsResult.account ?? account;
  commitLogin = contributionsResult.account?.login ?? commitLogin;

  if (!account && userToken) {
    try {
      const profile = await fetchGitHubUser(userToken, deps.fetchImpl);
      account = {
        login: profile.login,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      };
      commitLogin = profile.login;
    } catch (error) {
      deps.log.warn({ err: error }, "github overview profile lookup failed");
    }
  }
  if (!account && installation?.accountType === "User" && connection.providerAccountName) {
    account = {
      login: connection.providerAccountName,
      name: null,
      avatarUrl: null,
    };
    commitLogin = connection.providerAccountName;
  }

  const commitsResult = await loadCommits(
    deps,
    db,
    connection,
    repositoriesResult.repositories,
    repositoriesResult.state,
    commitLogin,
    now,
    installationToken,
  );

  return {
    connection: summary,
    account,
    repositories: repositoriesResult.repositories,
    repositoryCount: repositoriesResult.totalCount,
    commits: commitsResult.commits,
    contributions: contributionsResult.calendar,
    sections: {
      repositories: repositoriesResult.state,
      commits: commitsResult.state,
      contributions: contributionsResult.state,
    },
    fetchedAt: now.toISOString(),
  };
}

interface RepositoriesLoadResult {
  repositories: GitHubRepositorySummary[];
  totalCount: number;
  state: GitHubSectionState;
}

async function loadRepositories(
  deps: GitHubOverviewDeps,
  db: PrismaClient,
  connection: ProviderConnection,
  installation: Awaited<ReturnType<typeof findGithubInstallationForConnection>>,
  now: Date,
  installationToken: () => Promise<string>,
): Promise<RepositoriesLoadResult> {
  if (!installation) {
    return {
      repositories: [],
      totalCount: 0,
      state: section("permission_required", "The GitHub App installation is missing. Reconnect GitHub."),
    };
  }
  if (installation.suspendedAt) {
    return {
      repositories: [],
      totalCount: 0,
      state: section("unavailable", "The GitHub App installation is suspended."),
    };
  }

  const key = cacheKey(connection, "repositories");
  const cached = await readCache<RepositoryCache>(
    db,
    connection.id,
    RESOURCE_TYPES.repositories,
    key,
    now,
    deps.log,
  );
  if (cached) {
    return {
      repositories: cached.repositories,
      totalCount: cached.totalCount,
      state: cached.repositories.length
        ? section(
            "ok",
            cached.truncated
              ? `Showing the first ${cached.repositories.length} of ${cached.totalCount} repositories.`
              : null,
          )
        : section("empty", "This installation has no accessible repositories."),
    };
  }

  try {
    const token = await installationToken();
    const result: InstallationRepositoriesResult = await listInstallationRepositories(
      token,
      deps.fetchImpl,
    );
    const cache: RepositoryCache = {
      repositories: result.repositories,
      totalCount: result.totalCount,
      truncated: result.truncated,
    };
    await writeCache(
      db,
      connection.id,
      RESOURCE_TYPES.repositories,
      key,
      cache,
      now,
      REPOSITORY_TTL_MS,
      deps.log,
    );
    return {
      repositories: result.repositories,
      totalCount: result.totalCount,
      state: result.repositories.length
        ? section(
            "ok",
            result.truncated
              ? `Showing the first ${result.repositories.length} of ${result.totalCount} repositories.`
              : null,
          )
        : section("empty", "This installation has no accessible repositories."),
    };
  } catch (error) {
    deps.log.warn({ err: error }, "github overview repositories failed");
    return {
      repositories: [],
      totalCount: 0,
      state: sectionError(error),
    };
  }
}

interface ContributionsLoadResult {
  calendar: GitHubContributionCalendar | null;
  state: GitHubSectionState;
  account: GitHubAccountSummary | null;
}

async function loadContributions(
  deps: GitHubOverviewDeps,
  db: PrismaClient,
  connection: ProviderConnection,
  userToken: string | null,
  now: Date,
): Promise<ContributionsLoadResult> {
  if (!userToken) {
    return {
      calendar: null,
      state: section(
        "permission_required",
        "Reconnect GitHub so MixCraft can read your contribution calendar.",
      ),
      account: null,
    };
  }

  const key = cacheKey(connection, "contributions");
  const cached = await readCache<ContributionCache>(
    db,
    connection.id,
    RESOURCE_TYPES.contributions,
    key,
    now,
    deps.log,
  );
  if (cached) {
    return {
      calendar: cached.calendar,
      state: cached.calendar.weeks.length
        ? section("ok")
        : section("empty", "No contribution activity was returned for this period."),
      account: cached.account,
    };
  }

  try {
    const { from, to } = contributionRange(now);
    const result = await fetchContributionCalendar(userToken, from, to, deps.fetchImpl);
    await writeCache(
      db,
      connection.id,
      RESOURCE_TYPES.contributions,
      key,
      result,
      now,
      CONTRIBUTIONS_TTL_MS,
      deps.log,
    );
    return {
      calendar: result.calendar,
      state: result.calendar.weeks.length
        ? section(
            "ok",
            result.calendar.hasRestrictedContributions
              ? "Some private contribution details may be hidden by GitHub."
              : null,
          )
        : section("empty", "No contribution activity was returned for this period."),
      account: result.account,
    };
  } catch (error) {
    deps.log.warn({ err: error }, "github overview contributions failed");
    return {
      calendar: null,
      state: sectionError(error),
      account: null,
    };
  }
}

interface CommitsLoadResult {
  commits: GitHubCommitSummary[];
  state: GitHubSectionState;
}

async function loadCommits(
  deps: GitHubOverviewDeps,
  db: PrismaClient,
  connection: ProviderConnection,
  repositories: GitHubRepositorySummary[],
  repositoriesState: GitHubSectionState,
  login: string | null,
  now: Date,
  installationToken: () => Promise<string>,
): Promise<CommitsLoadResult> {
  if (repositoriesState.status === "empty") {
    return { commits: [], state: section("empty", "No repositories are available for commits.") };
  }
  if (repositoriesState.status !== "ok") {
    return {
      commits: [],
      state: section(
        "unavailable",
        "Recent commits need an accessible repository list.",
      ),
    };
  }
  if (!connection.scopes.includes("contents:read")) {
    return {
      commits: [],
      state: section(
        "permission_required",
        "Grant the GitHub App Contents: read permission to load commit activity.",
      ),
    };
  }
  if (!login) {
    return {
      commits: [],
      state: section(
        "permission_required",
        "MixCraft could not identify the GitHub account for this installation.",
      ),
    };
  }

  const key = `${cacheKey(connection, "commits")}:${login.toLowerCase()}`;
  const cached = await readCache<CommitCache>(
    db,
    connection.id,
    RESOURCE_TYPES.commits,
    key,
    now,
    deps.log,
  );
  if (cached) {
    return {
      commits: cached.commits,
      state: cached.commits.length
        ? section(
            "ok",
            cached.failedRepositories > 0
              ? `${cached.failedRepositories} repositories could not be read.`
              : null,
          )
        : section(
            cached.failedRepositories > 0 ? "unavailable" : "empty",
            cached.failedRepositories > 0
              ? "Recent commits could not be loaded from GitHub."
              : "No recent commits authored by this account were found.",
          ),
    };
  }

  const targetRepositories = [...repositories]
    .sort((a, b) => repositoryActivity(b) - repositoryActivity(a))
    .slice(0, MAX_COMMIT_REPOSITORIES);

  try {
    const token = await installationToken();
    const results = await mapWithConcurrency(
      targetRepositories,
      COMMIT_CONCURRENCY,
      async (repository) => {
        try {
          const commits = await listAuthoredCommits(token, repository, login, deps.fetchImpl);
          return { commits, error: null };
        } catch (error) {
          return { commits: [], error };
        }
      },
    );

    const failed = results.filter((result) => result.error !== null);
    const failedRepositories = failed.length;
    const bySha = new Map<string, GitHubCommitSummary>();
    for (const result of results) {
      for (const commit of result.commits) {
        if (!bySha.has(commit.sha)) {
          bySha.set(commit.sha, commit);
        }
      }
    }
    const commits = [...bySha.values()]
      .sort((a, b) => commitActivity(b) - commitActivity(a))
      .slice(0, MAX_COMMITS);

    if (commits.length > 0 || failedRepositories < targetRepositories.length) {
      await writeCache(
        db,
        connection.id,
        RESOURCE_TYPES.commits,
        key,
        { commits, failedRepositories } satisfies CommitCache,
        now,
        COMMITS_TTL_MS,
        deps.log,
      );
    }

    if (commits.length > 0) {
      return {
        commits,
        state: section(
          "ok",
          failedRepositories > 0
            ? `${failedRepositories} repositories could not be read.`
            : null,
        ),
      };
    }
    if (failedRepositories === targetRepositories.length) {
      return { commits: [], state: sectionError(failed[0]?.error) };
    }
    return {
      commits: [],
      state: section("empty", "No recent commits authored by this account were found."),
    };
  } catch (error) {
    deps.log.warn({ err: error }, "github overview commits failed");
    return { commits: [], state: sectionError(error) };
  }
}
