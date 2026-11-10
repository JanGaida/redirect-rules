# ADR 0021: Rule actions reveal on hover/selection; site actions stay visible

- Status: accepted (amended 2026-11-02 by ADR 0029 — keyboard reordering via the row grip)
- Date: 2026-11-02
- Deciders: human + agent session
- Applies to: `src/lib/gui/components/RowActions.svelte`,
  `src/lib/gui/tabs/RulesTab.svelte`, `src/lib/gui/dashboard.css`
- Supersedes in part: [ADR 0018](../0018-ui-ux-remediation.md) (keyboard reordering
  consequence)

## Context

The explorer rows carried a four-button `RowActions` strip: move up, move down,
clone, delete. Move up/down duplicated the pointer drag-and-drop reordering that
already exists for site groups and rule rows, and kept four glyphs visible in every
row at all times. The user asked for quieter rows: only delete/clone remain, and
those should appear when the row is hovered or selected instead of sitting in the
layout permanently.

The site summary is the parent row for a whole group. Its delete/clone actions are
the only direct group-level actions and must remain permanently visible, so users can
clone or delete a group without hovering it or opening it first. The reveal behavior
therefore applies to rule rows only.

ADR 0018 promised that the dashboard is fully operable without a mouse, including
reordering. The move buttons were the only keyboard path for reordering; drag and
drop is pointer-only.

## Decision

1. `RowActions` is a delete/clone strip. The move-up and move-down buttons, their
   props, icons, SVG assets, and i18n keys are removed.
2. Site-summary strips stay permanently visible at full opacity.
3. On hover-capable devices, rule-row strips are hidden at rest (`opacity: 0`,
   `pointer-events: none`) and fade in when the row is hovered, contains keyboard
   focus, or is the selected rule. Reserved space prevents layout jumps.
4. Devices without hover (`@media (hover: none)`) keep rule-row strips permanently
   visible, so touch users can still reach delete/clone.
5. Reordering is pointer drag-and-drop only. No keyboard shortcut is added in this
   change.

## Consequences

- Rule rows are visually quieter and the action strip no longer competes with the
  rule label. Site rows keep their always-visible group actions.
- Keyboard users can still select rows, reach delete/clone via focus, filter, and
  resize panes, but cannot reorder rows without a pointer. This intentionally
  narrows the ADR 0018 consequence.
- Hidden rule actions remain in the tab order; `:focus-within` reveals them when
  they receive focus.
- The store methods `moveSiteRule()` and `moveRule()` remain public, tested API even
  though the UI no longer calls them.
