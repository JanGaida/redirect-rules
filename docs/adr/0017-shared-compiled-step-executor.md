# ADR 0017: Shared compiled-step executor for engine and preview

- Status: accepted (2026-11-02)
- Deciders: project owner
- Applies to: `src/lib/core/redirect-engine.ts`, `src/lib/core/preview.ts`,
  `src/lib/core/__tests__/redirect-engine.test.ts`, `src/lib/core/__tests__/preview.test.ts`

## Context

The engine (`applyRules`) and both preview paths (`previewChain`, `previewGroup`)
implement the same sequence independently:

1. Evaluate the site gate ONCE against the original url.
2. Apply rules sequentially, each to the previous result.
3. Handle checkpoints: test the current url; `continue`/`stop` aborts the rest of
   the group.
4. Handle `appendQuery` gates on the query-decoded surface.
5. Record only rules that actually changed the url.

The copies are currently held in parity by tests, not by construction. A change to
checkpoint, gate, or ordering semantics must be made three times — exactly the drift
class the O5 refactor candidate called out. Preview also re-derives authored rule indexes
with `indexOf`, which is fragile once rules are cloned or reordered.

## Decision

1. `redirect-engine.ts` exposes a pure executor:
   `executeCompiledGroup(group, inputUrl, gateUrl = inputUrl)`.
   It returns `{ gateMatched, steps, finalUrl, aborted }`.
2. The gate is evaluated against `gateUrl` (the engine's original url), while rules
   start at `inputUrl` (the current result of earlier groups). This preserves the
   legacy "gates evaluate once against the original url" contract.
3. `CompiledRule` carries the authored `ruleIndex`; preview no longer calls
   `indexOf` against source objects.
4. Each `RuleStepOutcome` carries `rule`, `ruleIndex`, `oldUrl`, `newUrl`, `changed`,
   and a `StepReason`:
   `applied`, `unchanged`, `no-match`, `gate-no-match`, `checkpoint-continue`,
   `checkpoint-stopped`.
5. `applyRules` and `previewChain` consume the executor. `previewGroup` consumes it
   for sequence/gate/checkpoint truth and only builds colored spans in `preview.ts`;
   span assembly stays a GUI concern.
6. Logging stays in the engine (the executor is pure and silent). Preview does not
   log per step.
7. The executor stops at the first aborting checkpoint; it does not emit outcomes
   for later rules. `previewGroup` fills those authored rows as
   `checkpoint-stopped`, matching today's rendering.

**Rule of thumb:** sequence semantics live in one function; presentation may repeat
what it needs for coloring, but must not re-decide which step applies.

## Consequences

**Positive:**

- Gate/checkpoint/ordering changes are made once; engine/preview parity is
  structural instead of test-only.
- `ruleIndex` is authoritative; cloned/reordered rules cannot mis-map preview steps.
- The executor is unit-testable as a pure function.

**Negative:**

- Preview replace still executes the regex a second time to collect match ranges for
  coloring; the transform itself comes from the shared outcome.
- `GroupExecution` allocates one outcome per compiled rule (small, per redirect).

## References

- Engine: `src/lib/core/redirect-engine.ts`
- Preview: `src/lib/core/preview.ts`
- Parity tests: `src/lib/core/__tests__/preview.test.ts`,
  `src/lib/core/__tests__/redirect-engine.test.ts`,
  `src/lib/core/__tests__/corpus.test.ts`
- Related: `docs/adr/0001-pure-engine-split.md`,
  `docs/adr/0019-checkpoint-rule-kind.md`
