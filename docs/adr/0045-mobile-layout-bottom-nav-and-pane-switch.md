# ADR 0045: Mobile layout — bottom navigation and phone pane switch

- Status: accepted (2026-11-11; amended 2026-11-11 — preview chain-step selects
  silently; reveal only on the explicit Rules switch; pane switch moved above the
  bottom bar)
- Deciders: project owner
- Applies to: `src/lib/gui/App.svelte`, `src/lib/gui/tabs/RulesTab.svelte`,
  `src/lib/gui/dashboard.css`, `src/lib/gui/dashboard-meta.ts`,
  `src/lib/data/i18n.json`, `e2e/tests/mobile-layout.spec.ts`; builds on
  [ADR 0031](0031-dashboard-interaction-model.md) and
  [ADR 0032](0032-touch-input-support.md); see [gui.md](../architecture/gui.md)

## Context

The dashboard was desktop-first. A 92px side rail carried the five tabs, the
DEV/HMR chips, the theme/locale/skipped/autosave utilities and the version; the
Rules tab was a two-column split (explorer | grip | preview) that stacked into
two rows below 1100px.

Three concrete problems on phones:

- The side rail cost 80px of a ~360px viewport and the four utility pills plus
  the version column stayed in the rail footer, where they were cramped and
  partially unreachable once the tab list grew.
- The stacked split gave both panes ~250px each. With the on-screen keyboard
  open a rule editor row plus the preview became two unusable scroll areas.
- Every cross-pane entry into the explorer (chain-step click, add rule,
  assistant reveal) assumes the explorer is visible; on a phone it is not.

The stacked split had a second, purely visual defect: in the empty state the
preview cell renders an inert filter mirror. Directly under the real filter the
mirror reads as a broken duplicate of the search field.

## Decision

**Breakpoint contract.** `(max-width: 760px)` is the single switch between
"side rail" and "bottom bar". CSS and the `matchMedia` call in `App.svelte` carry
matching comments; there is no third breakpoint.

- `>1100px`: side rail, explorer | vertical grip | preview.
- `761–1100px`: side rail, explorer / horizontal grip / preview.
- `≤760px`: bottom bar, one visible Rules pane.

**Bottom bar.** Below 760px the rail becomes a five-tab bar under the content:
`flex-direction: row`, `env(safe-area-inset-bottom)` padding, a brand-soft fill
and a top-edge marker for the active tab. `--rr-bottom-tap` (44px, 48px on
coarse pointers) is the tab floor. Tab labels hide below 380px; the accessible
name stays on the button.

**Header utilities.** The theme, locale, skipped-step and autosave controls move
into the header action group on phones. They are rendered by one `{#snippet}` in
exactly one place at a time — duplicating the markup would duplicate
`id="rr-locale-menu"` and break the popover refs. The locale menu re-anchors
downward from the header trigger. Header density steps down (title ≤560px,
status label ≤400px, app icon ≤340px) so seven 28px buttons plus the brand fit
320px.

**Pane switch instead of a split.** At ≤760px the Rules tab renders a segmented
"Rules | Preview" control in a static bottom grid row, directly above the phone
bottom bar. Both panes stay mounted in the same `pane` cell; the inactive pane is
`visibility: hidden; pointer-events: none`. Nothing unmounts, so scroll position,
open group, selected rule and inline-editor text survive the switch. A
chain-step tap in Preview selects the rule silently and defers the reveal: only
an explicit "Rules" tap flips the pane and scrolls the selected summary into view
once. Add-rule and assistant-reveal keep the immediate flip + focus. The desktop
"no focus steal" behaviour is untouched.

**Horizontal grip.** The stacked split gets a real grip rail between the panes.
`--rr-explorer-h` (48vh default) is session-local like `--rr-explorer-w`;
the grid track clamps it as
`minmax(200px, min(var(--rr-explorer-h), 100% - 200px - var(--rr-grip-w)))`
so a shrunken window cannot push the preview out of the container. Both grips
are focusable `role="separator"` elements with arrow-key nudging, double-click
reset and a measured `aria-valuenow`.

**Zone separation.** The stacked preview cell gets the panel surface plus a
strong top border. The ghost filter mirror is hidden at ≤1100px (not just on
phones), because stacked it reads as a duplicate search field.

**Viewport.** `viewport-fit=cover` joins the dashboard viewport meta. Without it
iOS reports every `env(safe-area-inset-*)` as 0, which would break the bottom
bar padding and the toast offset.

## Alternatives considered

- **Two-row bottom bar** (tabs plus utilities): doubles the chrome height on the
  smallest screens and still competes with the on-screen keyboard.
- **Floating action pill / hamburger** for navigation: hides five primary
  destinations behind an extra tap and has no persistent selected state.
- **Keeping the split on phones** with two ~250px panes: unusable once the
  keyboard opens; the editor is the primary phone task.
- **Unmounting the inactive pane** (`{#if}` / `display: none`): loses scroll and
  editor state on every switch and re-runs preview derivations on return.
- **A resize listener for `--rr-explorer-h`**: the CSS clamp already handles
  window shrink without JS.
- **Persisting grip sizes**: no settings-schema or migration work is justified
  for a session-local layout preference.

## Consequences

- Two new layout surfaces (bottom bar, pane switch) and one new grip axis to
  keep responsive; the breakpoint contract is duplicated in CSS and `App.svelte`
  and must be changed together.
- The pane switch is a visibility flip, not a mount swap: hidden panes keep
  computing (already true for the keep-alive tab panels, so no new cost class).
- On phones the paused-autosave reason is no longer visible in the header at
  ≤400px; `rules.blockingHint` in the Rules tab and the status title carry it.
- Safe-area behaviour is a CSS contract only: Playwright runs Firefox without
  real insets, so the unit tripwires pin the tokens and `env()` usage while the
  physical notch stays part of manual QA.
