# ADR 0030: Preview test-case summary restyle

- Status: accepted
- Date: 2026-11-02
- Deciders: human + agent session
- Applies to: `src/lib/gui/components/RuleEditor.svelte`,
  `src/lib/gui/components/InlineCaption.svelte`,
  `src/lib/gui/tabs/RulesTab.svelte`, `src/lib/gui/preview-caption.ts`,
  `src/lib/gui/dashboard.css`, see [gui.md](../../architecture/gui.md)
- Supersedes in part: [ADR 0018](../0018-ui-ux-remediation.md) (test cases are
  plain list rows; editing happens only in the expanded body)

## Context

The 02.11. explorer restyle gave site groups a quiet, description-first
`<summary>`: a readable caption with an inline description overlay (double-click
/ F2), hover band, focus ring and row actions. Preview test cases — the
collapsible rows in the preview cell — kept the older summary markup: a chevron
plus status chip in one flex box, two always-visible text lines (URL and
expected output), an unstyled spacer and a permanently visible hand-rolled
clone/delete strip. The two surfaces therefore read like different products,
although they share `rr-master-site`, `rr-group-summary` and `rr-site-shell`
classes and the same row mechanics.

The preview entry already carries an optional `description`
(`PreviewEntry.description`), but it was only editable in the expanded body and
was not shown in the collapsed row at all — the row was labelled by its raw URL.
The preview filter also ignored the description, so a described test case could
become unfindable.

## Decision

1. **Description-first caption.** The summary caption is the trimmed
   `PreviewEntry.description`, falling back to the trimmed `url`, then `"—"`
   (`previewCaption`).
2. **Inline edit.** Double-click the caption, or press F2 on the focused
   summary, to open the same absolute overlay input as the site row. Enter
   commits, Escape cancels, blur commits; an unchanged (trimmed) value is not
   written.
3. **One shared component.** `InlineCaption.svelte` owns the caption, the
   overlay, the draft/focus/blur cycle and the `<summary>`-safe event guards.
   The site row and the preview row mount it; the existing class contract
   (`.rr-summary-caption`, `.rr-summary-host`, `.rr-summary-desc`) is preserved.
   The parent only owns WHICH row edits (`editingSite` / `editingPreview`), so
   only one caption edits at a time.
4. **Actions.** The preview row uses `RowActions` (delete then clone) with the
   ADR 0021 reveal behavior: hidden at rest on hover-capable devices, visible on
   row hover, keyboard focus or open state, and permanently visible on
   `hover: none` devices.
5. **One metaline.** A single faint line under the caption: the source URL only
   when a description is set, plus `→ expected` when `testOutputUri` is set
   (`previewMeta`). The line is omitted when nothing applies.
6. **Status chip stays.** The color-coded test chip (success / failed / no
   test) remains as trailing metadata directly before the actions.
7. **Scoped classes.** Rows keep `rr-master-site rr-section rr-ed-preview` and
   the summary keeps `rr-group-summary`; the new styles are scoped via
   `.rr-preview-zone` and `details.rr-ed-preview`. No fold or drag mechanics
   change.
8. **The body keeps its multiline description field.** The summary overlay is
   the single-line quick edit; the expanded `TextArea` remains the detail
   editor. Both write the same `PreviewEntry.description`.
9. **Filter parity.** The preview filter matches the description in addition to
   url, expected output and raw status, and reports a localized no-match hint
   when entries exist but the needle matches none.
10. **The add-preview action is always available.** A group without entries
    previously rendered the empty state and NO way to create the first entry;
    the add skeleton now renders below both branches.

## Consequences

- Both row kinds share one caption component and one overlay geometry: the
  outward-expanded 4px/6px box with compensating padding keeps the glyph origin
  and the summary height fixed, so the site row's zero-jump E2E contract still
  holds.
- The hover band, focus ring and hover-revealed actions apply to preview rows
  without duplicating the explorer selectors — they are re-scoped, never
  unscoped, because both surfaces share class names.
- `rr-ed-preview` names BOTH the outer preview `<section>` and every row
  `<details>`. Row-scoped CSS and tests must use `details.rr-ed-preview`;
  an unscoped `.rr-ed-preview` would also match the section.
- Unscoped locators such as `.rr-master-site` are ambiguous once preview rows
  exist; explorer tests use `.rr-master > details.rr-master-site`.
- One component now owns focus/blur semantics for both caption editors; the
  parent keyed index replaces the copied handler trio in `RulesTab`.
- Preview entry descriptions stay canonical strings: the summary commit stores
  the trimmed string even when empty (normalize always emits `""`), while the
  site commit keeps deleting an empty `description` property.
- No data-model, store-schema, autosave, preview-engine or drag/reorder change.
