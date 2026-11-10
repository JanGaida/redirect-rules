# ADR 0014: Build-time Base64 encoding for static text literals that must not surface as raw text

- Status: accepted (2026-10-31)
- Deciders: project owner
- Applies to: `vite.config.ts` (`__CHANGELOG_B64__` reference pattern), `src/vite-env.d.ts`,
  `src/lib/core/encoding.ts`, `src/lib/core/__tests__/encoding.test.ts`,
  `src/lib/gui/tabs/InfoTab.svelte`, `src/lib/gui/i18n.svelte.ts` (candidate),
  `src/lib/core/chat-template.ts` (candidate), `docs/architecture/*`,
  `npm run test`, `npm run docs:check`
- Builds on: [ADR 0008](0008-release-please-automation-contract.md)

## Context

`npm run build` produces a minified but still readable `.user.js`. Minification removes
whitespace and shortens identifiers, but leaves **string literals untouched**. As a
result, the output visibly contains:

- multi-line text with newline breaks (embedded Markdown, CSS templates, inline SVG
  paths built as template literals);
- single-line but text-dense blocks (translations, help text, error messages) that
  stand out in the compiled code and are trivially grep-able.

Until now `CHANGELOG.md` reached the GUI through a raw `?raw` import, which leaves the
full Markdown block readable in the bundle. Similar raw text blocks exist in the
translation dictionary and in the chat-template bodies. There is no repository-wide
contract stating which static texts may remain as raw literals and which must be encoded,
and there is no reusable decode location. As the code grows, new raw text blocks silently
appear.

## Decision

1. **General rule (normative):**
    - Any static text that is (a) longer than a short phrase, or (b) contains
      newlines or template-literal breaks, or (c) would read as a dense block in
      the compiled output, **must not** appear as a raw string literal in `src/`.
    - Short identifiers, CSS selector strings, log tags, and enum values stay raw:
      debuggability and grep-ability take precedence there.
2. **Unified mechanism:** build-time Base64 through Vite, decoded at runtime by
   `decodeText` from `src/lib/core/encoding.ts`. No new `@grant`, no CSP exposure,
   no runtime fetch. Base64 is **not** confidentiality (see Non-goals) — the only
   goal is that the output contains no raw, easily scannable text block.
3. **Extraction of the decode logic** into `src/lib/core/encoding.ts`:
    ```ts
    export function decodeText(encoded: string): string {
        const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
        return new TextDecoder("utf-8").decode(bytes);
    }
    ```
4. **Build interface — two permitted forms**, documented per component:
    - **Form A (single file / define)** — like the changelog: read the file, normalize
      CRLF to LF, embed as `Buffer.from(..., "utf-8").toString("base64")` through a
      Vite `define` (`__X_B64__`).
    - **Form B (large structured data)** — move raw data to
      `src/lib/data/<name>.md` or `.txt` and import it through a Vite plugin loader.
      `src/` then carries only the import, never the content. Form B is the default
      for new text blocks that contain newlines.
5. **Encoded inventory (implemented)** — the former candidate list is fully shipped:
    - P1 `CHANGELOG.md` — implemented (Form A, `__CHANGELOG_B64__`, decoded in
      `InfoTab.svelte`).
    - P2 `src/lib/gui/i18n.svelte.ts` — implemented: the dictionary lives in
      `src/lib/data/i18n.json` and is decoded from `__I18N_B64__`; key types are generated
      into `i18n.keys.ts`.
    - P3 Long template literals / multi-line text — implemented for the chat/error
      templates via Form B text files (`src/lib/data/chat-template.*.txt`,
      `src/lib/data/chat-error-template.*.txt`). Their shared per-locale contract lives
      in `src/lib/data/chat-contract.*.txt` and is pulled in by the
      `{{include:<name>}}` marker, which `scripts/build-defines.ts` expands before
      Base64 encoding (one level, no recursion).
    - P4 Inline SVG raw data — stays as files under `assets/icons/material/` and
      `assets/icons/app/`; no inline multi-line SVG literals are shipped.
6. **Architecture / docs duty:** new encodable texts must be referenced in the
   component doc's "Data flow" section and here; all referenced paths must exist
   (enforced by `npm run docs:check`).
7. **Tests:** every new embedded source gets a round-trip test (base64-encode in the
   test, then `decodeText`), analogous to `src/lib/core/__tests__/encoding.test.ts`.

## Amendment — Base64 embedded as 200-char string arrays (2026-10-31)

The Tampermonkey script editor froze on very long single-line literals even
though the data itself was Base64. Post-build regex splitting turned out to be
unsafe: it broke escaped sequences and invalid code. The stable rule is:

- Encoded defines are emitted as arrays of at most 200 Base64 characters:
  `JSON.stringify(value.match(/.{1,200}/g) ?? [])`
- Runtime callers decode via `decodeText(...join(""))`
- `__CHANGELOG_B64__`, `__I18N_B64__`, `__CHAT_TEMPLATE_DE_B64__` and
  `__CHAT_TEMPLATE_EN_B64__` use this form
- Update source and `vitest.config.ts` together
- Do not post-process generated `.user.js` to split literals
- `esbuild` and `terser` stay dev-dependencies

## Consequences

**Positive:**

- One unified, documented contract instead of a raw changelog embedding alone; no new
  permission grants or CSP exposure.
- Raw, conspicuous text blocks disappear from the output; the changelog flow stays
  valid and tested.
- Decode logic exists once, is reusable, and is unit-testable in the node env.

**Negative:**

- Each encoded source adds ~33% (Base64 overhead) to the bundle — apply strictly
  and selectively.
- Runtime decode cost (`atob` + `TextDecoder`) per source; consider lazy decoding
  for large payloads.
- The rule must be maintained; over-engineering trivial strings is a real risk.

## Non-goals

- Obfuscation or encryption of logic or secrets (secrets must not ship in the
  bundle at all).
- Confidentiality: Base64 is an encoding, not encryption, and does not protect
  content from a determined reader.
- Translating changelog contents.

## References

- Implementation: `vite.config.ts` + `scripts/build-defines.ts` (define pattern and
  200-character chunking), `src/vite-env.d.ts`, `src/lib/core/encoding.ts` (generic
  decoder), `src/lib/gui/tabs/InfoTab.svelte` (runtime decode site),
  `src/lib/core/__tests__/encoding.test.ts`
- Release contract: [ADR 0008](0008-release-please-automation-contract.md) — change log,
  `@version` header and release asset are produced in the same merge, which is what
  keeps the embedded changelog consistent with the installed header
- Docs gate: `scripts/check-docs.mjs`
- Rule of thumb: the output shows what was shipped in this build — build-time data
  beats runtime fetching for content that is already static per release, and the
  same rule applies to any static text that must not stand out in the bundle.
