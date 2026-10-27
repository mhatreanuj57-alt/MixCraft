import type {
  GitHubContributionCalendar,
  GitHubContributionWeek,
  GitHubOverviewPayload,
  GitHubRepositorySummary,
  GitHubSectionState,
} from "@mixcraft/shared";
import { useCallback, useEffect, useState } from "react";
import BrandMark from "../components/BrandMark";
import SiteHeader from "../components/SiteHeader";
import { fetchGitHubOverview } from "../features/overview/api";
import {
  commitHeadline,
  connectionStatusLabel,
  contributionRange,
  contributionSummary,
  formatCount,
  formatDateTime,
  formatRelativeTime,
  monthLabels,
  monthlyTotals,
  pluralize,
  shortSha,
} from "../features/overview/presentation";

type ViewState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | {
      kind: "ready";
      payload: GitHubOverviewPayload;
      refreshing: boolean;
      refreshError: string | null;
    }
  | { kind: "error"; detail: string };

const SECTION_LABELS = {
  repositories: "Repositories",
  commits: "Commits",
  contributions: "Contributions",
} as const;

function isResolved(state: GitHubSectionState): boolean {
  return state.status === "ok" || state.status === "empty";
}

function statusValue(state: GitHubSectionState, value: number): string {
  return isResolved(state) ? formatCount(value) : "-";
}

function PageHero() {
  return (
    <section className="mc-overview-hero" aria-labelledby="overview-title">
      <div className="mc-overview-hero__copy">
        <p className="mc-eyebrow">GitHub / Read-only overview</p>
        <h1 id="overview-title" className="mc-display">
          Overview
        </h1>
        <p className="mc-lede">
          Every repository this installation can read, the commits you authored, and a year of
          contribution activity - without leaving this workspace.
        </p>
      </div>
      <div className="mc-overview-hero__stamp" aria-hidden="true">
        <BrandMark className="mc-overview-hero__mark" />
        <p>
          One installation
          <br />
          One honest ledger
        </p>
      </div>
    </section>
  );
}

