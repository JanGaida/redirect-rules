# ADR 0029: Per-row drag handle replaces the global drag lock

- Status: accepted
- Date: 2026-11-02
- Applies to: `src/lib/gui/components/DragHandle.svelte`,
  `src/lib/gui/drag-controller.ts`, `src/lib/gui/tabs/RulesTab.svelte`,
  `src/lib/gui/components/RuleEditor.svelte`, `src/lib/gui/dashboard.css`,
  `src/lib/core/settings.ts`, `src/lib/gui/tabs/SystemTab.svelte` and
  `src/lib/gui/App.svelte`; supersedes
  [ADR 0025](0025-drag-lock-rail-pill.md); amends
  [ADR 0021](0021-row-actions-hover-and-reorder.md) decision 5 and
  [ADR 0023](0023-dashboard-rail-navigation.md) decision 2

## Context

Reordering was ambient: the site group `<details>`, every rule `<summary>`,
and every preview card were draggable as a whole. Site drags only started on
the container padding (`e.target !== e.currentTarget`), preview drags needed a
`mousedown` arming hack plus `draggable="false"` guards on text panels, and the
whole surface competed with text selection and disclosure clicks.

The global drag lock existed to make those ambient drags safe: a persisted
`defaultLocked` default plus a session toggle in the rail footer. It was a
workaround for an interaction that could not be aimed, not a user-facing
capability.

## Decision

1. **One explicit grip per row.** `DragHandle.svelte` renders a Material
   Symbols `drag_indicator` button as the first child of the site summary, the
   rule summary, and the preview summary. Rows themselves are no longer
   draggable. The grip is hidden when the list has fewer than two items, so
   there is no dead control.
2. **The grip is the only drag origin.** The grip starts the gesture; rows are
   not draggable and carry no drag listeners. The site container's
   `target === currentTarget` guard and the preview arming hack are removed,
   together with the panel-level `draggable="false"` guards.
3. **Keyboard reordering.** ArrowUp/ArrowDown on the focused grip move the row
   one _visible_ position using the same neighbor + `moveIndex` math as the
   drop path, so the explorer and preview filters keep one semantics.
   `aria-keyshortcuts` advertises the keys.
4. **The lock stack is removed.** `drag-lock.svelte.ts`, the rail-footer
   `.rr-lock-toggle`, the `a11y.lock`/`a11y.unlock` strings, the
   `dragPan`/`dragClick` glyphs, and `settings.defaultLocked` (interface,
   defaults, normalization incl. the legacy boolean mapping, SystemTab row) are
   deleted.
5. **Clicks never bubble.** The grip guards `click` and `mousedown` so it does
   not toggle the surrounding `<details>`.
6. **One pointer controller for mouse, touch and pen.** `drag-controller.ts`
   owns pointer capture, the 4px activation threshold, a floating row ghost,
   edge autoscroll, and Escape/pointercancel abort. It replaces HTML5 drag and
   drop: rows keep their DOM order during the gesture, the hovered slot is
   resolved from live row rects, and the commit reuses `moveIndex`.

## Consequences

- Accidental drags are structurally impossible: without a grip press there is
  no drag source. The lock has no purpose and no state remains.
- Stored settings that still contain `defaultLocked` are normalized by
  `normalizeSettings`, which only copies known fields — the old value is
  dropped silently on the next load/save. No migration step is required.
- The rail footer keeps its fixed 2x2 grid (theme + locale / autosave + empty
  cell), so the stopwatch position and rail height do not move.
- Reordering is no longer pointer-only: keyboard users get one extra tab stop
  per row (the grip). This narrows the ADR 0021 consequence.
- Dragging works with mouse, finger and stylus through the same controller;
  touch scrolling is unaffected because `touch-action: none` applies to the
  grip only.
- `RowActions` is unchanged: clone/delete remain separate from the structural
  move action.

## Alternatives considered

- **Keep the lock, add a grip anyway.** Rejected: two safety layers for the
  same failure mode; the lock would still hide reordering by default.
- **Put the grip inside `.rr-actions`.** Rejected: rule actions are
  hover-revealed (ADR 0021), so the drag affordance would be invisible at rest
  and sit next to delete.
- **Keep whole-row drag as a fallback.** Rejected: it reintroduces the
  text-selection and accidental-drag problems the grip solves.
- **Keep HTML5 DnD and add a touch fallback.** Rejected: two divergent gesture
  paths with different threshold, ghost and abort semantics; one pointer
  controller covers mouse, touch and pen.
