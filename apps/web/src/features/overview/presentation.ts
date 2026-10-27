import type { GitHubContributionWeek } from "@mixcraft/shared";

const numberFormatter = new Intl.NumberFormat("en-US");
const shortMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});
const monthYearFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const rangeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export interface MonthLabel {
  index: number;
  label: string;
}

export interface MonthTotal {
  key: string;
  label: string;
  total: number;
}

function parseDay(value: string): Date | null {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatCount(value: number): string {
  return numberFormatter.format(value);
}

export function pluralize(value: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(value)} ${value === 1 ? singular : plural}`;
}

export function formatRelativeTime(
  value: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) return "Unknown";

  const delta = now - timestamp;
  if (delta < 0) return "Just now";
  if (delta < 60_000) return "Just now";

  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return rangeFormatter.format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return dateTimeFormatter.format(date);
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function commitHeadline(message: string): string {
  const line = message.split("\n", 1)[0]?.trim();
  return line || "Untitled commit";
}

export function monthLabels(weeks: GitHubContributionWeek[]): MonthLabel[] {
  const labels: MonthLabel[] = [];
  let lastMonth: string | null = null;

  weeks.forEach((week, index) => {
    const anchor = week.days[Math.min(3, week.days.length - 1)] ?? week.days[0];
    if (!anchor) return;
    const date = parseDay(anchor.date);
    if (!date) return;
    const month = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    if (month !== lastMonth) {
      labels.push({ index, label: shortMonthFormatter.format(date) });
      lastMonth = month;
    }
  });

  return labels;
}

export function monthlyTotals(weeks: GitHubContributionWeek[]): MonthTotal[] {
  const months = new Map<string, MonthTotal>();

  for (const week of weeks) {
    for (const day of week.days) {
      const date = parseDay(day.date);
      if (!date) continue;
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      const existing = months.get(key);
      if (existing) {
        existing.total += day.count;
      } else {
        months.set(key, {
          key,
          label: monthYearFormatter.format(date),
          total: day.count,
        });
      }
    }
  }

  return [...months.values()];
}

export function contributionRange(weeks: GitHubContributionWeek[]): string {
  const first = weeks[0]?.days[0]?.date;
  const lastWeek = weeks[weeks.length - 1];
  const last = lastWeek?.days[lastWeek.days.length - 1]?.date;
  const firstDate = first ? parseDay(first) : null;
  const lastDate = last ? parseDay(last) : null;
  if (!firstDate || !lastDate) return "Selected period";
  return `${rangeFormatter.format(firstDate)} - ${rangeFormatter.format(lastDate)}`;
}

export function contributionSummary(
  weeks: GitHubContributionWeek[],
  totalContributions: number,
): string {
  return `${pluralize(totalContributions, "contribution")} from ${contributionRange(weeks)}.`;
}

export function connectionStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
