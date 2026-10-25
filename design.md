# MixCraft — Design Specifications

**Version:** 1.0  
**Visual reference:** https://github.com/mhatreanuj57-alt/credential-constellation  
**Direction:** Experimental editorial design for a developer control center

## 1. Design Vision

MixCraft should feel like a carefully designed developer workspace, not a generic SaaS template. Adapt Credential Constellation's warm-paper canvas, near-black typography, lime and orange accents, oversized expressive headlines, monospaced metadata, thin ruled lines, and restrained orbital graphics to repositories, packages, projects, deployments, and settings.

Principles:
1. Editorial, not generic.
2. Paper and ink.
3. Purposeful accent colors.
4. Visible structure through rules and borders.
5. Controlled information density.
6. Quiet controls and clear hierarchy.
7. Motion that communicates state rather than delaying work.
8. Responsive and accessible layouts.

## 2. Reference Characteristics

Use the reference repository's final editorial direction as the intended style:
- Warm paper background.
- Near-black ink.
- Neutral paper-like panels.
- Bright lime and orange accents.
- Syne display/interface typography.
- DM Mono for technical metadata.
- Oversized uppercase headlines and tight tracking.
- Thin borders, editorial rules, orbital linework, and subtle grain.
- Sharp grid layouts and restrained hover transitions.

The reference stylesheet may contain earlier theme values. For MixCraft, use the canonical palette below. Reuse the design language, not Credential Constellation's content or personal data.

## 3. Color System

| Token | Hex | Use |
|---|---|---|
| `--mc-paper` | `#F4F0E8` | Main canvas |
| `--mc-ink` | `#10100F` | Primary text and strong surfaces |
| `--mc-panel` | `#E5DFD4` | Neutral cards and grouped areas |
| `--mc-lime` | `#D7FF36` | Selected states and primary accents |
| `--mc-orange` | `#FF5A3D` | Secondary emphasis and important alerts |
| `--mc-blue` | `#6BA7FF` | Informational highlights |
| `--mc-muted` | `#60605B` | Secondary text |
| `--mc-rule` | `rgba(16, 16, 15, 0.28)` | Borders and dividers |

Suggested semantic tokens:

```css
:root {
  color-scheme: light;
  --mc-paper: #f4f0e8;
  --mc-ink: #10100f;
  --mc-panel: #e5dfd4;
  --mc-lime: #d7ff36;
  --mc-orange: #ff5a3d;
  --mc-blue: #6ba7ff;
  --mc-muted: #60605b;
  --mc-rule: rgba(16, 16, 15, 0.28);
  --mc-surface: var(--mc-paper);
  --mc-surface-raised: #faf8f2;
  --mc-surface-muted: var(--mc-panel);
  --mc-text-primary: var(--mc-ink);
  --mc-text-secondary: var(--mc-muted);
  --mc-border: var(--mc-rule);
  --mc-success: #236b3a;
  --mc-warning: #865100;
  --mc-danger: #b42318;
  --mc-info: #2457a7;
}
```

Semantic colors are functional additions, not replacements for the brand palette. Check actual contrast for every text/background combination.

### Usage rules
- Paper: app canvas and editorial areas.
- Ink: primary text, strong outlines, navigation, and dark actions.
- Panel: secondary cards, filter areas, grouped settings.
- Lime: selected filters, active indicators, accessible accent buttons.
- Orange: emphasis and danger context with explicit labels.
- Blue: informational labels and secondary highlights.

Do not rely on color alone for status. Avoid random colors, default gradients, low-contrast text, and huge saturated backgrounds.

## 4. Typography

### Syne
Use for page titles, section headings, display metrics, resource names when appropriate, and empty-state headings. Suggested weights: 400–600 for supporting headings and 700–800 for display emphasis.

### DM Mono
Use for uppercase eyebrow labels, repository metadata, IDs, status labels, timestamps, version numbers, and compact technical annotations. Do not use it for long paragraphs.

Load Syne and DM Mono from Google Fonts when available, with system fallbacks. Avoid making remote font availability a prerequisite for usability.

Suggested scale:

| Role | Size |
|---|---|
| Hero display | `clamp(3.5rem, 10vw, 8rem)` |
| Page title | `clamp(2.5rem, 5vw, 4.5rem)` |
| Section heading | `2rem–3.5rem` |
| Card heading | `1.1rem–1.5rem` |
| Body | `0.95rem–1.05rem` |
| Supporting | `0.8rem–0.9rem` |
| Metadata | `0.65rem–0.75rem` |

Use uppercase selectively, tight tracking for display text, comfortable body line height, wrapping for long resource names, and tabular numerals for metrics where useful.

## 5. Layout and Spacing

- Main content max-width: approximately `1440px`.
- Desktop gutters: `32–48px`.
- Tablet gutters: `24px`.
- Mobile gutters: `16px`.
- Major editorial section spacing: `56–96px`.
- Compact dashboard spacing: `16–28px`.
- Card gaps: `12–20px`.

Desktop can use a sidebar and flexible content area. Tablet reduces columns. Mobile collapses navigation into a drawer or compact navigation, stacks sections, and converts dense tables into scrollable tables or resource cards.

Use thin ruled separators for sections, table rows, filters, and panels. Do not box every element.

## 6. Brand Motifs

