# ADR 0046: `unwrap` rule kind for percent-decoded redirect wrappers

- Status: accepted (2026-11-13)
- Deciders: project owner
- Applies to: `src/lib/core/settings.ts`, `src/lib/core/unwrap-url.ts`,
  `src/lib/core/redirect-engine.ts`, `src/lib/core/preview.ts`,
  `src/lib/core/rule-policy.ts`, `src/lib/core/settings-transfer.ts`,
  `src/lib/core/stats.ts`, `src/lib/gui/components/RuleEditor.svelte`,
  `src/lib/gui/stats-view.ts`, `src/lib/data/chat-contract.*.txt`

## Context

Search engines and short-link hosts wrap outbound links in redirect URLs whose target is
only present percent-encoded:

- DuckDuckGo: `https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F&rut=…`
- Yahoo: `https://r.search.yahoo.com/…/RU=https%3a%2f%2fexample.com%2f/RK=2/…`
- Google Images: `https://www.google.com/imgres?imgurl=https%3A%2F%2F…`
- legacy Google News: `https://news.google.com/news/url?url=https%3A%2F%2F…`

The existing kinds cannot express this. `replace` operates on the raw string and its
substitution template cannot decode a capture group; `appendQuery`/`removeQuery` keep the
raw-encoding contract; site gates deliberately test the raw URL. A hand-written chain of
`%3A`→`:`/`%2F`→`/` replacements breaks on UTF-8 escapes, `%20`/`+`, and unknown bytes, and
is not idempotent.

Modern Google News wrappers (`news.google.com/rss/articles/CBMi…`) are a separate problem:
their payload is base64/protobuf and the 2024 format requires a network round-trip
(`batchexecute`), so they remain out of scope. Hacker News exposes no outbound tracking
redirect wrapper, so it has no `unwrap` target.

## Decision

Extend the discriminated union (ADR 0002) with a fifth kind:

```ts
type UnwrapRule = {
    kind: "unwrap";
    regex: string; // capture group 1 (or the whole match) = encoded target
};
```

Semantics:

1. The regex tests the RAW current URL (like `replace`/`checkpoint`), not
   `querySurface`.
2. The target is capture group 1 when the regex has at least one capture group,
   otherwise the whole match.
3. The target is decoded with exactly one `decodeURIComponent` pass; a malformed
   escape leaves the URL unchanged. `+` is not read as space and nothing is
   re-encoded.
4. Only absolute `http(s)://` targets are accepted. `javascript:`, `data:`,
   `file:` and every other scheme are rejected before `location.replace` runs
   (`sec` boundary).
5. A successful unwrap replaces the WHOLE URL with the decoded target; a fragment
   comes from the target, not from the wrapper. An invalid target or a regex
   without a match leaves the URL unchanged.
6. Normalization requires `regex`; an empty regex is dropped at compile and is
   incomplete in the GUI/transfer policy. Stats identity hashes `(regex)`.
   Preview renders one generic chain step; the editor exposes only the shared
   regex field.
7. The kind is additive; no storage migration (ADR 0003). Older userscript
   versions drop unknown kinds during normalization.

## Consequences

**Positive:**

- Three wrapper families become one declarative rule with no escape surgery.
- The security guard is one explicit, tested scheme check instead of implicit
  browser behavior.
- GUI, transfer, preview, policy, and stats reuse the existing kind machinery.

**Negative:**

- One more compile/apply/preview branch and a new pure module.
- A wrapper whose target uses a raw `&`/`/` instead of percent-escapes truncates
  the capture; wrappers are expected to encode the target.
- Double-encoded targets are not decoded twice and therefore stay unchanged.
- Google News and other network-resolved wrappers remain unsupported.

## References

- Target decode: `src/lib/core/unwrap-url.ts`
- Engine: `src/lib/core/redirect-engine.ts`
- Types: `src/lib/core/settings.ts`
- Policy: `src/lib/core/rule-policy.ts`
- Transfer: `src/lib/core/settings-transfer.ts`
- Specs: `src/lib/core/__tests__/unwrap-url.test.ts`,
  `src/lib/core/__tests__/redirect-engine.test.ts`,
  `src/lib/core/__tests__/preview.test.ts`,
  `src/lib/core/__tests__/example-rules.test.ts`
- Related: `docs/adr/0002-typed-rule-kinds.md`,
  `docs/adr/0044-remove-query-rule-kind.md`,
  `docs/architecture/redirect-engine.md`
