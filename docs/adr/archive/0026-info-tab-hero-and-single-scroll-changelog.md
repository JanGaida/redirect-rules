# ADR 0026: Info tab hero layout and single-scroll changelog

- Status: accepted
- Date: 2026-11-02
- Applies to: dashboard Info tab (`src/lib/gui/tabs/InfoTab.svelte`,
  `src/lib/gui/changelog.ts`, `src/lib/gui/dashboard.css`), see
  [gui.md](../../architecture/gui.md)
- Superseded in part by: [ADR 0027](0027-stats-tab-hero-and-cards.md) (StatsTab adopts the
  same hero + card model; the “Info tab only” consequence no longer holds)

## Context

The Info tab was still built from two `<details open>` blocks whose native folding was
cancelled by `preventFold`. The markup announced an accordion that could never collapse, and
the About block was a flat row list without visual hierarchy. The changelog lived in its own
`max-height: 28em` scroll box, so the tab had a nested scroll area inside the already scrolling
tab body.

The requested restyle is a marketing-style hero. That introduces one technical constraint: a
sticky version heading only stops at the end of its containing block. Multiple sticky `h2`
siblings share the same containing block, so the older version header would stay pinned and
overlap the next one. Sticky headings therefore require one section per version.

## Decision

1. **Hero + details card.** The hero shows the dashboard title, a version badge,
   the tagline (`info.tagline`), and a CTA row: view source (`info.viewSource`), create issue,
   and copy debug info. Author, repository, license, build SHA, and build date move into a
   separate details card rendered as a `dl` grid.
2. **No fake accordion.** The `<details>` elements and `preventFold` are removed. The cards are
   static `<section>` elements with explicit headings.
3. **Single-scroll changelog.** The changelog card has no inner scroll; the tab body owns the
   scroll. Only `##` version headings are sticky. `h1` and `h3` stay in normal flow.
4. **Version sections.** `renderChangelog(markdown)` moves from the component into
   `src/lib/gui/changelog.ts` and wraps every `##` version in
   `<section class="rr-changelog-version">`. The section is the sticky containing block, so a
   version header releases at the version boundary. The renderer keeps the existing escaping,
   link sanitizing, and ADR/docs plain-text rules and is covered by unit tests.
5. **Tokens only.** The hero glow is a radial gradient using `--rr-accent-soft` over
   `--rr-panel`. No new global tokens or hardcoded colors; the ghost-button language from
   ADR 0018 stays.
6. **Info tab only.** StatsTab and SystemTab keep their layout. The shared `.rr-info-body`
   container and `.rr-centered-root` width stay unchanged.

## Consequences

- The Info tab no longer exposes a folding affordance it never honored; all actions and links
  keep their previous targets and accessible names.
- E2E contracts survive: the version text and `.rr-changelog` content are unchanged. New
  structural hooks are `.rr-info-hero`, `.rr-info-version-badge`, and
  `.rr-changelog-version`.
- Sticky headings require `overflow: visible` on the card and the changelog body. Future
  changelog versions must stay `##` headings for the sticky behavior to apply.
- The changelog renderer is now pure and unit-tested instead of being embedded in the Svelte
  component.
- Dark and light themes remain token-driven; the hero gradient needs visual re-verification in
  both themes but no theme-specific overrides.