function AccountPassport({
  payload,
  refreshing,
  refreshError,
  onRefresh,
}: {
  payload: GitHubOverviewPayload;
  refreshing: boolean;
  refreshError: string | null;
  onRefresh: () => void;
}) {
  const account = payload.account;
  const connection = payload.connection;
  const displayName = account?.name ?? account?.login ?? "GitHub connected";
  const monogram = (account?.login ?? connection?.accountName ?? "G").charAt(0).toUpperCase();

  return (
    <aside className="mc-passport" aria-label="GitHub account and data status">
      <div className="mc-passport__identity">
        {account?.avatarUrl ? (
          <img
            className="mc-passport__avatar"
            src={account.avatarUrl}
            alt=""
            width="64"
            height="64"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="mc-passport__monogram" aria-hidden="true">
            {monogram}
          </span>
        )}
        <div className="mc-passport__copy">
          <p className="mc-eyebrow">Signed in via GitHub</p>
          <h2 className="mc-passport__name">{displayName}</h2>
          {account?.login && <p className="mc-passport__login">@{account.login}</p>}
        </div>
      </div>

      <dl className="mc-passport__meta">
        <div>
          <dt>Connection</dt>
          <dd>
            <span
              className={`mc-state-dot mc-state-dot--${connection?.status ?? "disconnected"}`}
              aria-hidden="true"
            />
            {connectionStatusLabel(connection?.status ?? "disconnected")}
          </dd>
        </div>
        <div>
          <dt>Installation</dt>
          <dd>{connection?.accountName ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Fetched</dt>
          <dd title={formatDateTime(payload.fetchedAt)}>
            <time dateTime={payload.fetchedAt}>{formatRelativeTime(payload.fetchedAt)}</time>
          </dd>
        </div>
      </dl>

      <div className="mc-passport__actions">
        <button
          type="button"
          className="mc-button mc-button--primary"
          onClick={onRefresh}
          disabled={refreshing}
          aria-busy={refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh data"}
        </button>
        <a className="mc-button" href="/connections">
          Manage connections
        </a>
      </div>

      {refreshError && (
        <p className="mc-passport__error" role="alert">
          {refreshError}
        </p>
      )}
    </aside>
  );
}

function OverviewStats({ payload }: { payload: GitHubOverviewPayload }) {
  const privateRepositories = payload.repositories.filter((repository) => repository.private).length;

  return (
    <dl className="mc-overview-stats" aria-label="Overview totals">
      <div className="mc-overview-stat">
        <dt>Repositories</dt>
        <dd className="mc-overview-stat__value">
          {statusValue(payload.sections.repositories, payload.repositoryCount)}
        </dd>
        <dd className="mc-overview-stat__note">
          {payload.sections.repositories.status === "ok"
            ? "visible to this installation"
            : payload.sections.repositories.status === "empty"
              ? "none available"
              : "not available"}
        </dd>
      </div>
      <div className="mc-overview-stat">
        <dt>Recent commits</dt>
        <dd className="mc-overview-stat__value">
          {statusValue(payload.sections.commits, payload.commits.length)}
        </dd>
        <dd className="mc-overview-stat__note">
          {payload.sections.commits.status === "ok"
            ? "authored by this account"
            : payload.sections.commits.status === "empty"
              ? "none in this window"
              : "not available"}
        </dd>
      </div>
      <div className="mc-overview-stat">
        <dt>Contributions</dt>
        <dd className="mc-overview-stat__value">
          {payload.contributions
            ? statusValue(payload.sections.contributions, payload.contributions.totalContributions)
            : "-"}
        </dd>
        <dd className="mc-overview-stat__note">
          {payload.contributions ? "in the past 12 months" : "calendar unavailable"}
        </dd>
      </div>
      <div className="mc-overview-stat">
        <dt>Private repos</dt>
        <dd className="mc-overview-stat__value">
          {isResolved(payload.sections.repositories) ? formatCount(privateRepositories) : "-"}
        </dd>
        <dd className="mc-overview-stat__note">visible in this view</dd>
      </div>
    </dl>
  );
}

function OverviewNotices({ sections }: { sections: GitHubOverviewPayload["sections"] }) {
  const entries = (Object.keys(SECTION_LABELS) as (keyof typeof SECTION_LABELS)[])
    .map((key) => ({ key, label: SECTION_LABELS[key], state: sections[key] }))
    .filter(({ state }) => state.status === "permission_required" || state.status === "unavailable");

  if (entries.length === 0) return null;

  return (
    <section className="mc-overview-notices" aria-label="Data availability notices">
      {entries.map(({ key, label, state }) => (
        <p className={`mc-notice mc-notice--${state.status}`} role="status" key={key}>
          <span className="mc-notice__label">{label}</span>
          <span className="mc-notice__message">
            {state.message ?? "This section could not be loaded."}
          </span>
          {state.status === "permission_required" && (
            <a className="mc-notice__action" href="/connections">
              Review connection
            </a>
          )}
        </p>
      ))}
    </section>
  );
}

function SectionHead({
  titleId,
  eyebrow,
  title,
  count,
  countLabel,
}: {
  titleId: string;
  eyebrow: string;
  title: string;
  count?: number;
  countLabel?: string;
}) {
  return (
    <div className="mc-overview-section__head">
      <div>
        <p className="mc-eyebrow">{eyebrow}</p>
        <h2 id={titleId} className="mc-overview-section__title">
          {title}
        </h2>
      </div>
      {typeof count === "number" && (
        <p className="mc-overview-section__count" aria-label={`${count} ${countLabel ?? ""}`.trim()}>
          <span>{formatCount(count)}</span>
          <span>{countLabel}</span>
        </p>
      )}
    </div>
  );
}

function SectionEmpty({
  state,
  fallback,
}: {
  state: GitHubSectionState;
  fallback: string;
}) {
  return (
    <div className="mc-section-empty">
      <p className="mc-eyebrow">
        {state.status === "empty" ? "Nothing to report" : "Section unavailable"}
      </p>
      <p className="mc-section-empty__message">{state.message ?? fallback}</p>
      {state.status === "permission_required" && (
        <a className="mc-button" href="/connections">
          Review connection
        </a>
      )}
    </div>
  );
}

function CommitList({ commits }: { commits: GitHubOverviewPayload["commits"] }) {
  return (
    <ol className="mc-commit-list">
      {commits.map((commit) => (
        <li className="mc-commit" key={commit.sha}>
          <a
            className="mc-commit__link"
            href={commit.htmlUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open commit ${shortSha(commit.sha)} in ${commit.repository.fullName} on GitHub`}
          >
            <div className="mc-commit__top">
              <span className="mc-commit__repo">{commit.repository.fullName}</span>
              <span
                className={`mc-visibility mc-visibility--${commit.repository.private ? "private" : "public"}`}
              >
                {commit.repository.private ? "Private" : "Public"}
              </span>
            </div>
            <p className="mc-commit__message">{commitHeadline(commit.message)}</p>
            <div className="mc-commit__meta">
              <span className="mc-commit__sha">{shortSha(commit.sha)}</span>
              {commit.authoredAt && (
                <time dateTime={commit.authoredAt}>{formatRelativeTime(commit.authoredAt)}</time>
              )}
              <span className="mc-commit__external" aria-hidden="true">
                Open
              </span>
            </div>
          </a>
        </li>
      ))}
    </ol>
  );
}

function RepositoryList({
  repositories,
  repositoryCount,
  browseHref,
}: {
  repositories: GitHubRepositorySummary[];
  repositoryCount: number;
  browseHref: string;
}) {
  const visible = repositories.slice(0, 8);

  return (
    <>
      <ul className="mc-repo-list">
        {visible.map((repository) => (
          <li className="mc-repo" key={repository.id}>
            <a
              className="mc-repo__link"
              href={repository.htmlUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${repository.fullName} on GitHub`}
            >
              <div className="mc-repo__top">
                <span className="mc-repo__name">{repository.name}</span>
                <span
                  className={`mc-visibility mc-visibility--${repository.private ? "private" : "public"}`}
                >
                  {repository.private ? "Private" : "Public"}
                </span>
              </div>
              <p className="mc-repo__description">
                {repository.description ?? "No repository description."}
              </p>
              <div className="mc-repo__meta">
                <span>{repository.language ?? "No language"}</span>
                <span>
                  Pushed {formatRelativeTime(repository.pushedAt ?? repository.updatedAt)}
                </span>
                <span>{formatCount(repository.stargazersCount)} stars</span>
              </div>
            </a>
          </li>
        ))}
      </ul>
      {repositoryCount > visible.length && (
        <p className="mc-overview-section__foot">
          Showing {formatCount(visible.length)} of {formatCount(repositoryCount)} by recent push.{" "}
          <a className="mc-text-link" href={browseHref} target="_blank" rel="noreferrer">
            Browse on GitHub
          </a>
        </p>
      )}
    </>
  );
}

function ContributionGraph({ calendar }: { calendar: GitHubContributionCalendar }) {
  const labels = monthLabels(calendar.weeks);
  const totals = monthlyTotals(calendar.weeks);

  return (
    <div className="mc-contribution">
      <div
        className="mc-contribution__chart"
        role="img"
        aria-label={contributionSummary(calendar.weeks, calendar.totalContributions)}
      >
        <div className="mc-contribution__months" aria-hidden="true">
          {labels.map((label) => (
            <span key={`${label.label}-${label.index}`} style={{ gridColumnStart: label.index + 1 }}>
              {label.label}
            </span>
          ))}
        </div>
        <div className="mc-contribution__body">
          <div className="mc-contribution__weekdays" aria-hidden="true">
            <span />
            <span>Mon</span>
            <span />
            <span>Wed</span>
            <span />
            <span>Fri</span>
            <span />
          </div>
          <div className="mc-contribution__weeks">
            {calendar.weeks.map((week: GitHubContributionWeek, weekIndex) => (
              <div
                className="mc-contribution__week"
                key={`${weekIndex}-${week.days[0]?.date ?? "week"}`}
              >
                {week.days.map((day) => (
                  <span
                    className={`mc-contribution__day mc-contribution__day--${day.level}`}
                    key={day.date}
                    title={`${day.date}: ${pluralize(day.count, "contribution")}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mc-contribution__legend" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            className={`mc-contribution__day mc-contribution__day--${level}`}
            key={`legend-${level}`}
          />
        ))}
        <span>More</span>
      </div>

      <details className="mc-contribution__details">
        <summary>Monthly totals</summary>
        <table>
          <caption>Contribution totals by month</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Contributions</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((month) => (
              <tr key={month.key}>
                <th scope="row">{month.label}</th>
                <td>{formatCount(month.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function ContributionsSection({ payload }: { payload: GitHubOverviewPayload }) {
  const calendar = payload.contributions;
  const state = payload.sections.contributions;

  return (
    <section className="mc-contributions" aria-labelledby="contributions-title">
      <div className="mc-contributions__head">
        <div>
          <p className="mc-eyebrow">Past 12 months</p>
          <h2 id="contributions-title" className="mc-overview-section__title">
            Contribution activity
          </h2>
        </div>
        {calendar && (
          <p className="mc-contributions__total">
            <strong>{formatCount(calendar.totalContributions)}</strong>
            <span>contributions</span>
            <span className="mc-contributions__range">{contributionRange(calendar.weeks)}</span>
          </p>
        )}
      </div>

      {calendar && calendar.weeks.length > 0 ? (
        <>
          {state.message && <p className="mc-section-note">{state.message}</p>}
          <ContributionGraph calendar={calendar} />
        </>
      ) : (
        <SectionEmpty state={state} fallback="Contribution activity could not be loaded." />
      )}
    </section>
  );
}

function ConnectedOverview({
  payload,
  refreshing,
  refreshError,
  onRefresh,
}: {
  payload: GitHubOverviewPayload;
  refreshing: boolean;
  refreshError: string | null;
  onRefresh: () => void;
}) {
  const browseHref = payload.account?.login
    ? `https://github.com/${payload.account.login}?tab=repositories`
    : payload.repositories[0]?.owner
      ? `https://github.com/${payload.repositories[0].owner}?tab=repositories`
      : "https://github.com";

  return (
    <>
      <PageHero />
      <div className="mc-overview-ledger">
        <AccountPassport
          payload={payload}
          refreshing={refreshing}
          refreshError={refreshError}
          onRefresh={onRefresh}
        />
        <OverviewStats payload={payload} />
      </div>

      <OverviewNotices sections={payload.sections} />

      <div className="mc-overview-grid">
        <section className="mc-overview-panel" aria-labelledby="commits-title">
          <SectionHead
            titleId="commits-title"
            eyebrow="Latest authored work"
            title="Recent commits"
            count={payload.commits.length}
            countLabel={payload.commits.length === 1 ? "commit" : "commits"}
          />
          {payload.sections.commits.status === "ok" && payload.sections.commits.message && (
            <p className="mc-section-note">{payload.sections.commits.message}</p>
          )}
          {payload.commits.length > 0 ? (
            <CommitList commits={payload.commits} />
          ) : (
            <SectionEmpty
              state={payload.sections.commits}
              fallback="No recent commits authored by this account were found."
            />
          )}
        </section>

        <section className="mc-overview-panel" aria-labelledby="repositories-title">
          <SectionHead
            titleId="repositories-title"
            eyebrow="Installation inventory"
            title="Repositories"
            count={payload.sections.repositories.status === "ok" ? payload.repositoryCount : undefined}
            countLabel={payload.repositoryCount === 1 ? "repository" : "repositories"}
          />
          {payload.repositories.length > 0 ? (
            <RepositoryList
              repositories={payload.repositories}
              repositoryCount={payload.repositoryCount}
              browseHref={browseHref}
            />
          ) : (
            <SectionEmpty
              state={payload.sections.repositories}
              fallback="No repositories are available to this installation."
            />
          )}
        </section>
      </div>

      <ContributionsSection payload={payload} />
    </>
  );
}

function LoadingView() {
  return (
    <>
      <main id="main-content" className="mc-main mc-overview-loading" aria-busy="true">
        <p className="mc-visually-hidden" role="status">
          Loading the GitHub overview.
        </p>
        <PageHero />
        <div className="mc-overview-ledger" aria-hidden="true">
          <div className="mc-skeleton mc-skeleton--passport" />
          <div className="mc-skeleton mc-skeleton--stats" />
        </div>
        <div className="mc-overview-grid" aria-hidden="true">
          <div className="mc-skeleton mc-skeleton--panel" />
          <div className="mc-skeleton mc-skeleton--panel" />
        </div>
        <div className="mc-skeleton mc-skeleton--chart" aria-hidden="true" />
      </main>
    </>
  );
}

function UnauthenticatedView() {
  return (
    <main id="main-content" className="mc-main">
      <PageHero />
      <section className="mc-overview-empty" aria-labelledby="sign-in-title">
        <BrandMark className="mc-overview-empty__mark" />
        <p className="mc-eyebrow">Session required</p>
        <h2 id="sign-in-title" className="mc-overview-empty__title">
          Sign in to read your GitHub ledger.
        </h2>
        <p className="mc-overview-empty__copy">
          MixCraft uses GitHub for identity. Sign in to load the repositories, commits, and
          contribution activity available to your account.
        </p>
        <a className="mc-button mc-button--primary" href="/api/auth/github">
          Sign in with GitHub
        </a>
      </section>
    </main>
  );
}

function NotConnectedView() {
  return (
    <main id="main-content" className="mc-main">
      <PageHero />
      <section className="mc-overview-empty mc-overview-empty--connect" aria-labelledby="connect-title">
        <div className="mc-overview-empty__copyblock">
          <p className="mc-eyebrow">No GitHub installation</p>
          <h2 id="connect-title" className="mc-overview-empty__title">
            Light up the ledger.
          </h2>
          <p className="mc-overview-empty__copy">
            MixCraft needs a GitHub App installation before it can read repository, commit, or
            contribution data. Nothing is inferred, and nothing is fabricated.
          </p>
          <a className="mc-button mc-button--primary" href="/connections">
            Open connections
          </a>
        </div>
        <ol className="mc-overview-steps">
          <li>
            <span className="mc-overview-steps__number">01</span>
            <div>
              <h3>Open Connections</h3>
              <p>Choose the GitHub card in the connection workspace.</p>
            </div>
          </li>
          <li>
            <span className="mc-overview-steps__number">02</span>
            <div>
              <h3>Approve the App</h3>
              <p>Install MixCraft on the account or organization you want to read.</p>
            </div>
          </li>
          <li>
            <span className="mc-overview-steps__number">03</span>
            <div>
              <h3>Return to Overview</h3>
              <p>Repositories, commits, and contributions will appear here.</p>
            </div>
          </li>
        </ol>
      </section>
    </main>
  );
}

function ErrorView({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  return (
    <main id="main-content" className="mc-main">
      <PageHero />
      <section className="mc-overview-empty mc-overview-empty--error" role="alert">
        <p className="mc-eyebrow">Overview unavailable</p>
        <h2 className="mc-overview-empty__title">The ledger could not be read.</h2>
        <p className="mc-overview-empty__copy">{detail}</p>
        <button type="button" className="mc-button mc-button--primary" onClick={onRetry}>
          Try again
        </button>
      </section>
    </main>
  );
}

export default function OverviewPage({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [requestKey, setRequestKey] = useState(0);

  const reload = useCallback(() => setRequestKey((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setView((current) =>
      current.kind === "ready"
        ? { ...current, refreshing: true, refreshError: null }
        : { kind: "loading" },
    );

    fetchGitHubOverview({ fetchImpl, signal: controller.signal })
      .then((outcome) => {
        if (controller.signal.aborted) return;
        if (outcome.kind === "ok") {
          setView({
            kind: "ready",
            payload: outcome.payload,
            refreshing: false,
            refreshError: null,
          });
          return;
        }
        if (outcome.kind === "unauthenticated") {
          setView({ kind: "unauthenticated" });
          return;
        }
        setView((current) =>
          current.kind === "ready"
            ? { ...current, refreshing: false, refreshError: outcome.message }
            : { kind: "error", detail: outcome.message },
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const detail = error instanceof Error ? error.message : "The overview request failed.";
        setView((current) =>
          current.kind === "ready"
            ? { ...current, refreshing: false, refreshError: detail }
            : { kind: "error", detail },
        );
      });

    return () => controller.abort();
  }, [fetchImpl, requestKey]);

  return (
    <div className="mc-page">
      <div className="mc-shell">
        <SiteHeader active="overview" />

        {view.kind === "loading" && <LoadingView />}
        {view.kind === "unauthenticated" && <UnauthenticatedView />}
        {view.kind === "error" && <ErrorView detail={view.detail} onRetry={reload} />}
        {view.kind === "ready" && view.payload.connection === null && <NotConnectedView />}
        {view.kind === "ready" && view.payload.connection !== null && (
          <main id="main-content" className="mc-main" aria-busy={view.refreshing}>
            <ConnectedOverview
              payload={view.payload}
              refreshing={view.refreshing}
              refreshError={view.refreshError}
              onRefresh={reload}
            />
          </main>
        )}

        <footer className="mc-footer">
          <p className="mc-eyebrow">Read-only GitHub view / credentials stay server-side</p>
        </footer>
      </div>
    </div>
  );
}
