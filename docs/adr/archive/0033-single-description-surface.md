# ADR 0033: One description surface with a caption pencil

- Status: superseded by ADR 0031
- Date: 2026-11-02
- Applies to: `src/lib/gui/components/InlineCaption.svelte`,
  `src/lib/gui/tabs/RulesTab.svelte`,
  `src/lib/gui/components/RuleEditor.svelte`, `src/lib/gui/icon.ts`,
  `src/lib/gui/dashboard.css`; see [gui.md](../../architecture/gui.md)
- Supersedes in part: [ADR 0032](../0032-touch-input-support.md) decision 5 (site
  body description field), archived
  [ADR 0030](0030-preview-summary-restyle.md) decision 8 (preview body
  description field)
- Related: [ADR 0021](0021-row-actions-hover-and-reorder.md) (row action
  reveal), [ADR 0031](../0031-dashboard-interaction-model.md) (inline captions)

## Context

Site groups and preview test cases each had two editors for the same
`description` value: the summary `InlineCaption` overlay (double-click / F2) and a
duplicate field in the opened body. The body fields wrote the same model field,
so the two surfaces could disagree only in formatting, not content, and the
duplicate form made the body longer than its remaining URL fields justify.

The body fields were not accidental: ADR 0032 added the site field as the
one-finger route because `dblclick`/F2 are mouse/keyboard affordances. The
preview field served the same role. Removing the duplicates without a replacement
would make descriptions uneditable on touch devices.

Synthetic `dblclick` on touch is not a reliable basis: browser touch-to-dblclick
synthesis differs across platforms, and ADR 0032 explicitly rejected double-tap
as an edit gesture.

## Decision

1. **One editing surface.** `InlineCaption` is the only description editor for
   site groups and preview test cases. The duplicate body fields are removed.
2. **Descriptions are single-line.** `InlineCaption` keeps its absolute
   single-line overlay and trimmed commit; no multiline body editor remains.
3. **A caption pencil is the touch route.** The caption renders an icon-only
   pencil at its trailing edge. One tap opens the same overlay. The glyph is
   hidden at rest and reaches full opacity on row hover, keyboard focus, open
   state, or `hover: none` (ADR 0036).
4. **Geometry is unchanged.** The pencil is absolutely positioned; the caption
   host reserves its width via padding. The caption box, the overlay's
   outward-expanded geometry, and the zero-jump contract stay intact.
5. **One accessible name.** `a11y.edit` ("Edit description" / "Beschreibung
   bearbeiten") names the pencil; the icon remains decorative.

## Consequences

- The site and preview rows behave identically and expose one obvious description
  field instead of a second editor inside the body.
- Touch users keep a deterministic one-tap path without a gesture recognizer.
- Descriptions that already contain newlines remain readable (HTML collapses
  whitespace in the caption) but can no longer be authored as multiline.
- The preview body shrinks to `Input URL` and `Output URL`; the site body starts
  with the gate field. No store, normalize, autosave, or preview-engine change.
- The pencil is one more tab stop per row on keyboard; the overlay remains the
  focused target after activation.

## Alternatives considered

- **Rely on synthetic `dblclick` for touch.** Rejected: platform-dependent and
  explicitly rejected in ADR 0032.
- **Custom double-tap counter.** Rejected: the first tap toggles the surrounding
  `<details>`, producing a visible open/close flicker before the editor opens.
- **Edit action in `RowActions`.** Rejected as too much chrome: the action strip
  already carries destructive/clone controls, and the user wanted a subtler
  affordance at the caption end.
- **Keep the body fields.** Rejected: duplicates the same value and contradicts
  the single-surface intent; ADR 0032's touch goal is met by the pencil instead.
- **Accept a touch regression.** Rejected: descriptions would become
  uneditable on tablets, reversing an accepted touch contract.

## References

- [gui.md](../../architecture/gui.md) — explorer/preview row behavior
- [ADR 0032](../0032-touch-input-support.md) — touch target and viewport contract
- [ADR 0031](../0031-dashboard-interaction-model.md) — current dashboard contract
