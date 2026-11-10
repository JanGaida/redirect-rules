# ADR 0038: Per-group enable/disable (group level only)

- Status: accepted
- Date: 2026-11-04
- Deciders: project owner
- Applies to: `src/lib/core/settings.ts`, `src/lib/core/redirect-engine.ts`,
  `src/lib/core/preview.ts`, `src/lib/core/settings-diff.ts`,
  `src/lib/core/settings-transfer.ts`, `src/lib/gui/validation.ts`,
  `src/lib/gui/autosave.svelte.ts`, `src/lib/gui/tabs/RulesTab.svelte`,
  `src/lib/gui/components/RuleEditor.svelte`, `src/lib/gui/components/RowActions.svelte`
- Builds on: [ADR 0002](0002-typed-rule-kinds.md), [ADR 0017](0017-shared-compiled-step-executor.md),
  [ADR 0037](0037-settings-export-import-dialog.md)

## Context

Site groups could only be removed or edited; there was no way to keep a group
configured but inactive. The first-boot example groups therefore had to run
ACTIVE, which makes a fresh install rewrite URLs before the user opts in. A
broken group also had no emergency off switch: an invalid regex blocks autosave,
so the user could not persist a disable until the rule was repaired.

The request is explicitly group-scoped: lower levels (rules, test cases, chain
steps) must not gain their own switch.

## Decision

1. **Sparse group flag.** `SiteRule.disabled?: boolean`; `true` means the engine
   skips the group, absent means active. `false` is never stored. `isSiteEnabled`
   is the single semantic helper.
2. **Opt-in examples, no migration.** The shipped `EXAMPLE_RULES` groups start with
   `disabled: true`. Existing stored groups without the flag stay active; there is
   no heuristic migration that could disable user-owned groups.
3. **Engine skip at compile.** `compileRules` skips disabled groups by default.
   `applyRules` and `previewChain` therefore never see them. `includeDisabled`
   exists only for the group-scoped preview.
4. **Preview stays an authoring surface.** `previewGroup` still simulates a
   disabled group's chain so the user can test before enabling it; the GUI shows
   an explicit "disabled" banner so the result is not mistaken for live behavior.
5. **Off groups are inert for persistence.** Invalid/empty content in a disabled
   group does not block autosave, and prune-on-save neither drops the group nor
   its empty rules. This makes "disable" usable as an emergency switch and keeps
   parked drafts. The red invalid-regex marker remains visible while authoring;
   the amber incomplete frame is suppressed for off groups.
6. **GUI.** The site row's `RowActions` strip gains an optional toggle button
   (`toggle_on`/`toggle_off`, `aria-pressed`). It follows the existing
   hover/focus reveal contract (ADR 0031) and is visible without hover on touch
   devices. The off state is additionally carried by a muted row. No rule,
   test-case or chain-step row receives a toggle.
7. **Backups carry the state.** The export/import meta unit
   (`description`, tests, state) carries `disabled` as an explicit boolean, so a
   backup restores both states. Without meta selection, merge keeps the current
   state; replace restores it from file.
8. **Change counting.** A pure enable/disable change counts as one changed group
   row in the pending status label.

## Consequences

**Positive:**

- A broken or experimental group can be parked without deleting it.
- First boot is opt-in; the shipped examples remain verifiable without being
  active.
- The engine, preview and backup paths share one explicit state instead of
  implicit "remove the group" workflows.

**Negative:**

- Existing profiles do not automatically receive the opt-in default.
- A disabled broken group can be saved; enabling it later re-arms the normal
  save gate and surfaces the red marker.
- Empty disabled groups persist as parked drafts, so the settings file can carry
  groups that the engine would never compile.
- The toggle is hover-revealed on desktop by decision; at-rest state relies on
  the muted row.

## References

- Types, defaults, normalization: `src/lib/core/settings.ts`
- Compilation and application: `src/lib/core/redirect-engine.ts`
- Group preview: `src/lib/core/preview.ts`
- Save gate and pruning: `src/lib/gui/validation.ts`, `src/lib/gui/autosave.svelte.ts`
- Explorer toggle and row state: `src/lib/gui/tabs/RulesTab.svelte`,
  `src/lib/gui/components/RowActions.svelte`
- Preview banner: `src/lib/gui/components/RuleEditor.svelte`
- Backup contract: `src/lib/core/settings-transfer.ts`
- Tests: `src/lib/core/__tests__/redirect-engine.test.ts`,
  `src/lib/core/__tests__/preview.test.ts`,
  `src/lib/core/__tests__/settings.test.ts`,
  `src/lib/core/__tests__/example-rules.test.ts`,
  `src/lib/gui/__tests__/validation.test.ts`,
  `src/lib/gui/__tests__/autosave.test.ts`,
  `src/lib/core/__tests__/settings-transfer.test.ts`,
  `e2e/tests/group-enable.spec.ts`
