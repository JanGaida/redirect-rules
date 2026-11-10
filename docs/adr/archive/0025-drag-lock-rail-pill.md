# ADR 0025: Drag-lock pill in the rail footer

- Status: superseded by [ADR 0029](0029-drag-handle-replaces-drag-lock.md)
- Date: 2026-11-02
- Applies to: the dashboard root (`src/lib/gui/App.svelte`,
  `src/lib/gui/dashboard.css`, `src/lib/gui/icon.ts`), the rail footer, and
  `docs/architecture/gui.md`; amends
  [ADR 0023](0023-dashboard-rail-navigation.md) decision 2

## Context

ADR 0023 placed the global drag lock in the header actions (refresh → undo →
drag lock → close) and kept it visible only on the Rules tab. The rail footer
already carries the theme, locale, and autosave pills in a wrapping flex row at
the narrow rail width. The user wants the lock in the bottom-left utility
cluster directly next to the autosave stopwatch, with the neutral pill chrome of
those controls instead of the amber header button, and with glyphs that read as
drag states rather than padlocks.

A fourth flex-wrap pill would move the stopwatch whenever the Rules-only lock
appears or disappears, and the rail has no horizontal room for four 28px pills
on one line.

## Decision

1. **Move the lock out of the header actions.** `.rr-header-actions` keeps
   refresh → undo → close. The lock joins `.rr-rail-tools` as the fourth cell;
   the tools become a fixed **2x2 grid** (theme + locale / autosave + drag
   lock) of centered 28px cells. The lock stays **Rules-tab only**; on other
   tabs the fourth cell stays empty, so the stopwatch keeps its position.
2. **Neutral pill chrome.** `.rr-lock-toggle` joins the shared
   `.rr-theme-toggle` / `.rr-autosave-toggle` rule: `--rr-panel-2` background,
   `--rr-btn-line` border, `--rr-muted` text, `--rr-text` + `--rr-border-strong`
   on hover, `--rr-ring` focus ring. No `--rr-warn`/amber.
3. **Drag-state glyphs instead of padlocks.** Unlocked shows the Material
   Symbols `drag_pan` (move), locked shows `drag_click` (cursor). Both are
   inline SVG strings in `icon.ts` with the source `fill="#e3e3e3"` that the
   global `.rr-icon svg { fill: currentColor }` overrides; no Google-Fonts
   `<link>` is introduced (ADR 0011 hosting reality). `lock`/`lockOpen` are
   removed from the registry.
4. **State semantics unchanged.** `aria-pressed` mirrors the effective lock;
   `aria-label`/`title` stay action-based (`a11y.unlock` while locked,
   `a11y.lock` while unlocked). No new i18n keys.

## Consequences

- The lock sits next to the autosave stopwatch; the fixed 2x2 grid keeps every
  pill in its cell when the Rules-only lock appears, so the footer height and
  the other pills stay put.
- The header loses one secondary action and is limited to refresh, undo, and
  close.
- The neutral chrome makes the lock visually part of the utility cluster; the
  lock state is conveyed by the glyph plus `aria-pressed` rather than color.
- No settings, storage, or migration changes: `dragLock` remains a session-only
  override of `settings.defaultLocked`.
- Existing E2E selectors for `.rr-theme-toggle`, `.rr-lang-toggle`,
  `.rr-autosave-toggle`, and the rail tabs remain valid.
