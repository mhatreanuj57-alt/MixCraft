import { PROVIDER_META, type ConnectionRecord, type ProviderId } from "@mixcraft/shared";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import SiteHeader from "../components/SiteHeader";
import {
  connectNpmToken,
  disconnectConnection,
  fetchConnectionsList,
  readCookieValue,
  refreshConnection,
  CSRF_COOKIE,
  CONNECTIONS_ROUTES,
  type RequestOutcome,
} from "../features/connections/api";
import {
  connectionErrorMessage,
  connectionStatusTone,
  feedbackBanner,
  parseConnectionsFeedback,
  providerLabel,
} from "../features/connections/feedback";

type ListState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "ready" }
  | { kind: "error"; detail: string };

type Banner = { tone: "success" | "danger"; title: string; detail: string } | null;

interface CardIssue {
  provider: ProviderId;
  detail: string;
}

function currentCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  return readCookieValue(document.cookie, CSRF_COOKIE);
}

function startHref(provider: ProviderId): string {
  return provider === "github" ? CONNECTIONS_ROUTES.githubStart : CONNECTIONS_ROUTES.vercelStart;
}

function formatLastValidated(value: string | null): string {
  if (!value) return "Never validated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never validated";
  return date.toLocaleString();
}

function outcomeFailureDetail(
  outcome: Extract<RequestOutcome<unknown>, { kind: "failure" }>,
): string {
  return outcome.code ? connectionErrorMessage(outcome.code) : outcome.message;
}

