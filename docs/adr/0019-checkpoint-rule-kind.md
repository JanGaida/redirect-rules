# ADR 0019: Checkpoint rule kind for in-group flow control

- Status: accepted (retroactive record 2026-11-02; implementation referenced since the core split)
- Date: 2026-11-02 (retroactive record)
- Deciders: project owner
- Applies to: `src/lib/core/settings.ts`, `src/lib/core/redirect-engine.ts`,
  `src/lib/core/preview.ts`, `src/lib/core/stats.ts`, `src/lib/gui/components/RuleEditor.svelte`,
  `src/lib/gui/tabs/StatsTab.svelte`
- Builds on: [ADR 0002](0002-typed-rule-kinds.md), [ADR 0017](0017-shared-compiled-step-executor.md)

## Context

The typed rule model from ADR 0002 has two data-transforming kinds: `replace` and
`appendQuery`. Long rule chains sometimes need to **stop or continue** based on the current URL
without changing it. Encoding that through `replace` rules would require dummy rewrites and would
pollute the applied-rule log and stats.

## Decision

1. **Third rule kind.** Rules are a discriminated union extended with
   `{ kind: "checkpoint"; regex: string; mode: "continue" | "stop" }`. `regex` uses the normal
   authored-regex parsing (notation or literal), and gates are global-stripped for stateless
   `.test()` calls.
2. **Evaluation point.** A checkpoint tests the **current URL** at its position in the group chain
   (after the preceding rules), not the original group input.
3. **Mode semantics.**
    - `continue`: proceed only when the regex matches; otherwise abort the rest of the group.
    - `stop`: abort the rest of the group when the regex matches; otherwise proceed.
4. **Abort scope.** An aborting checkpoint stops only the current group. Later site groups still
   evaluate their gates in the same `applyRules` pass.
5. **No URL change.** A checkpoint never changes the URL. It is therefore not an `AppliedRule`,
   does not emit an info-level "rule applied" entry, and never increments a stats counter.
6. **Preview parity.** The shared executor from ADR 0017 emits
   `checkpoint-continue` / `checkpoint-stopped` reasons; preview shows them without re-deciding
   which step applies.
7. **UI.** The editor offers the third kind with a `continue`/`stop` selector; the stats table can
   render checkpoint rows, but their counter stays 0 by decision 5.

## Consequences

**Positive:**

- Chains express preconditions without dummy URL rewrites.
- Engine and preview share one abort decision through `executeCompiledGroup`.
- Checkpoints are inert in logs and stats, so counters keep their "redirect caused by this rule"
  meaning.

**Negative:**

- Three kinds instead of two; every exhaustive switch must handle the third case.
- A checkpoint has a stable stats hash but no counter — readers may initially expect a hit count.
- Aborting is group-local by design; cross-group flow control is not expressible.

## References

- Types + normalization: `src/lib/core/settings.ts`
- Compilation, executor, abort: `src/lib/core/redirect-engine.ts`
- Preview reasons: `src/lib/core/preview.ts`
- Stats identity: `src/lib/core/stats.ts`
- Editor: `src/lib/gui/components/RuleEditor.svelte`
- Tests: `src/lib/core/__tests__/redirect-engine.test.ts`,
  `src/lib/core/__tests__/preview.test.ts`
- Prior model: [ADR 0002](0002-typed-rule-kinds.md)
- Shared executor: [ADR 0017](0017-shared-compiled-step-executor.md)
