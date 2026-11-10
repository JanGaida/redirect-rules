# ADR 0001: Pure redirect engine split from the side-effecting watcher

- Status: accepted (2026-10-25)
- Deciders: project owner
- Applies to: `src/lib/core/redirect-engine.ts`, `src/lib/core/watcher.ts`

## Context

The legacy single-file script (`old/src.ts`) mixed rule application and navigation in one
place: `UrlWatcher.runAsync` filtered site rules, applied substitutions, and called
`location.replace` inside the same method. The ~90 in-browser unit tests could only run
via a Tampermonkey menu command in a live browser tab — no headless CI coverage, no
property-style table tests, and every test run risked actually navigating the tab.

## Decision

1. `redirect-engine.ts` exposes `compileRules()` + `applyRules(url, compiled)` as PURE
   functions: string in, result out, no DOM access, no navigation, no storage.
2. `watcher.ts` is the thin side-effect layer: pushState/popstate listeners, the
   loop-guard state (time-windowed source history in `window.name`), and the single
   `location.replace` call site.
3. The old `testMode` flag is deleted — a pure function needs no test mode; tests call
   `applyRules` directly, the watcher redirects based on `{ changed }`.
4. Fail-soft compile: an invalid regex logs an error and skips THAT rule — the legacy
   behavior (regex constructor throw killing the whole script at boot) is not ported.

**Rule of thumb:** if it can be a pure string transformation, it must not touch the DOM.

## Consequences

**Positive:**

- The full rule corpus (~115 sample URLs) runs as table-driven Vitest specs in `node`
  env — no browser, no GM globals, fast CI.
- The watcher is small enough to be covered by a few jsdom integration tests plus E2E.
- Loop-guard logic is testable without real navigation.

**Negative:**

- Two files where the legacy script had one class — a deliberate indirection cost.
- Engine consumers must pre-compile rules; the watcher owns the compile→apply lifecycle.

## References

- Engine: `src/lib/core/redirect-engine.ts`
- Watcher: `src/lib/core/watcher.ts`
- Corpus tests: `src/lib/core/__tests__/corpus.test.ts`
- Related docs: `docs/architecture/redirect-engine.md`
