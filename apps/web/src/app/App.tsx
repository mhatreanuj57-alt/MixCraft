import type { ApiSuccessResponse } from "@mixcraft/shared";
import { useEffect, useState } from "react";
import ConnectionsPage from "../pages/ConnectionsPage";

interface HealthPayload {
  status: string;
  service: string;
  environment: string;
}

type HealthState =
  | { kind: "checking" }
  | { kind: "online"; payload: HealthPayload }
  | { kind: "offline"; detail: string };

function BrandMark() {
  return (
    <svg
      className="mc-brand-mark"
      viewBox="0 0 40 40"
      width="36"
      height="36"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse
        cx="20"
        cy="20"
        rx="16"
        ry="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        transform="rotate(-28 20 20)"
      />
      <ellipse
        cx="20"
        cy="20"
        rx="16"
        ry="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        transform="rotate(34 20 20)"
      />
      <circle cx="20" cy="20" r="3.4" fill="currentColor" />
      <circle cx="31" cy="13" r="2.4" fill="var(--mc-lime)" stroke="currentColor" strokeWidth="1" />
      <circle
        cx="9"
        cy="27"
        r="1.9"
        fill="var(--mc-orange)"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

export default function App() {
  const [pathname, setPathname] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname,
  );
  const [health, setHealth] = useState<HealthState>({ kind: "checking" });

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (pathname !== "/") {
      return;
    }
    const controller = new AbortController();

    fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Health endpoint returned HTTP ${response.status}`);
        }
        const body = (await response.json()) as ApiSuccessResponse<HealthPayload>;
        setHealth({ kind: "online", payload: body.data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        const detail = error instanceof Error ? error.message : "Unable to reach the API";
        setHealth({ kind: "offline", detail });
      });

    return () => controller.abort();
  }, [pathname]);

  const statusLabel =
    health.kind === "checking" ? "CHECKING" : health.kind === "online" ? "ONLINE" : "OFFLINE";

  if (pathname !== "/") {
    return <ConnectionsPage />;
  }

  return (
    <div className="mc-page">
      <div className="mc-shell">
        <header className="mc-header">
          <div className="mc-brand">
            <BrandMark />
            <div>
              <p className="mc-eyebrow">Developer Control Center</p>
              <p className="mc-brand-name">MixCraft</p>
            </div>
          </div>
          <p className="mc-eyebrow mc-header-meta">Stage 03 — Provider Connections</p>
        </header>

        <main className="mc-main">
          <section className="mc-hero" aria-labelledby="hero-title">
            <p className="mc-eyebrow">GitHub · npm · Vercel in one workspace</p>
            <h1 id="hero-title" className="mc-display">
              MixCraft
            </h1>
            <p className="mc-lede">
              Inspect repositories, packages, projects, and deployments from one editorial
              workspace. Provider credentials stay on the server — they never reach this browser.
            </p>
          </section>

          <hr className="mc-rule" />

          <section className="mc-status" aria-labelledby="status-title">
            <div>
              <p className="mc-eyebrow">Live system state</p>
              <h2 id="status-title" className="mc-section-heading">
                Workspace status
              </h2>
            </div>

            <dl className="mc-meta-list" aria-live="polite">
              <div className="mc-meta-row">
                <dt>Toolchain</dt>
                <dd>pnpm · TypeScript · Vite · Fastify</dd>
              </div>
              <div className="mc-meta-row">
                <dt>API</dt>
                <dd>
                  <span
                    className={`mc-status-dot mc-status-dot--${health.kind}`}
                    aria-hidden="true"
                  />
                  {statusLabel}
                </dd>
              </div>
              <div className="mc-meta-row">
                <dt>Providers</dt>
                <dd>
                  <a className="mc-link" href="/connections">
                    Manage connections
                  </a>
                </dd>
              </div>
            </dl>

            {health.kind === "online" && (
              <p className="mc-inline-note" role="status">
                API online — service <strong>{health.payload.service}</strong> responding in{" "}
                <strong>{health.payload.environment}</strong> mode.
              </p>
            )}

            {health.kind === "offline" && (
              <p className="mc-inline-note" role="status">
                {health.detail}. Start the API with <strong>pnpm dev</strong> to see live status.
              </p>
            )}
          </section>
        </main>

        <footer className="mc-footer">
          <p className="mc-eyebrow">
            Stage 03 · Provider credentials held server-side · No fabricated metrics
          </p>
        </footer>
      </div>
    </div>
  );
}