### Orbital linework
Reinterpret the reference's orbital geometry as a metaphor for connected developer platforms. Use it for a small brand mark, subtle connection diagrams, or empty states. Never obscure important data.

### Grain texture
Optional, subtle, and limited to selected editorial areas. Preserve text contrast and scrolling performance. A clean paper surface is better than an expensive texture effect.

### Shapes
Use sharp or lightly rounded cards, one-pixel borders, pill-shaped filters where useful, and minimal shadows. Avoid excessive glassmorphism and gradient-heavy cards.

## 7. Application Shell

Navigation:
- MixCraft mark
- Overview
- GitHub
- npm Packages
- Vercel
- Activity
- Connected Accounts
- Settings
- User/account menu

Header:
- Current page title and description
- Breadcrumbs where helpful
- Page-specific actions
- Connection indicators when relevant
- Account controls

The shell should feel editorial rather than like a stock dashboard template.

## 8. Core Pages

### Overview
Welcome heading, provider connection summary, repository/package/project counts, recent deployments, recent activity, connection warnings, and shortcuts. Show real or clearly labelled cached data. Distinguish disconnected providers from providers with zero resources.

### GitHub
Repository search, ownership and visibility filters, repository list/table, default branch, last activity, details, branches, commits, pull requests, workflows, and permitted write actions. Use tables for large collections.

### npm Packages
Package search/list, version and publication metadata, scope/visibility where available, package details, and supported release actions. Publishing, deprecation, and access changes require explicit confirmation.

### Vercel
Projects, deployment history/status, build details, and supported environment/domain/project settings. Status must include text and not rely on color alone.

### Connected Accounts
Provider, authorized account, status, available permissions, last validation, reconnect, and disconnect. Preserve provider-specific setup instructions.

### Activity
Chronological events with action, provider, resource, outcome, timestamp, and authorized detail links. Distinguish user actions from background synchronization.

## 9. Components

### Buttons
Primary actions use a high-contrast dark or accessible lime treatment. Secondary actions use neutral/transparent surfaces and thin borders. Destructive actions need explicit wording and confirmation when high-impact. Never rely on an icon alone.

### Resource cards
Use for provider summaries, recent deployments, small collections, connection status, and shortcuts. Include relevant metadata and a clear interaction affordance.

### Tables
Provide clear headings, row separators, sorting when supported, filters, pagination/incremental loading, responsive overflow, and accessible row actions.

### Search and filters
Provide labels, keyboard access, clear focus states, empty results, and loading indicators. Debounce requests where appropriate. Selected filter pills must retain readable contrast.

### Status badges
Examples: Connected, Disconnected, Pending, Expired, Healthy, Failed, Deploying. Pair text with an indicator/icon as appropriate.

### Dialogs and notifications
Dialogs support keyboard navigation, focus management, close controls, and Escape behavior where suitable. Use them for destructive actions, publishing, production changes, and connection setup. Important outcomes must not be communicated only through a disappearing toast.

## 10. Motion

- Hover/focus transitions: `120–220ms`.
- Small panel transitions: `180–280ms`.
- Longer editorial entrances are rare and never delay essential content.

Respect `prefers-reduced-motion`. Avoid constantly animated backgrounds, long intro animations, excessive parallax, and motion that competes with error or deployment states.

## 11. Accessibility

Target WCAG 2.2 AA for core workflows:
- Semantic HTML.
- Visible keyboard focus.
- Keyboard-accessible menus and dialogs.
- Meaningful accessible names.
- Sufficient contrast.
- State communication not based only on color.
- Labels and useful validation messages.
- Screen-reader announcements for important asynchronous outcomes.
- Reduced-motion support.
- Usable zoom and reflow.

Test actual color pairs rather than assuming every palette combination is accessible.

## 12. Responsive Breakpoints

Mobile-first starting points:

```css
@media (min-width: 640px) { /* Large mobile / small tablet */ }
@media (min-width: 768px) { /* Tablet */ }
@media (min-width: 1024px) { /* Desktop */ }
@media (min-width: 1280px) { /* Wide editorial layout */ }
```

Choose final breakpoints based on content fit, and test narrow mobile, tablet, and wide desktop widths.

## 13. Design Tokens

Centralize:
- `color.*`
- `font.*`
- `type.*`
- `space.*`
- `border.*`
- `radius.*`
- `motion.*`
- `layout.*`

Avoid duplicated hex values and inconsistent component spacing.

## 14. Quality Checklist

- Paper-and-ink identity preserved.
- Syne and DM Mono used consistently.
- Lime and orange are purposeful.
- Data is easy to scan.
- Search, filters, loading, empty, and error states are complete.
- Keyboard focus is visible.
- Contrast is sufficient.
- Reduced motion is respected.
- Mobile layouts are usable.
- Destructive actions are unmistakable.
- No fabricated metrics or provider statuses.

## 15. OpenCode Rules

1. Read this document before building UI.
2. Use Credential Constellation as the visual reference.
3. Preserve the palette and typography.
4. Prefer reusable components and shared tokens.
5. Avoid generic gradient-heavy styling, excessive shadows, and excessive rounding.
6. Build responsive, accessible interactions.
7. Respect reduced-motion preferences.
8. Never sacrifice readability for decoration.
9. Keep design consistent across providers.
10. Update this specification when the visual system changes intentionally.

Reference: https://github.com/mhatreanuj57-alt/credential-constellation
