# MixCraft — Directory and File Structure

**Version:** 1.0  
**Architecture:** Modular TypeScript monorepo  
**Development tool:** OpenCode

## 1. Purpose

This document describes the target repository structure, not a claim that every file already exists. OpenCode should create files incrementally as features are implemented rather than generating the entire application at once.

## 2. Repository Root

```text
mixcraft/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── database/
│   ├── shared/
│   └── config/
├── tests/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── adr/
│   ├── development.md
│   ├── security.md
│   └── deployment.md
├── scripts/
├── prd.md
├── architecture.md
├── design.md
├── file_structure.md
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── .gitignore
├── .editorconfig
├── .env.example
└── README.md
```

- `apps/`: frontend and backend.
- `packages/`: shared libraries and infrastructure.
- `tests/`: cross-module integration and browser tests.
- `docs/`: operational documentation and architecture decisions.
- `scripts/`: maintenance and development utilities.
- Root Markdown files: product, architecture, design, and structure specifications.

Use pnpm workspaces unless an existing repository requires another package manager. Do not commit dependency directories, build output, real environment files, or local secret material.

## 3. Frontend Structure

```text
apps/web/
├── public/
│   ├── favicon.svg
│   └── assets/
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── router.tsx
│   │   └── providers.tsx
│   ├── layouts/
│   │   ├── AppLayout.tsx
│   │   └── AuthLayout.tsx
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── OverviewPage.tsx
│   │   ├── ConnectionsPage.tsx
│   │   ├── ActivityPage.tsx
│   │   ├── SettingsPage.tsx
│   │   ├── github/
│   │   │   ├── RepositoriesPage.tsx
│   │   │   └── RepositoryDetailPage.tsx
│   │   ├── npm/
│   │   │   ├── PackagesPage.tsx
│   │   │   └── PackageDetailPage.tsx
│   │   └── vercel/
│   │       ├── ProjectsPage.tsx
│   │       └── DeploymentsPage.tsx
│   ├── components/
│   │   ├── ui/
│   │   ├── navigation/
│   │   ├── feedback/
│   │   ├── data-display/
│   │   ├── dialogs/
│   │   └── providers/
│   ├── features/
│   │   ├── auth/
│   │   ├── connections/
│   │   ├── overview/
│   │   ├── github/
│   │   ├── npm/
│   │   ├── vercel/
│   │   └── activity/
│   ├── hooks/
│   ├── lib/
│   │   ├── api-client.ts
│   │   ├── query-client.ts
│   │   └── formatters.ts
│   ├── styles/
│   │   ├── tokens.css
│   │   ├── global.css
│   │   └── typography.css
│   ├── types/
│   ├── main.tsx
│   └── vite-env.d.ts
├── tests/
│   └── components/
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### Frontend responsibilities
- `app/`: application composition, routing, and global providers.
- `layouts/`: authenticated dashboard and auth shells.
- `pages/`: route-level composition.
- `components/ui/`: reusable accessible visual primitives.
- `components/navigation/`: sidebar, mobile navigation, breadcrumbs, account menu.
- `components/feedback/`: loading, empty, error, connection-warning, and operation feedback.
- `features/`: feature-specific UI and API hooks.
- `lib/`: API client, query configuration, and formatters.
- `styles/`: canonical design tokens and global styling.

A feature may use this pattern when needed:

```text
features/github/
├── api.ts
├── hooks.ts
├── types.ts
├── components/
├── utils.ts
└── index.ts
```

Create only files needed by the active milestone. The frontend must call MixCraft's API and must never contain provider secrets or stored tokens.

## 4. Backend Structure

```text
apps/api/
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── config/
│   │   ├── env.ts
│   │   └── constants.ts
│   ├── plugins/
│   │   ├── database.ts
│   │   ├── session.ts
│   │   ├── security.ts
│   │   └── observability.ts
│   ├── middleware/
│   │   ├── require-auth.ts
│   │   ├── rate-limit.ts
│   │   ├── request-context.ts
│   │   └── error-handler.ts
│   ├── routes/
│   │   ├── health.routes.ts
│   │   ├── auth.routes.ts
│   │   ├── connections.routes.ts
│   │   ├── dashboard.routes.ts
│   │   ├── github.routes.ts
│   │   ├── npm.routes.ts
│   │   ├── vercel.routes.ts
│   │   └── activity.routes.ts
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── connections/
│   │   ├── github/
│   │   ├── npm/
│   │   ├── vercel/
│   │   ├── dashboard/
│   │   └── audit/
│   ├── providers/
│   │   ├── registry.ts
│   │   ├── github/
│   │   ├── npm/
│   │   └── vercel/
│   ├── security/
│   │   ├── encryption.ts
│   │   ├── csrf.ts
│   │   ├── oauth-state.ts
│   │   └── secret-redaction.ts
│   ├── services/
│   ├── jobs/
│   ├── utils/
│   └── types/
├── tests/
│   ├── unit/
│   └── integration/
├── package.json
└── tsconfig.json
```

### Backend responsibilities
- `app.ts`: constructs the Fastify app for runtime and tests.
- `server.ts`: starts the server and handles shutdown.
- `config/`: validates runtime environment.
- `plugins/`: database, session, security, and observability integration.
- `middleware/`: authentication enforcement, rate limiting, request context, error handling.
- `routes/`: validate HTTP input and call services; keep handlers thin.
- `modules/`: business logic by domain.
- `providers/`: external provider adapters and clients.
- `security/`: credential encryption, OAuth state, CSRF, and redaction.
- `services/`: cross-domain orchestration only.
- `jobs/`: optional background work when needed.

Example domain module:

```text
modules/connections/
├── connection.service.ts
├── connection.repository.ts
├── connection.schemas.ts
├── connection.types.ts
└── connection.test.ts
```

Example GitHub adapter:

```text
providers/github/
├── github.adapter.ts
├── github.client.ts
├── github.auth.ts
├── github.repositories.ts
├── github.pull-requests.ts
├── github.actions.ts
├── github.errors.ts
└── index.ts
```

Create resource-specific files only when their features are implemented. npm and Vercel follow the same organizational principle but retain their own authentication methods.

## 5. Database Package

```text
packages/database/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── client.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

