import type {
  GitHubContributionLevel,
  GitHubContributionWeek,
} from "@mixcraft/shared";
import { describe, expect, it } from "vitest";
import {
  commitHeadline,
  connectionStatusLabel,
  contributionRange,
  contributionSummary,
  formatCount,
  formatRelativeTime,
  monthLabels,
  monthlyTotals,
  pluralize,
  shortSha,
} from "../../src/features/overview/presentation";

function week(startDate: string, counts: number[]): GitHubContributionWeek {
  const start = new Date(`${startDate}T00:00:00Z`);

  return {
    days: counts.map((count, index) => {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + index);
      return {
        date: date.toISOString().slice(0, 10),
        count,
        level: Math.min(count, 4) as GitHubContributionLevel,
      };
    }),
  };
}

const weeks: GitHubContributionWeek[] = [
  week("2026-01-01", [1, 0, 2, 0, 3, 0, 1]),
  week("2026-01-08", [0, 0, 0, 4, 0, 0, 0]),
  week("2026-01-29", [0, 0, 1, 2, 5, 0, 0]),
  week("2026-02-05", [1, 1, 1, 1, 1, 1, 1]),
  week("2026-03-01", [0, 0, 0, 0, 0, 0, 2]),
];

describe("overview presentation", () => {
  it("formats counts and plural labels", () => {
    expect(formatCount(1234)).toBe("1,234");
    expect(pluralize(1, "repository")).toBe("1 repository");
    expect(pluralize(2, "repository", "repositories")).toBe("2 repositories");
  });

  it("formats relative times against a fixed now", () => {
    const now = Date.parse("2026-01-01T03:00:00Z");

    expect(formatRelativeTime("2026-01-01T02:59:45Z", now)).toBe("Just now");
    expect(formatRelativeTime("2026-01-01T02:15:00Z", now)).toBe("45m ago");
    expect(formatRelativeTime("2026-01-01T01:00:00Z", now)).toBe("2h ago");
    expect(formatRelativeTime("2025-12-30T03:00:00Z", now)).toBe("2d ago");
    expect(formatRelativeTime("not-a-date", now)).toBe("Unknown");
    expect(formatRelativeTime(null, now)).toBe("Unknown");
  });

  it("shortens SHAs and extracts commit headlines", () => {
    expect(shortSha("abcdef1234567890")).toBe("abcdef1");
    expect(commitHeadline("Add overview page\n\nLonger detail")).toBe("Add overview page");
    expect(commitHeadline("\n")).toBe("Untitled commit");
  });

  it("labels connection statuses", () => {
    expect(connectionStatusLabel("connected")).toBe("Connected");
    expect(connectionStatusLabel("expired")).toBe("Expired");
  });

  it("builds month labels at month boundaries", () => {
    expect(monthLabels(weeks)).toEqual([
      { index: 0, label: "Jan" },
      { index: 2, label: "Feb" },
      { index: 4, label: "Mar" },
    ]);
  });

  it("totals contributions by month", () => {
    expect(monthlyTotals(weeks)).toEqual([
      { key: "2026-01", label: "Jan 2026", total: 12 },
      { key: "2026-02", label: "Feb 2026", total: 14 },
      { key: "2026-03", label: "Mar 2026", total: 2 },
    ]);
  });

  it("describes the contribution range and total", () => {
    expect(contributionRange(weeks)).toBe("Jan 1, 2026 - Mar 7, 2026");
    expect(contributionSummary(weeks, 28)).toBe(
      "28 contributions from Jan 1, 2026 - Mar 7, 2026.",
    );
  });

  it("handles an empty contribution range", () => {
    expect(contributionRange([])).toBe("Selected period");
    expect(contributionSummary([], 0)).toBe("0 contributions from Selected period.");
  });
});
