# ADR 0035: Rule configuration assistant as a rail tab

- Status: accepted (2026-11-03; amended 2026-11-09 — verification test cases;
  2026-11-10 — prompt structure and shared contract partial)
- Date: 2026-11-03
- Applies to: `src/lib/gui/App.svelte`, `src/lib/gui/dashboard-protocol.ts`,
  `src/lib/gui/tabs/AssistantTab.svelte`, `src/lib/gui/tabs/RulesTab.svelte`,
  `src/lib/gui/ui-state.svelte.ts`, `src/lib/core/chat-template.ts`,
  `src/lib/gui/components/TokenReference.svelte`,
  `src/lib/gui/components/RegexManualReference.svelte`,
  `src/lib/gui/dashboard.css`; see [gui.md](../architecture/gui.md),
  [dashboard-protocol.md](../architecture/dashboard-protocol.md)
- Amends: [ADR 0031](0031-dashboard-interaction-model.md) decision 10 (rail tabs)

## Context

The LLM hand-off lived as a fixed FAB plus popover mounted at the Rules tab root. It
rendered the prompt from RulesTab's transient selection and imported a parsed proposal
back into that selection. The feature was undiscoverable outside the Rules tab, could
not be opened directly (hash deep link, bookmark, or a dashboard opened on another tab),
silently depended on a selection the user could not see, and duplicated a complete
workflow inside a dialog competing for `uiState.popover` and ESC.

## Decision

1. **One rail tab.** The assistant is a first-class tab immediately after Rules; the
   FAB, the popover and the `"chat"` popover kind are removed.
2. **Hash segment.** `assistant` joins `DASHBOARD_TABS`; `#rr-dashboard/assistant`
   restores the tab like every other rail tab.
3. **Two-column workbench.** Prompt card left, import card right, inside a 960 px
   centered root that stacks below 1080 px. There is still no stepper, no step state,
   and no page-url control.
4. **Optional target group.** A styled select is always visible; copying works without
   a selection. The default target is `settings.lastSelection`'s group, else the only
   group, else none — the tab never writes `lastSelection`. A selected group is dumped
   as its full JSON settings into the template; the LLM is told to reuse its `siteRegex`
   and return only rules to add. Without a group the template tells the LLM to ask for
   the target site (max. two questions). The starting-rule select is removed.
5. **One JSON contract.** Template and repair template both request strict JSON
   (`siteRegex` + `rules[]`; the parser still tolerates a bare single-rule object). The
   parser strips Markdown
   fences and prose and delegates validation to `settings-transfer.ts`. The old text
   format is gone. The template additionally requests exactly one group-level
   `previewEntries` test entry per used rule kind (`url` → `testOutputUri` after the
   WHOLE group chain). If no exact example URL exists, the LLM must use an empty URL and
   a fixed no-example sentence instead of inventing one. Group meta survives the
   proposal normalizer and is rejected when malformed. Both templates include the same
   per-locale contract partial (rule model, test cases, self-check) via
   `{{include:chat-contract.<locale>}}`, expanded by `scripts/build-defines.ts`.
6. **Auto-target import.** The answer may be a single rule, a group, or a group list.
   The target is resolved by semantic gate equality (compiled source + effective flags),
   otherwise a new group is created. Rules are matched by content signature; existing
   rules are skipped. Verification entries are deduped by url + expected output + caption
   and appended with the imported rules; a new group is seeded with them. Commit is
   append-only through `store.appendImportedRules` /
   `store.createSiteRuleWithRules` — never `applyMerge`, whose `ruleIndex` identity would
   overwrite existing rows.
7. **Hand-off and history.** Copy-only: no provider buttons, no URL prefill, no API
   integration. The clipboard ladder `GM_setClipboard` → `navigator.clipboard` →
   `execCommand` stays unchanged. A successful import keeps the prompt context and lists
   the new rules in a session-local history; the list resolves rule objects to current
   indexes on click, and "Open in Rules" switches tabs and reveals the rule through a
   consume-once request prop on `RulesTab`.
