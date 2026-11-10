# ADR 0028: Brand color from the app icon (brand vs text accent)

- Status: accepted
- Date: 2026-11-02
- Applies to: dashboard tokens (`src/lib/gui/dashboard.css`), dev console
  (`index.html`), app icon (`assets/icons/app/icon.svg`), see
  [gui.md](../../architecture/gui.md)
- Supersedes in part: [ADR 0026](0026-info-tab-hero-and-single-scroll-changelog.md)
  (decision 5: no new global tokens), [ADR 0027](0027-stats-tab-hero-and-cards.md)
  (decision 4: site bars use the accent)

## Context

The app icon (`assets/icons/app/icon.svg`) is a `#3b82f6` rounded square. In the dark theme
`--rr-accent` already equals that fill, so the dashboard chrome and the icon matched. In the
light themes the accent is deliberately darkened (`#1d4ed8` forced, `#3561e8` auto) because
the accent doubles as a text color on light surfaces; `#3b82f6` as 10px text reaches only
~2.7:1 on the active rail-tab band, below WCAG AA (4.5:1). The result was a visible mismatch:
the header app icon stayed `#3b82f6` while brand surfaces, notably the active tab, rendered
in the darker accent.

## Decision

1. **One brand token.** `--rr-brand: #3b82f6` and `--rr-brand-soft: rgba(59, 130, 246, 0.15)`
   are declared once in the dark `:root` and never overridden by the light/auto-light blocks.
   The value is the app-icon fill; a unit test enforces icon == token (dashboard + dev
   console).
2. **Brand vs text accent.** Brand tokens are used for brand surfaces and glyphs: active
   rail tab (glyph, frame, marker, active band), both FABs and their popover frames, open
   rule card, drag/drop targets, selected chain step, Info/Stats badges, Info hero glow,
   stats bar fill, and the dev-console primary button. `--rr-accent` stays the theme-specific
   text and functional color (links, labels, button text, focus rings, autosave ring,
   splitter).
3. **Tab label stays readable.** The active rail tab uses the brand band/frame/glyph but keeps
   its label on `--rr-accent` (4.9:1 forced light). `#3b82f6` is never used for small text.
4. **No dark change.** Dark brand == dark accent; the dark theme renders exactly as before.

## Consequences

- The primary chrome now matches the distributed icon in all themes; light text keeps AA.
- Two blue tokens must be kept distinct: future surfaces choose brand, future text chooses
  accent. The guard test only protects the brand value, not the classification.
- Functional indicators stay on the accent where brand would drop below 3:1 in light
  (autosave ring, splitter capsule, focus rings).
- Auto-light's label accent `#3561e8` remains a pre-existing below-AA case; unifying it with
  `#1d4ed8` is a separate decision.
