# MixCraft — Product Requirements Document

**Version:** 1.0  
**Status:** Initial specification  
**Product:** MixCraft Developer Dashboard

## 1. Product Summary

MixCraft is a unified developer dashboard where users can connect and manage their GitHub, npmjs, and Vercel accounts from one interface. GitHub is the primary identity provider; npmjs and Vercel are connected independently through their own supported authorization or credential flows.

MixCraft provides a single place to inspect repositories, packages, projects, deployments, and relevant activity. Management is **Level 3: full developer control within the permissions granted by each provider**. MixCraft must never bypass provider permissions or imply that a user can manage resources their connected account cannot access.

## 2. Problem Statement

Developers switch between multiple provider dashboards to inspect repositories, packages, deployments, and project settings. MixCraft reduces this context switching while preserving each provider's security model and access boundaries.

## 3. Goals

- Sign in with GitHub.
- Independently connect, validate, reconnect, and disconnect npmjs and Vercel.
- Display GitHub repositories, npm packages, Vercel projects, and deployment information available to the connected accounts.
- Support safe write operations when the provider API and granted permissions allow them.
- Keep provider tokens and client secrets on the server.
- Make connection status, granted capabilities, errors, and recent activity understandable.
- Use a modular architecture that supports additional providers later.

## 4. Non-goals for the First MVP

- Replacing the native GitHub, npm, or Vercel dashboards.
- Bypassing provider permissions, organization policies, branch protection, or package access rules.
- Storing provider account passwords.
- Supporting every possible operation from every provider on day one.
- Building a microservice architecture before it is necessary.
- Fabricating data when a provider is unavailable.
- Automatic destructive operations without explicit confirmation.

## 5. Target Users

- Individual developers managing personal repositories, packages, and deployments.
- Open-source maintainers managing repositories and releases.
- Developers maintaining projects across GitHub, npmjs, and Vercel.
- Small teams, with team workspaces considered a future capability.

## 6. Core User Journeys

### 6.1 Sign in with GitHub

1. User selects **Sign in with GitHub**.
2. MixCraft redirects to GitHub's supported authorization flow.
3. Backend validates the callback and authorization transaction.
4. MixCraft resolves the stable GitHub identity and creates or retrieves a local user.
5. A secure server-managed session is created.
6. User arrives at the dashboard.

### 6.2 Connect npmjs

1. Authenticated user opens Connected Accounts.
2. User selects **Connect npm**.
3. MixCraft explains the supported token type and minimum required permissions.
4. User supplies a supported npm granular access token through a protected form.
5. Backend validates the credential using an appropriate supported operation.
6. Backend encrypts and stores it; UI receives only safe connection metadata.
7. User can inspect accessible packages and supported operations.

Do not invent an npm OAuth flow or ask for the user's npm password.

### 6.3 Connect Vercel

1. User selects **Connect Vercel**.
2. Backend starts Vercel's supported authorization flow.
3. User authorizes the registered integration.
4. Backend validates state, exchanges the authorization code, and stores encrypted credentials.
5. MixCraft displays the connected account and accessible projects.

### 6.4 Manage resources

Users can browse resources, inspect details, search and filter, and perform supported operations. Every write operation must be checked against MixCraft ownership rules and the provider's current permissions.

### 6.5 Disconnect a provider

The user selects Disconnect and confirms. MixCraft revokes credentials where supported, deletes or disables locally stored credentials, clears relevant caches, and records a sanitized audit event. Disconnecting a provider does not delete the user's external resources.

## 7. Functional Requirements

### Authentication and accounts

- GitHub is the primary sign-in provider.
- Sessions are server-managed and stored in secure cookies.
- Login transactions use single-use state and PKCE where supported by the selected flow.
- Users can log out and revoke local sessions.
- Provider connections remain independent from MixCraft login identity.

### Connections

- Show provider, connected account, status, last validation time, and available capabilities.
- Support connect, reconnect, validate, and disconnect.
- Handle expired credentials, revoked permissions, rate limits, and provider outages.
- Never return provider tokens to the browser.

### GitHub

- List repositories visible to the authorized identity or installation.
- Show repository details, branches, commits, pull requests, and workflow runs where supported.
- Support selected repository write actions only after permissions and API support are verified.
- Respect repository visibility, organization policy, installation scope, and branch protection.

### npmjs