8. **Renderer contract.** `renderChatTemplate(site: SiteRule | undefined, locale: Locale)`
   renders the prompt from the live target and locale. The prompt card shows a derived
   summary (gate / rule count / format) and a collapsed preview that renders exactly the
   copied string.
9. **Provider links.** The compact hero renders the headline and lead plus a right-hand
   panel of static provider links (ChatGPT, Claude, Copilot, Gemini, Mistral, Kimi,
   DeepSeek, Qwen, Perplexity). Each link opens a new tab; the glyphs are monochrome
   Simple Icons marks with their own checked-in asset family and README. They are link
   affordances, not API integrations.
10. **Reference popovers.** `TokenReference` is an info trigger in the substitution/params
    field trailing affix; `RegexManualReference` is an info trigger in the regex/site-gate
    field for EVERY rule kind. Both open top-layer `InfoPopover`s (native
    `popover="auto"`), sized/positioned to survive panel clipping, with single-popover
    semantics through `uiState.popover` (`"tokens" | "manual" | "locale" |
siteManual:<index>`). The token reference no longer links anywhere, so each reference
    has exactly one trigger.

Reversible presentation details (select styling, copy button placement, prompt-preview
layout) stay as code/doc prose.

## Consequences

- Rail navigation has five tabs; the E2E rail contract and the tab count change.
- The assistant is reachable from a bookmark and works without a prior Rules selection.
  No settings field, storage key, or migration is added.
- The Rules tab no longer imports from the assistant automatically; the explicit "Open in
  Rules" link owns the reveal, so multi-import sessions do not lose context.
- The provider glyphs add a checked-in asset family but no runtime dependency; opening a
  provider link is the only external action.
- Import resolution is semantic, not index-based: reorder/delete cannot point at the wrong
  row, and a matching gate in another group is reused instead of duplicated.
- Proposals carry persisted preview/test cases; imports stay append-only and never
  overwrite existing entries. A kind without an exact example URL is stored as an
  empty-URL entry carrying the fixed no-example sentence.
- Invalid JSON yields a visible error and no partial import; the parser never applies a
  merge.

## Alternatives considered

- **Keep the FAB and add a tab.** Two surfaces for one workflow; the popover keeps
  the hidden selection coupling and the ESC conflict.
- **Bind the tab to the Rules selection.** Undiscoverable target, breaks on
  bookmarks, and import has no stable destination.
- **Switch to the Rules tab automatically after import.** Loses the assistant
  context for repeated imports and surprises the user mid-session.
- **Require a starting rule.** Rejects the primary use case: designing a new rule
  from a page URL and wishes.
- **Keep the old text format.** Free-form prose needs a fuzzy parser and cannot carry a
  stable validation contract; strict JSON plus `settings-transfer.ts` reuses one schema.
- **Merge into the selected group by index (`applyMerge`).** Rejected: index identity
  overwrites existing rows after reorder/delete.

## References

- Navigation: `src/lib/gui/App.svelte`, `src/lib/gui/dashboard-protocol.ts`
- Assistant: `src/lib/gui/tabs/AssistantTab.svelte`
- Reveal hand-off: `src/lib/gui/tabs/RulesTab.svelte`
- Renderer: `src/lib/core/chat-template.ts`, `src/lib/data/chat-template.*.txt`,
  `src/lib/data/chat-error-template.*.txt`, `src/lib/data/chat-contract.*.txt`,
  `scripts/build-defines.ts` (include expansion)
- Transfer schema: `src/lib/core/settings-transfer.ts`
- References: `src/lib/gui/components/TokenReference.svelte`,
  `src/lib/gui/components/RegexManualReference.svelte`
- Tests: `src/lib/core/__tests__/chat-template.test.ts`,
  `src/lib/gui/__tests__/dashboard-protocol.test.ts`,
  `e2e/tests/dashboard-smoke.spec.ts`
