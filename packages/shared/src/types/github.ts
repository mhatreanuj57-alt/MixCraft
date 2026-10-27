import type { ConnectionStatus } from "./providers.js";

export type GitHubSectionStatus =
  | "ok"
  | "empty"
  | "not_connected"
  | "permission_required"
  | "unavailable";

export interface GitHubSectionState {
  status: GitHubSectionStatus;
  message: string | null;
}

export interface GitHubConnectionSummary {
  id: string;
  status: ConnectionStatus;
  accountName: string | null;
  lastValidatedAt: string | null;
}

export interface GitHubAccountSummary {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface GitHubRepositorySummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  description: string | null;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  openIssuesCount: number;
  htmlUrl: string;
  defaultBranch: string;
  pushedAt: string | null;
  updatedAt: string | null;
}

export interface GitHubCommitSummary {
  sha: string;
  message: string;
  htmlUrl: string;
  authorLogin: string | null;
  authoredAt: string | null;
  repository: {
    fullName: string;
    htmlUrl: string;
    private: boolean;
  };
}

export type GitHubContributionLevel = 0 | 1 | 2 | 3 | 4;

export interface GitHubContributionDay {
  date: string;
  count: number;
  level: GitHubContributionLevel;
}

export interface GitHubContributionWeek {
  days: GitHubContributionDay[];
}

export interface GitHubContributionCalendar {
  totalContributions: number;
  restrictedContributions: number;
  hasRestrictedContributions: boolean;
  weeks: GitHubContributionWeek[];
}

export interface GitHubOverviewPayload {
  connection: GitHubConnectionSummary | null;
  account: GitHubAccountSummary | null;
  repositories: GitHubRepositorySummary[];
  repositoryCount: number;
  commits: GitHubCommitSummary[];
  contributions: GitHubContributionCalendar | null;
  sections: {
    repositories: GitHubSectionState;
    commits: GitHubSectionState;
    contributions: GitHubSectionState;
  };
  fetchedAt: string;
}
