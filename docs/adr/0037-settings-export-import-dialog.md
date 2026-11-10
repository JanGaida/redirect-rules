# ADR 0037: Settings export/import as one dialog with raw export and strict merge

- Status: accepted
- Date: 2026-11-03
- Applies to: `src/lib/core/settings-transfer.ts`,
  `src/lib/gui/settings-transfer-view.ts`,
  `src/lib/gui/components/SettingsTransferDialog.svelte`, `src/lib/gui/download.ts`,
  `src/lib/gui/tabs/SystemTab.svelte`, `src/lib/gui/App.svelte`,
  `src/lib/gui/ui-state.svelte.ts`, `src/lib/gui/dashboard.css`;
  see [settings-storage.md](../architecture/settings-storage.md),
  [gui.md](../architecture/gui.md)
- Amends: [ADR 0031](0031-dashboard-interaction-model.md) decision 10 (Settings
  tab backup actions are now one dialog instead of an inline banner)

## Context

The Settings tab exported the live settings object as a JSON download and imported
files through a two-step banner. Both directions had problems:

- Export was a single all-or-nothing dump with no way to select settings, groups,
  rules, or test cases; incomplete live rows (empty rules, invalid regexes) were
  written without any marking or warning.
- Import ran `normalizeSettings` on the candidate, which silently fills defaults
  and drops malformed rules. A partial file therefore looked complete, and the
  user could not see what would change before confirming.
- Import only had "replace everything". There was no safe way to bring a single
  group, rule set, or group metadata from another profile into the current state.
- The banner re-used `system.import.*` strings and had no shared model for
  per-unit validity, matching, or selection.

The persisted schema (ADR 0003, ADR 0012, ADR 0013, ADR 0016, ADR 0019)
is already typed. The transfer feature must preserve that schema without becoming
a migration path for arbitrary JSON.

## Decision

1. **One dialog for both directions.** The Settings tab opens a native
   `<dialog>` (`SettingsTransferDialog.svelte`) for export and import. Export
   shows one current-value column with selection checkboxes; import defaults to
   merge and adds a replace mode. Apply is disabled when no unit is selected.
   The old `.rr-import-banner` and `system.import.*` keys are removed.
2. **Versioned export envelope.** A full export writes
   `format: "redirect-rules-export"`, `version: 1`, `exportedAt`, `appVersion`,
   `partial`, a `settings` object with the six non-rule fields, and
   `siteGroups[]` with `siteRegex`, optional `description`/`previewEntries`, and
   `rules[]` entries carrying the original `ruleIndex`. `lastSelection` is never
   exported. `partial` is computed from the selected unit coverage.
3. **Raw export, strict import.** Export writes the live values as-is, including
   incomplete or invalid units; the dialog marks them and warns that a later
   import can only merge. Import validates every unit itself; it never calls
   `normalizeSettings` for partial data and never fills defaults. Missing values
   always mean "keep the current value".
4. **Accepted file shapes.** The parser accepts the v1 envelope, the previous
   `{ settings: { ... } }` wrapper, and a raw settings object. Unknown `format` or
   `version` is rejected; broken JSON or unusable structure is rejected with a
   dialog error. Legacy files are full only when all six fields and `rules` are
   present; otherwise they are partial. A v1 file declaring `partial: false` is
   still treated as partial when fields, group metadata, or units are missing or
   invalid (defense in depth).
5. **Per-unit validity.** Fields use the existing guards; motion accepts canonical
   and known legacy values through `normalizeMotionStrict`. Rules must have the
   typed kind shape, a non-empty body, and valid regexes; `appendQuery.regex` and
   `checkpoint.mode` are strict in v1 and legacy-tolerant otherwise. Metadata
   requires description and preview entries together in v1; legacy files may
   carry one. Invalid units stay visible, are marked, and are not selectable.
6. **One matching source.** `matchGroups(current, imported)` matches by exact
   `siteRegex`, first unused current group, in file order. `diffTransfer` and
   `applyMerge` both call it, so the "new"/"replace" labelling and the actual
   mutation cannot diverge.
7. **Merge semantics.** Selected fields replace their value; selected group
   metadata replaces `description`/`previewEntries` exactly (including `""` and
   `[]`); selected rules replace by `ruleIndex` or append in ascending order.
   Unselected units, extra current rules/groups, incomplete rows, and
   `lastSelection` are preserved. The store is not pruned.
8. **Replace semantics.** Replace is available only for a complete file where
   every unit is valid. `applyReplace` builds the full `Settings` object and
   always sets `rules` explicitly (even `[]`) so `normalizeSettings` cannot fall
   back to the example rules. `lastSelection` is not restored.
9. **Modal ownership.** `uiState.modal` records the open dialog. The App keydown
   handler returns early while a modal is open, so ESC closes the native dialog
   instead of the dashboard; the dialog prevents the native cancel and hands
   close back to `SystemTab`, which clears the flag and restores focus to the
   trigger.
10. **Filter behavior.** "Only differences" hides identical imported units, but
    keeps invalid units, current-only "stays" rows, and any unit the user has
    touched or selected visible. Unchecking a unit never removes it from view.

## Consequences

- The transfer logic is framework-free and unit-testable; the dialog only maps
  selection state, labels, and focus.
- `SystemTab` applies through `store.replace` plus the existing autosave
  `flush()` gate. A merge that leaves the live state invalid pauses autosave
  instead of pruning rows.
- The import path can no longer silently "repair" a file; users see exactly what
  is valid, missing, or different before applying.
- Export of a broken live state is allowed on purpose; the receiving parser marks
  the file partial and disables replace.
- The Settings tab's hero actions now open a dialog; the E2E import banner test is
  replaced by dialog tests (merge, replace, invalid unit, touched row, ESC).
- i18n gained `transfer.*` keys in both locales; the old `system.import.*` keys
  are gone.

## Alternatives considered

- **Keep the inline banner and add a merge checkbox.** The banner has no room for
  per-unit validity, group metadata, test cases, or a diff preview.
- **Normalize the whole import.** `normalizeSettings` fills defaults and drops
  malformed units, which hides data loss and makes partial files look complete.
- **Merge by group index only.** Inserted/deleted groups would map to the wrong
  targets; exact gate matching with first-unused semantics is stable and
  reversible.
- **Hide identical rows unconditionally.** Users lose the row they just
  unchecked; touched/selected units and "stays" rows stay visible instead.
- **Use `structuredClone` on the store.** The store is a Svelte `$state` proxy;
  JSON cloning in the core is deterministic and proxy-safe.

## References

- Core: `src/lib/core/settings-transfer.ts`
- View mapping: `src/lib/gui/settings-transfer-view.ts`
- Dialog: `src/lib/gui/components/SettingsTransferDialog.svelte`
- Download: `src/lib/gui/download.ts`
- Trigger + apply: `src/lib/gui/tabs/SystemTab.svelte`
- ESC/focus: `src/lib/gui/App.svelte`, `src/lib/gui/ui-state.svelte.ts`
- Tests: `src/lib/core/__tests__/settings-transfer.test.ts`,
  `src/lib/gui/__tests__/settings-transfer-view.test.ts`,
  `e2e/tests/dashboard-smoke.spec.ts`