export default function ConnectionsPage({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [payload, setPayload] = useState<{
    connections: ConnectionRecord[];
    configured: Record<ProviderId, boolean>;
  } | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [cardIssue, setCardIssue] = useState<CardIssue | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [npmToken, setNpmToken] = useState("");
  const [npmTokenVisible, setNpmTokenVisible] = useState(false);

  const load = useCallback(async () => {
    const outcome = await fetchConnectionsList(fetchImpl);
    if (outcome.kind === "ok") {
      setPayload(outcome.payload);
      setList({ kind: "ready" });
      return;
    }
    setPayload(null);
    if (outcome.kind === "unauthenticated") {
      setList({ kind: "unauthenticated" });
      return;
    }
    setList({ kind: "error", detail: outcome.message });
  }, [fetchImpl]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const feedback = parseConnectionsFeedback(window.location.search);
    if (!feedback) return;
    setBanner(feedbackBanner(feedback));
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const runAction = useCallback(
    async (
      key: string,
      provider: ProviderId,
      action: (options: {
        csrfToken: string | null;
        fetchImpl?: typeof fetch;
      }) => Promise<RequestOutcome<unknown>>,
      successDetail: string,
    ) => {
      setBusyAction(key);
      setCardIssue(null);
      try {
        const outcome = await action({ csrfToken: currentCsrfToken(), fetchImpl });
        if (outcome.kind === "ok") {
          setBanner({ tone: "success", title: "Connection updated", detail: successDetail });
          await load();
          return;
        }
        if (outcome.kind === "unauthenticated") {
          setList({ kind: "unauthenticated" });
          return;
        }
        setCardIssue({ provider, detail: outcomeFailureDetail(outcome) });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "The request failed.";
        setCardIssue({ provider, detail });
      } finally {
        setBusyAction(null);
      }
    },
    [fetchImpl, load],
  );

  const handleNpmConnect = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const token = npmToken.trim();
      if (!token) {
        setCardIssue({ provider: "npm", detail: "Paste an npm access token to continue." });
        return;
      }
      await runAction(
        "connect:npm",
        "npm",
        (options) => connectNpmToken(token, options),
        "npm is now linked to this workspace.",
      );
      setNpmToken("");
    },
    [npmToken, runAction],
  );

  const connectionFor = (provider: ProviderId): ConnectionRecord | undefined =>
    payload?.connections.find((entry) => entry.provider === provider);

  return (
    <div className="mc-page">
      <div className="mc-shell">
        <SiteHeader active="connections" />

        <main className="mc-main">
          <section className="mc-hero" aria-labelledby="connections-title">
            <p className="mc-eyebrow">Server-held credentials Â· never sent to this browser</p>
            <h1 id="connections-title" className="mc-display">
              Connections
            </h1>
            <p className="mc-lede">
              Link GitHub, npm, and Vercel accounts to this workspace. Tokens are encrypted on the
              server; this page only ever sees account names, scopes, and status.
            </p>
          </section>

          {banner && (
            <p
              className={`mc-inline-note mc-inline-note--${banner.tone}`}
              role="status"
              aria-live="polite"
            >
              <strong>{banner.title}.</strong> {banner.detail}
            </p>
          )}

          {cardIssue && (
            <p className="mc-inline-note mc-inline-note--danger" role="alert">
              {providerLabel(cardIssue.provider)}: {cardIssue.detail}
            </p>
          )}

          <hr className="mc-rule" />

          <section className="mc-connections" aria-labelledby="providers-title">
            <div>
              <p className="mc-eyebrow">Provider status</p>
              <h2 id="providers-title" className="mc-section-heading">
                Workspace connections
              </h2>
            </div>

            {list.kind === "loading" && (
              <p className="mc-inline-note" role="status">
                Loading connectionsâ€¦
              </p>
            )}

            {list.kind === "unauthenticated" && (
              <div className="mc-inline-note" role="alert">
                Sign in to manage connections.{" "}
                <a className="mc-link" href="/api/auth/github">
                  Sign in with GitHub
                </a>
              </div>
            )}

            {list.kind === "error" && (
              <div className="mc-inline-note mc-inline-note--danger" role="alert">
                <span>{list.detail}</span>
                <button type="button" className="mc-button" onClick={() => void load()}>
                  Retry
                </button>
              </div>
            )}

            {list.kind === "ready" && payload && (
              <div className="mc-connection-grid">
                {PROVIDER_META.map(({ id, label }) => {
                  const configured = payload.configured[id];
                  const connection = connectionFor(id);
                  const tone = connection ? connectionStatusTone(connection.status) : null;
                  const refreshKey = `refresh:${id}`;
                  const disconnectKey = `disconnect:${id}`;
                  const issue = cardIssue?.provider === id ? cardIssue : null;

                  return (
                    <article
                      className="mc-connection-card"
                      key={id}
                      aria-labelledby={`${id}-title`}
                    >
                      <div className="mc-connection-card__head">
                        <h3 id={`${id}-title`} className="mc-connection-card__title">
                          {label}
                        </h3>
                        {!configured && (
                          <span className="mc-pill mc-pill--idle">Not configured</span>
                        )}
                        {configured && tone && (
                          <span className={`mc-pill mc-pill--${tone}`}>{connection?.status}</span>
                        )}
                      </div>

                      {!configured && (
                        <p className="mc-connection-card__note">
                          This server has no credentials for {label}, so connecting is unavailable.
                        </p>
                      )}

                      {configured && !connection && id === "npm" && (
                        <form
                          className="mc-token-form"
                          onSubmit={(event) => void handleNpmConnect(event)}
                        >
                          <label className="mc-field" htmlFor="npm-token">
                            <span className="mc-field__label">npm access token</span>
                            <input
                              id="npm-token"
                              className="mc-input"
                              type={npmTokenVisible ? "text" : "password"}
                              value={npmToken}
                              autoComplete="off"
                              spellCheck={false}
                              onChange={(event) => setNpmToken(event.target.value)}
                              placeholder="npm_â€¦"
                            />
                          </label>
                          <div className="mc-token-form__actions">
                            <button
                              type="submit"
                              className="mc-button mc-button--primary"
                              disabled={busyAction !== null}
                            >
                              {busyAction === "connect:npm" ? "Connectingâ€¦" : "Connect npm"}
                            </button>
                            <button
                              type="button"
                              className="mc-button"
                              onClick={() => setNpmTokenVisible((visible) => !visible)}
                            >
                              {npmTokenVisible ? "Hide" : "Show"}
                            </button>
                          </div>
                        </form>
                      )}

                      {configured && !connection && id !== "npm" && (
                        <div className="mc-connection-card__actions">
                          <a className="mc-button mc-button--primary" href={startHref(id)}>
                            Connect {label}
                          </a>
                          <p className="mc-connection-card__note">
                            You will be sent to {label} to approve access, then returned here.
                          </p>
                        </div>
                      )}

                      {configured && connection && (
                        <div className="mc-connection-body">
                          <dl className="mc-meta-list">
                            <div className="mc-meta-row">
                              <dt>Account</dt>
                              <dd>{connection.accountName ?? "Unnamed account"}</dd>
                            </div>
                            <div className="mc-meta-row">
                              <dt>Last validated</dt>
                              <dd>{formatLastValidated(connection.lastValidatedAt)}</dd>
                            </div>
                          </dl>

                          <div className="mc-connection-card__actions">
                            <button
                              type="button"
                              className="mc-button"
                              disabled={busyAction !== null}
                              onClick={() =>
                                void runAction(
                                  refreshKey,
                                  id,
                                  (options) => refreshConnection(id, connection.id, options),
                                  `${label} was revalidated against the provider.`,
                                )
                              }
                            >
                              {busyAction === refreshKey ? "Refreshingâ€¦" : "Refresh"}
                            </button>
                            <button
                              type="button"
                              className="mc-button mc-button--danger"
                              disabled={busyAction !== null}
                              onClick={() =>
                                void runAction(
                                  disconnectKey,
                                  id,
                                  (options) => disconnectConnection(id, connection.id, options),
                                  `${label} was disconnected from this workspace.`,
                                )
                              }
                            >
                              {busyAction === disconnectKey ? "Disconnectingâ€¦" : "Disconnect"}
                            </button>
                            {connection.status === "expired" && id !== "npm" && (
                              <a className="mc-button" href={startHref(id)}>
                                Reconnect {label}
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      {configured &&
                        connection &&
                        connection.status === "expired" &&
                        id === "npm" && (
                          <form
                            className="mc-token-form"
                            onSubmit={(event) => void handleNpmConnect(event)}
                          >
                            <label className="mc-field" htmlFor="npm-token-reconnect">
                              <span className="mc-field__label">New npm access token</span>
                              <input
                                id="npm-token-reconnect"
                                className="mc-input"
                                type="password"
                                value={npmToken}
                                autoComplete="off"
                                spellCheck={false}
                                onChange={(event) => setNpmToken(event.target.value)}
                                placeholder="npm_â€¦"
                              />
                            </label>
                            <div className="mc-token-form__actions">
                              <button
                                type="submit"
                                className="mc-button mc-button--primary"
                                disabled={busyAction !== null}
                              >
                                {busyAction === "connect:npm" ? "Connectingâ€¦" : "Reconnect npm"}
                              </button>
                            </div>
                          </form>
                        )}

                      {issue && (
                        <p className="mc-connection-card__issue" role="alert">
                          {issue.detail}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </main>

        <footer className="mc-footer">
          <p className="mc-eyebrow">
            Credentials are encrypted server-side Â· no tokens in this UI
          </p>
        </footer>
      </div>
    </div>
  );
}