- List accessible packages and display package/version metadata.
- Show package scope and access information where available.
- Add publishing, deprecation, or access-management features only when the chosen npm APIs and token permissions support them.
- Require confirmation for publishing, deprecation, or access changes.

### Vercel

- List authorized projects and deployments.
- Display deployment status and details.
- Support project or environment operations only when supported by the Vercel API and granted permissions.
- Confirm production-impacting actions and environment-variable changes.

### Dashboard and activity

- Show real provider data or clearly labelled cached data.
- Distinguish “not connected,” “no resources,” “loading,” and “provider unavailable.”
- Show recent operations and sanitized outcomes.
- Never display fabricated resource counts or fake success states.

## 8. Level 3 Management Policy

“Full developer control” means full control **within the provider permissions and policies available to the connected account**, not unrestricted platform-wide access.

Every operation must:
1. Authenticate the MixCraft user.
2. Validate the request.
3. Verify connection ownership.
4. Verify the requested capability and local policy.
5. Obtain the correct provider credential.
6. Call the provider API.
7. Normalize the result and audit the outcome.

High-impact actions require explicit confirmation. Provider permissions may change at any time; the provider's final authorization decision remains authoritative.

## 9. Non-functional Requirements

- **Security:** encrypted credentials, least privilege, CSRF protection, rate limiting, secret redaction.
- **Reliability:** provider-specific error handling and graceful partial dashboard failures.
- **Performance:** paginate large resource collections and cache non-secret metadata with bounded TTLs.
- **Accessibility:** target WCAG 2.2 AA for core workflows.
- **Maintainability:** modular monolith, typed interfaces, shared validation contracts, automated tests.
- **Privacy:** collect only necessary metadata and provide disconnection and deletion policies.
- **Observability:** request IDs, structured logs, health checks, and sanitized audit events.

## 10. MVP Scope and Roadmap

### Phase 0 — Foundation
- Repository workspace and scripts.
- Frontend and backend skeleton.
- Environment validation.
- Shared types and validation.
- PostgreSQL connection and migrations.
- Design tokens based on `design.md`.

### Phase 1 — Identity and security
- GitHub login.
- Server-managed sessions.
- OAuth transaction handling.
- Credential encryption abstraction.
- Connection and audit schema.

### Phase 2 — GitHub read workflows
- GitHub adapter.
- Repository list and details.
- Branches, commits, pull requests, and workflow runs where permitted.
- Loading, empty, error, and permission states.

### Phase 3 — npm
- Secure token connection flow.
- Credential validation and encryption.
- Accessible package list and package details.
- Tests for invalid, expired, and insufficient tokens.

### Phase 4 — Vercel
- Supported OAuth connection.
- Project list and deployment views.
- Connection failure and permission states.

### Phase 5 — Controlled write operations
- Add a small, explicitly defined set of supported write actions.
- Confirmation UI and audit logging.
- Provider-specific permission and failure tests.

### Phase 6 — Hardening
- End-to-end tests.
- Rate-limit handling and cache policy.
- Security review, backups, monitoring, deployment documentation.
- Additional providers only after the core workflows are reliable.

## 11. Success Criteria

- A user can sign in with GitHub and maintain a session securely.
- npm and Vercel can be connected and disconnected independently.
- The dashboard only shows resources the connected provider account is allowed to access.
- Provider tokens are never exposed to frontend code or logs.
- Provider failures are represented honestly and do not break unrelated providers.
- Core flows have unit, integration, and end-to-end coverage.
- The UI follows the visual system in `design.md`.

## 12. Risks and Dependencies

- Provider API capabilities, token types, scopes, and integration approval requirements may change.
- Some operations may require a GitHub App installation, organization approval, or specific npm/Vercel permissions.
- Rate limits can affect synchronization and dashboard freshness.
- Provider APIs may return ambiguous outcomes for write operations.
- Token encryption and key rotation must be implemented before production credential storage.

Verify provider-specific requirements against official documentation during implementation. Never assume an endpoint or authorization flow exists without checking it.

## 13. Product Decisions

- GitHub is the MixCraft identity provider.
- npmjs and Vercel have independent connection flows.
- Backend is the only component that accesses provider credentials.
- MVP uses a modular monolith.
- Provider adapters isolate external APIs.
- High-impact operations require explicit confirmation.
- New features are delivered incrementally and tested before expansion.
