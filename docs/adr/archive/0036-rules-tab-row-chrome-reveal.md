# ADR 0036: Rules-tab row chrome reveals on hover or active state

- Status: superseded by ADR 0031
- Date: 2026-11-03
- Applies to: `src/lib/gui/dashboard.css`, `src/lib/gui/tabs/RulesTab.svelte`,
  `src/lib/gui/components/InlineCaption.svelte`,
  `src/lib/gui/components/RuleEditor.svelte`; see [gui.md](../../architecture/gui.md)
- Supersedes in part: [ADR 0031](../0031-dashboard-interaction-model.md) decision
  5 (site actions permanently visible),
  [ADR 0033](0033-single-description-surface.md) decision 3 (pencil subtle at
  rest)
- Related: [ADR 0021](0021-row-actions-hover-and-reorder.md) (original reveal
  behavior), [ADR 0032](../0032-touch-input-support.md) (touch contract)

## Context

ADR 0031 split the reveal behavior: site rows kept permanently visible actions
while rule and preview rows revealed on hover, focus or open state. ADR 0033
kept the caption pencil subtle at rest (0.45 opacity) so it stayed visible as the
one-tap touch route.

Removing the explorer rule count left the site row with two always-visible chrome
clusters — the clone/delete strip and the pencil — while every rule and preview
row below hides its chrome. The row read noisier than the rows it groups.

## Decision

1. **One reveal rule.** In the Rules tab every row-chrome control (the
   clone/delete strip and the caption pencil) is hidden at rest on hover-capable
   devices and appears on row hover, keyboard focus (`:focus-within`) or an
   open/active row.
2. **Open means active.** A site group is active while it is open
   (`details.rr-master-site[open]`); a rule row is active while it is selected,
   which is the same state as its open fold.
3. **Pure touch keeps the controls.** Under `hover: none` the strip and the
   pencil stay permanently visible, preserving the one-tap description route
   from ADR 0033 and the ADR 0032 touch targets.
4. **No geometry change.** Visibility uses `opacity` and `pointer-events` only:
   no layout shift, no hit-box change, and the pencil keeps its tab stop.

## Consequences

- Hybrid devices (`hover: hover`) need two taps for descriptions: the first tap
  opens the group, the second hits the revealed pencil. This is the trade-off
  ADR 0032 decision 8 already accepts for row actions.
- Collapsed site rows no longer advertise delete/clone or the pencil at rest;
  hovering the row reveals them.
- Keyboard users are unaffected: tabbing into the row triggers `:focus-within`,
  so the controls are visible before they are reached.
- Rule and preview rows keep their existing styles — the contract is now uniform
  instead of split.
- The explorer site summary loses its rule count as a separate, reversible
  presentation decision (no ADR).

## Alternatives considered

- **Keep the pencil subtle at rest (0.45).** Rejected: one control would stay
  permanently visible in a row that hides the others, defeating the uniform
  hover/active rule.
- **Hide only the action strip, keep the pencil.** Rejected for the same reason.
- **Drop the `hover: none` exception.** Rejected: it removes the one-tap touch
  route ADR 0033 exists to provide.
- **Introduce a site-selection state.** Rejected: `openSite` already models the
  active group; a second selection axis adds persistence, keyboard and test
  surface without a user-visible gain.

## References

- [gui.md](../../architecture/gui.md) — explorer and preview row behavior
- [ADR 0031](../0031-dashboard-interaction-model.md) — dashboard interaction model
- [ADR 0033](0033-single-description-surface.md) — caption pencil
