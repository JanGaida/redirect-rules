# ADR 0039: Delete without confirmation — single-slot undo toast

- Status: accepted
- Date: 2026-11-04
- Deciders: project owner
- Applies to: `src/lib/gui/ui-state.svelte.ts`, `src/lib/gui/App.svelte`,
  `src/lib/gui/tabs/RulesTab.svelte`, `src/lib/gui/components/RuleEditor.svelte`,
  `src/lib/stores/settings.svelte.ts`, `src/lib/data/i18n.json`
- Supersedes: decision 4 of [ADR 0018](0018-ui-ux-remediation.md)
- Builds on: [ADR 0020](0020-multi-dashboard-autosave.md)

## Context

Row deletes (site group, rule, test case) asked through native `window.confirm`.
The dashboard runs in its own takeover tab (ADR 0011), so the prompt belongs to
the browser chrome, not the styled surface: it blocks the context, looks foreign,
and cannot be keyboard-labelled or themed. Autosave persists every accepted
change within the configured debounce (ADR 0020), and the global Undo is a
session snapshot — it reverts the whole session, not one row.

The request was explicit: no native delete popups. The safety net must stay, but
it should be recoverable after the fact instead of blocking before it.

## Decision

1. **Deletes apply immediately.** `RulesTab` (site group, rule) and `RuleEditor`
   (test case) drop the `confirm()` gate. No in-app modal replaces it.
2. **Single-slot undo toast.** The root toast renders an optional action button
   plus a countdown ring driven by the same timer. A delete opens an 8-second
   toast (`UNDO_TOAST_MS`) with the localized "Undo" label. Plain receipts keep
   the 3.2-second timing.
3. **Insert-at-index restore.** `settings.svelte.ts` gains `insertSiteRule`,
   `insertRule`, and `insertPreviewEntry`. They re-insert the removed plain
   settings object at the original index, clamped to the current list length,
   and return the actual index (or `-1` when the parent group is gone).
4. **No stack.** A new toast or a second delete replaces the pending one; the
   older undo target is forfeited. The toast pauses its timer while hovered or
   focused and restarts the full duration afterwards.
5. **Failure is visible.** When a rule/test-case undo cannot find its parent
   group, the toast is replaced by `common.delete.undoFailed` instead of failing
   silently.
6. **Scope stays narrow.** Close/undo confirms in `App.svelte`, the DEV menu
   "Reset settings" `confirm`/`alert` pair, and the dashboard popup-blocked
   alerts keep their native behavior — they are not row deletes.

## Consequences

**Positive:**

- Deleting a row never interrupts authoring with browser chrome.
- Every delete is recoverable for 8 seconds, including a site group with all of
  its rules.
- The restore path is one store mutation; autosave picks it up through the
  existing settings-change effect.

**Negative:**

- An accidental delete is only recoverable inside the undo window.
- Deleting twice quickly loses the undo for the first row (single slot, no
  stack).
- A remote settings reload during the window still re-inserts the captured
  plain object at the clamped index; there is no conflict detection beyond the
  missing-parent check.
- Keyboard users must Tab to the toast action before the 8 seconds expire; the
  focus-pause helps only after the button is reached.

## References

- Toast state and timing: `src/lib/gui/ui-state.svelte.ts`
- Toast render + root wiring: `src/lib/gui/App.svelte`, `src/lib/gui/dashboard.css`
- Delete call sites: `src/lib/gui/tabs/RulesTab.svelte`,
  `src/lib/gui/components/RuleEditor.svelte`
- Restore mutations: `src/lib/stores/settings.svelte.ts`
- Tests: `src/lib/core/__tests__/settings-store.test.ts`,
  `src/lib/gui/__tests__/ui-state.test.ts`
- Replaced decision: [ADR 0018](0018-ui-ux-remediation.md) decision 4
- Autosave contract: [ADR 0020](0020-multi-dashboard-autosave.md)
