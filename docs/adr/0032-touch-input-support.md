# ADR 0032: Touch input support

- Status: accepted (amended 2026-11-11 — viewport-fit=cover, phone bottom bar and pane-switch targets)
- Amended by: [ADR 0045](0045-mobile-layout-bottom-nav-and-pane-switch.md) (viewport-fit=cover, `--rr-bottom-tap`, horizontal grip rail)
- Date: 2026-11-02
- Applies to: the dashboard (`src/lib/gui/App.svelte`, `src/lib/gui/tabs/*.svelte`,
  `src/lib/gui/components/*.svelte`, `src/lib/gui/drag-controller.ts`,
  `src/lib/gui/dashboard.ts`, `src/lib/gui/dashboard-meta.ts`,
  `src/lib/gui/dashboard.css`); builds on
  [ADR 0031](0031-dashboard-interaction-model.md); see [gui.md](../architecture/gui.md)
- Superseded in part by: [ADR 0033](archive/0033-single-description-surface.md) (decision 5:
  the site body description field is removed; the caption pencil is the touch route)

## Context

The dashboard was built for a mouse and keyboard. An audit found seven concrete
touch gaps: the takeover boot wipes the host stub's viewport meta, so tablets fall
back to the ~980px layout viewport; the site description is only editable through
`dblclick`/F2; the grip and row-action buttons are smaller than the WCAG 2.5.8
minimum; the splitter hit rail is 14px wide; the chat popover has no height bound;
the root uses `height: 100%` instead of `100dvh`; and fields sit at `0.95em`,
below Safari's 16px focus-zoom threshold.

The scope decision is **tablet + touch notebook**, not phone-first. Phone layout,
virtual-keyboard handling and a mobile-first redesign stay out of scope.

## Decision

1. **Viewport meta belongs to the takeover document.** `ensureViewportMeta(doc)`
   in `dashboard-meta.ts` runs on every `startDashboardMode()` boot, after the DOM
   wipe and before styles/layout. It updates an existing
   `meta[name="viewport"]` or appends one, and always sets
   `width=device-width, initial-scale=1`. Zoom is never disabled. The helper is
   pure over the passed `Document` and unit-tested in jsdom.
2. **Pointer gestures keep one owner.** ADR 0031 still governs reordering: the
   grip starts the drag, `drag-controller.ts` owns capture, threshold, ghost,
   autoscroll and abort. Touch and pen are not a second gesture path. Grips keep
   `touch-action: none`; all other tappable chrome gets `touch-action:
manipulation` to remove the double-tap delay without disabling pinch zoom.
3. **Tap targets have a token floor.** `--rr-tap-min` is 24px by default and 32px
   under `@media (any-pointer: coarse)`; `.rr-drag-handle`, `.rr-actions .rr-btn`
   and `.rr-affix-btn` enforce it through `min-width`/`min-height`. Icon and glyph
   sizes do not change — only the hit box grows.
4. **The splitter rail is a token.** `--rr-grip-w` is 14px, raised to 28px on
   coarse pointers, and feeds both the grid track and the `--rr-explorer-w`
   default (`calc(50% - var(--rr-grip-w) / 2)`). The visible capsule keeps its
   3×40 / 4×48 / 5×56 states and stays centered in the wider rail. The ≤1100px
   stacked layout still drops the grip.
5. **The description has a body editor.** The group body starts with a labeled
   single-line `TextInput` writing `site.description` through the bind-free
   `onValueChange` path (`bind:value` rejects an `undefined` fallback value),
   using the existing `rules.siteDescription.*` keys. The `InlineCaption`
   dblclick/F2 overlay stays as the mouse/keyboard shortcut. The field is raw
   while typing; the caption trims for display and `normalizeSettings()`
   trims/omits empty descriptions on save, so `undefined` never leaks into
   persisted settings.
6. **Coarse-pointer fields share one metric token.** `--rr-field-fs` is `0.95em`
   and becomes `16px` under `any-pointer: coarse`; `.rr-input`, `.rr-select`,
   `.rr-textarea`, `.rr-mirror` and `.rr-input-affix-lead` all use it, so the
   regex highlight mirror cannot drift from the field. The site-gate and
   rule-editor fields add the scoped `--rr-editor-field-fs` (`var(--rr-fs-sm)` /
   `16px` coarse) on their field, mirror and leading affix, without touching the
   base token. `.rr-pop .rr-textarea`
   overrides the base size and repeats the 16px override inside the same coarse
   block. `.rr-summary-desc` keeps `font: inherit` because the caption geometry
   depends on it.
7. **Popovers and the shell are viewport-safe.** `.rr-pop` gains
   `max-height: min(80dvh, 720px)`, `overflow-y: auto` and
   `overscroll-behavior: contain`; the token popover keeps its stricter 72vh cap.
   `.rr-dashboard-host`/`.rr-dashboard` declare `height: 100%` first and
   `height: 100dvh` second.
8. **Hybrid hover stays as-is.** Hybrid notebooks match `hover: hover`; the first
   tap opens a rule row, and the open/focus state then reveals its actions. This
   is accepted behavior, not a hidden-control bug, and is documented in the CSS.
9. **Tests are a contract tripwire, not a layout test.** jsdom covers viewport
   meta idempotence and the pointer controller (touch/pen accept, mouse rules,
   threshold, commit, cancel, double start) with stubbed pointer capture and
   animation frames. A textual css test pins the tokens, shared field metric,
   popover bounds and `100dvh`. Real geometry remains a manual device check;
   there is no Playwright touch project.

## Consequences

- Tablets render at device width, keep pinch zoom, and get 32px targets plus a
  28px splitter rail without a second layout.
- Every touch-reachable editor uses the same 16px field metric, so the highlight
  mirror and leading affix stay aligned; editor density grows slightly on coarse
  pointers.
- `any-pointer: coarse` also matches hybrid notebooks while a mouse is attached,
  so targets stay large there. The trade-off is accepted for touch reliability.
- The description field writes `""` transiently while typing; persistence
  normalization keeps the stored shape canonical.
- Phones, virtual-keyboard/`visualViewport` handling, splitter persistence and a
  Playwright touch project remain explicitly out of scope.

## Alternatives considered

- **Phone-first responsive redesign.** Rejected: the user chose tablet + touch
  notebook; phone polish needs its own layout decisions.
- **`user-scalable=no` to avoid accidental zoom.** Rejected: it breaks WCAG 1.4.4
  and hurts low-vision users.
- **A separate touch stylesheet.** Rejected: duplicated tokens drift; the same
  vars with a coarse-pointer override keep one source of truth.
- **Long-press or double-tap as new edit gestures.** Rejected: OS/browser
  gestures conflict, and the body field needs no gesture discovery.
- **A Playwright touch device project now.** Deferred: pointer-capture and
  autoscroll geometry are stubbed in jsdom; device verification is manual until
  the CI matrix grows.

## References

- Interaction model: [ADR 0031](0031-dashboard-interaction-model.md)
- Dashboard boot: `src/lib/gui/dashboard.ts`, `src/lib/gui/dashboard-meta.ts`
- Gesture controller: `src/lib/gui/drag-controller.ts`, `src/lib/gui/components/DragHandle.svelte`
- Rules UI: `src/lib/gui/tabs/RulesTab.svelte`, `src/lib/gui/components/TextInput.svelte`
- Styles and tokens: `src/lib/gui/dashboard.css`
- Settings shape: `src/lib/core/settings.ts`
- Architecture: `docs/architecture/gui.md`