Defines relational models, migrations, a shared Prisma client, and optional development seed data. Never seed production with fake provider connections, fabricated counts, or hardcoded credentials.

## 6. Shared Package

```text
packages/shared/
├── src/
│   ├── schemas/
│   │   ├── api.ts
│   │   ├── auth.ts
│   │   ├── connections.ts
│   │   └── pagination.ts
│   ├── types/
│   │   ├── api.ts
│   │   ├── providers.ts
│   │   └── errors.ts
│   ├── constants/
│   ├── formatters/
│   └── index.ts
├── package.json
└── tsconfig.json
```

Share safe API contracts, pagination schemas, provider identifiers, normalized errors, and public connection status types. Do not export server-only secrets, database details, or token-bearing types to the browser. Backend validation and authorization remain authoritative.

## 7. Shared Configuration

```text
packages/config/
├── eslint/
├── typescript/
├── prettier/
├── package.json
└── README.md
```

Centralize common linting, TypeScript, and formatting rules only where it reduces duplication.

## 8. Testing Structure

Frontend:

```text
apps/web/tests/
├── components/
├── features/
└── pages/
```

Backend:

```text
apps/api/tests/
├── unit/
│   ├── services/
│   ├── security/
│   └── providers/
└── integration/
    ├── auth/
    ├── connections/
    └── resources/
```

End-to-end:

```text
tests/e2e/
├── login.spec.ts
├── connections.spec.ts
├── github.spec.ts
├── npm.spec.ts
└── vercel.spec.ts
```

Test sessions, connection ownership, encryption, OAuth state, permissions, error mapping, loading and error states, keyboard behavior, and important user journeys. Use test accounts or mocks, never production credentials.

