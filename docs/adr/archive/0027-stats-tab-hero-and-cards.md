# ADR 0027: Stats tab hero and static cards

- Status: accepted
- Date: 2026-11-02
- Applies to: dashboard Stats tab (`src/lib/gui/tabs/StatsTab.svelte`,
  `src/lib/gui/stats-view.ts`, `src/lib/gui/dashboard.css`), see
  [gui.md](../../architecture/gui.md) and [stats.md](../../architecture/stats.md)
- Supersedes in part: [ADR 0026](0026-info-tab-hero-and-single-scroll-changelog.md)
  (decision 6 kept the StatsTab layout unchanged)

## Context

The Info tab received a hero + static-card layout (ADR 0026). The Stats tab still used a
different language: KPI tiles with nested `<details open>` accordions and a bare bar section.
The folds announced an interaction that the tab did not need, the KPI tiles repeated labels
without visual hierarchy, and the total redirect count — the primary number of the tab — was
one tile among three.

The stats data pipeline (separate GM key, content-hash identity, eager deltas, 1 s poll) is
stable and out of scope. Only the rendering surface changes.

## Decision

1. **Hero with the total.** The hero shows the all-time total as the dominant number, the last
   redirect as `From → To` with a locale-aware timestamp, and a badge with the rule shape
   (`{sites} sites · {rules} rules`). No reset/export action is added.
2. **Three static cards.** `Redirects per rule` spans the full width; `Sites` and `Kinds` share
   a two-column row. Card headers reuse the icon + uppercase-title pattern from the Info tab.
   The `<details>` accordions and the KPI strip are removed.
3. **Every configured row stays visible.** Rules and sites are sorted by count descending,
   ties by label then source order. Zero-count rows are dimmed, not hidden — a checkpoint
   always renders `0` by design, and “configured but never fired” is useful information.
4. **Uniform bar rows.** All three cards use the same label/track/count grid. Per-rule and
   kind bars use the existing kind tones (`--rr-violet`, `--rr-u-query`, `--rr-warn`); site
   bars use the accent. Kind shares are computed against the summed applied-rule counts, not
   `stats.total` (one redirect can apply several rules).
5. **Shared chrome, distinct hooks.** The hero/card shell moves to `.rr-hero` / `.rr-card`;
   the Info tab keeps its `.rr-info-*` classes as markers. Stats uses `.rr-stats-*` only.
   This avoids duplicate CSS while keeping the Playwright smoke selectors unique
   (`.rr-info-hero`, `.rr-info-version-badge`).
6. **Pure derivation.** `buildStatsView()` and `formatStatsTimestamp()` move to
   `src/lib/gui/stats-view.ts` and are unit-tested. The component keeps only the sink
   subscription, the cross-context listener, and the 1 s poll fallback.
7. **Tokens and motion.** No new design tokens. Bar-width transitions use the shared motion
   tokens and are disabled under `prefers-reduced-motion` (ADR 0016).

## Consequences

- The Stats tab now matches the Info tab's hierarchy without coupling their DOM selectors.
- The data pipeline is unchanged: identities, pruning, persistence, and cross-context
  delivery keep their contracts.
- New i18n keys are limited to `stats.last.from` / `stats.last.to`; the obsolete
  `system.stats.details` key is removed.
- E2E remains valid: the Info tab keeps its `.rr-info-hero` and
  `.rr-info-version-badge` hooks, and Stats adds no duplicate selector.
- The layout is responsive at 760 px (hero/cards stack) and 560 px (bar rows become two
  lines).
