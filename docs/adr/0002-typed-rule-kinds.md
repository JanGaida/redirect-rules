# ADR 0002: Typed rule kinds — `replace` and `appendQuery` — over magic substitution tokens

- Status: accepted (2026-10-25)
- Deciders: project owner
- Applies to: `src/lib/core/redirect-engine.ts`, `src/lib/core/append-query.ts`, `src/lib/core/settings.ts`, `src/lib/gui/tabs/RulesTab.svelte`

## Context

The legacy script encoded query-parameter merging in substitution strings: `'$&&base=1'`
(ab)uses JS replace's `$&` (whole match) to append text. The semantics were broken in
three observable ways: without an existing query it produced `page&base=1` (no `?`), with
a fragment it appended AFTER the `#`, and the only "documentation" was a tooltip
("'?' starts query rules") plus two commented-out `_sanitizeQueryParams` implementations.
The legacy unit-test expectations encoded the INTENDED behavior, not the actual one.

## Decision

1. Rules are a discriminated union: `{ kind: "replace", regex, substitution }` and
   `{ kind: "appendQuery", regex?, params }` (see `src/lib/core/settings.ts`).
2. `replace` rules are documented as STANDARD `String.replace` semantics — `$&`, `$1`, …,
   no extensions, no magic.
3. `appendQuery` is implemented as dedicated string surgery in `append-query.ts`:
   split at the first `?` and `#`, split params at `&` and the first `=`, append with
   `?`/`&` as appropriate, OVERWRITE an existing key's value in place, never re-encode,
   never touch the fragment.
4. No `new URL()` anywhere on the engine path — the legacy no-change corpus contains
   strings (`ttp://…`, `ftp://…`, `user:pass@…`) that would throw in the URL constructor.

**Rule of thumb:** a user-visible concept gets a named type, not a punctuation trick.

## Amendment (retroactive record 2026-11-02): third kind `checkpoint`

The discriminated union gained a third flow-control kind:
`{ kind: "checkpoint"; regex: string; mode: "continue" | "stop" }`. It tests the current URL
and aborts the rest of the group according to its mode without changing the URL. The full
rationale, abort scope, preview reasons, and stats behavior are recorded in
[ADR 0019](0019-checkpoint-rule-kind.md); the original two-kind decision above stays
historical.

## Amendment (2026-11-09): fourth kind `removeQuery`

The discriminated union gained a key-based query-removal kind:
`{ kind: "removeQuery"; regex?: string; keys: string }`. `keys` is an `&`-separated list;
a trailing `*` is a prefix wildcard; ALL matching pairs are removed while the fragment and
raw encodings are preserved. The optional `regex` gate is tested against the decoded query
surface, exactly like `appendQuery`. Full rationale and consequences are recorded in
[ADR 0044](0044-remove-query-rule-kind.md).

## Consequences

**Positive:**

- The old test expectations for rule 12 (merge cases) become reality, pinned by specs.
- The rule editor GUI can render kind-specific fields instead of a free-text magic box.
- Fragment preservation and `+`-encoding have one tested implementation.

**Negative:**

- Breaking change for legacy rule JSON — acceptable because the storage restart is
  blank (see [ADR 0003](0003-blank-storage-restart.md)).
- One more branch in compile/apply — bounded by the discriminated union.

## References

- Query merge: `src/lib/core/append-query.ts`
- Rule types: `src/lib/core/settings.ts`
- Specs: `src/lib/core/__tests__/append-query.test.ts`
- Related docs: `docs/architecture/query-append.md`