## 9. Documentation Structure

```text
docs/
├── adr/
│   ├── 0001-modular-monolith.md
│   ├── 0002-provider-connections.md
│   └── 0003-credential-storage.md
├── development.md
├── security.md
└── deployment.md
```

- `adr/`: significant decisions, alternatives, consequences, security implications, and migrations.
- `development.md`: setup, scripts, tests, conventions.
- `security.md`: threat model, credential handling, incident response.
- `deployment.md`: environments, migrations, health checks, rollback.

## 10. Root Configuration

- `package.json`: workspace scripts for dev, build, lint, typecheck, and test.
- `pnpm-workspace.yaml`: workspace package registration.
- `pnpm-lock.yaml`: reproducible dependency resolution; commit it.
- `tsconfig.base.json`: shared TypeScript settings.
- `.env.example`: variable names with empty/non-secret placeholders only.
- `.gitignore`: environment secrets, `node_modules`, build output, coverage, logs, temporary files, and local-only tool state.
- `.editorconfig`: indentation, line endings, and whitespace.
- `README.md`: overview, prerequisites, setup, commands, architecture links, security notes, and contribution conventions.

## 11. Naming Conventions

- React components: `RepositoryCard.tsx`.
- Backend services: `repository.service.ts`.
- Route modules: `github.routes.ts`.
- Validation: `connection.schemas.ts`.
- Tests: `connection.service.test.ts`.
- Documentation: lowercase kebab-case Markdown.

Use PascalCase for types and React components, camelCase for functions and variables, and uppercase snake case for environment variables. Keep provider identifiers stable: `github`, `npm`, `vercel`.

## 12. Dependency Rules

Recommended dependency direction:
1. Shared contracts.
2. Database and infrastructure.
3. Provider adapters and domain services.
4. API routes.
5. Frontend API clients and feature components.
6. Pages and layouts.

Frontend must not import backend modules. Shared packages must not import server-only secrets or database implementation details. Provider adapters must not depend on React. Avoid circular dependencies.

## 13. Adding a Provider

1. Define capabilities and provider metadata.
2. Implement supported authorization or credential connection.
3. Implement the provider adapter.
4. Add persistence requirements if needed.
5. Add typed routes and application services.
6. Add frontend connection and resource views.
7. Add permission, error, and integration tests.
8. Update relevant documentation.
9. Record security and operational implications.

Do not scatter provider-specific conditionals across unrelated components.

## 14. OpenCode Rules

- Read all four root specifications before implementation.
- Inspect the repository before creating or replacing files.
- Implement only the active milestone.
- Preserve working code unless changes are necessary.
- Keep frontend, backend, database, and provider modules separate.
- Use TypeScript and shared validation contracts.
- Keep credentials server-side.
- Never route mock data into production paths.
- Add tests for new behavior.
- Run configured build, lint, type-check, and test commands.
- Report incomplete work honestly.
- Do not commit or push unless explicitly instructed.
- Avoid unrelated dependencies and boilerplate.

## 15. Implementation Order

1. Workspace foundation and application entry points.
2. Environment validation, database schema, and sessions.
3. GitHub login and read-only repository workflows.
4. npm connection and package browsing.
5. Vercel connection, projects, and deployments.
6. Carefully scoped write operations and audit logging.
7. Security hardening, end-to-end tests, deployment docs.
8. Additional providers after core flows are stable.

## 16. Structural Completion Criteria

- Workspace install works.
- Frontend and backend start independently.
- Shared packages resolve.
- Environment validation is active.
- Database migrations are reproducible.
- Provider adapters are independently testable.
- Frontend cannot import server-only credentials.
- Build, lint, type-check, and test commands are documented.
- Documentation matches implementation.
- Future providers can be added without major restructuring.

References: `prd.md`, `architecture.md`, `design.md`, and https://github.com/mhatreanuj57-alt/credential-constellation
