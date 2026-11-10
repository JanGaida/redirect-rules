# ADR 0044: `removeQuery` rule kind for key-based query removal

- Status: accepted (2026-11-09)
- Deciders: project owner
- Applies to: `src/lib/core/settings.ts`, `src/lib/core/append-query.ts`,
  `src/lib/core/redirect-engine.ts`, `src/lib/core/preview.ts`,
  `src/lib/core/settings-transfer.ts`, `src/lib/core/stats.ts`,
  `src/lib/gui/components/RuleEditor.svelte`, `src/lib/gui/stats-view.ts`

## Context

`appendQuery` can add and overwrite query parameters, but there is no supported way to
delete them. The common real-world case — stripping campaign and click identifiers such
as `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid` — had to be expressed as a chain of
`replace` rules that manually repaired separators:

- Removing a first parameter leaves `?`/`&` dangling unless a later rule fixes it.
- A generic replace chain is easy to get wrong and can damage the fragment or the path.
- `appendQuery` deliberately cannot express removal, so the workaround grows with every
  new tracking key.

A first-class removal kind makes the intent explicit, keeps the existing raw-encoding
and fragment contracts, and gives the GUI, preview, transfer, and stats layers a real
shape to render.

## Decision

Extend the discriminated union (ADR 0002) with a fourth kind:

```ts
type RemoveQueryRule = {
    kind: "removeQuery";
    regex?: string; // optional gate, normalized to ""
    keys: string; // "utm_*&fbclid" — &-separated key patterns
};
```

Semantics:

1. `keys` is `&`-separated. An exact segment matches one key; a trailing `*` is a
   prefix wildcard (`utm_*`); `*` alone matches every key and clears the query.
2. Key matching uses `paramKeySurface` — the same decode-normalized surface as
   `appendQuery`. Edits stay raw; the fragment is never touched.
3. ALL matching pairs are removed, duplicates included. Unmatched pairs are rebuilt
   verbatim (no re-encoding, no `new URL()`).
4. When the query becomes empty the `?` is dropped. When nothing matched, the URL is
   returned unchanged.
5. The optional `regex` gate is tested against `querySurface(current)` exactly like
   `appendQuery`; an empty gate means "no gate". An empty `keys` string is incomplete
   and blocks persistence/import.
6. Normalization emits `regex: ""` for the uniform field shape; stats identity hashes
   `(regex, keys)`; preview builds one chain step like any other applied rule.

No storage migration is required (ADR 0003): the kind is additive, and older userscript
versions drop unknown kinds during normalization.

## Consequences

**Positive:**

- Tracking cleanup becomes one declarative rule with no separator surgery.
- GUI, transfer, preview, and stats reuse the existing kind machinery.
- The raw-encoding and fragment contracts stay in one module (`append-query.ts`).

**Negative:**

- One more compile/apply/preview branch, and every `if` chain with a silent
  checkpoint fallback must branch explicitly (pinned by tests).
- Older versions silently drop `removeQuery` rules on load.
- A trailing-`*` wildcard is intentionally shallow: no middle/infix globs.

## References

- Query surgery: `src/lib/core/append-query.ts`
- Engine: `src/lib/core/redirect-engine.ts`
- Types: `src/lib/core/settings.ts`
- Specs: `src/lib/core/__tests__/append-query.test.ts`,
  `src/lib/core/__tests__/redirect-engine.test.ts`,
  `src/lib/core/__tests__/preview.test.ts`
- Related: `docs/adr/0002-typed-rule-kinds.md`,
  `docs/architecture/query-append.md`
