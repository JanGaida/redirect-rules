# ADR 0043: Logging contract — scoped logger, sparse info, complete debug, fast silent path

- Status: accepted (2026-11-05)
- Deciders: project owner
- Builds on: [ADR 0001](0001-pure-engine-split.md), [ADR 0041](0041-performance-mode.md)
- Component doc: [logging.md](../architecture/logging.md)

## Context

The userscript already had a small logger (`src/lib/core/log.ts`) with five settings
levels, but the implementation was inconsistent and incomplete:

- `warn` and `error` were emitted through `console.log`, so DevTools level filters,
  warning styling, and error stacks did not work as expected.
- Every call site repeated the scope string, the format was assembled per call, and the
  logger had no tests.
- Debug coverage was thin: boot decisions, compile summaries, checkpoint outcomes,
  watcher no-ops, stats/storage lifecycles, autosave state, and almost all dashboard
  user actions were invisible.
- `silent` skipped the console call, but argument objects were still allocated before the
  call, so "off" was not as cheap as it looked.
- The console output is the script's only observable feedback channel (the legacy script
  logged every applied rule). A structured contract is therefore part of the user-facing
  behavior, not just developer tooling.

The project's ADR test applies: the decision spans core and GUI, fixes an external
contract (console output), and is hard to reverse once users and support workflows rely
on it.

## Decision

1. **One scoped logger factory.** Runtime code calls `createLogger(scope)` from
   `src/lib/core/log.ts`; the scope is a typed `LogScope` union. Format:
   `[Redirect-Rules] LEVEL scope` + message + optional plain payload.
2. **Correct console methods.** `debug` → `console.debug`, `info` → `console.info`,
   `warn` → `console.warn`, `error` → `console.error`. `silent` is settings-only.
3. **Sparse info, complete debug.** `info` carries only user-observable outcomes
   (first-boot defaults, persisted settings, remote adoption, applied rule, issued
   redirect). `debug` carries the full decision trail: boot, compile, engine steps,
   watcher runs, loop guard, stats/storage, autosave, dashboard boot, and discrete UX
   actions. Keystrokes and live preview evaluations are deliberately not logged.
4. **Plain Object payloads.** Payloads are JSON-safe objects (or a factory resolved only
   after the level check); the logger never calls `JSON.stringify`. `RegExp`, `Error`,
   DOM nodes, and Svelte `$state` proxies are projected to plain values at the call site.
5. **Performance is part of the contract.** Each logger method returns after one numeric
   comparison when filtered. Prefixes and styles are built once per scope+level.
   Per-item engine debug logs are behind a single `isDebugEnabled()` guard; at
   `info`/`silent` no payload object or closure is built. `performanceMode` continues to
   force `silent` without overwriting the stored `logLevel`.
6. **Correlation.** Each watcher run gets a monotonic `runId` and a `trigger`
   (`boot`/`manual`/`popstate`/`urlchange`); the engine receives the `runId` so a full
   decision chain can be filtered in the console.
7. **No new data channel.** Logs stay in the page console: no file/network sink, no
   persistence, no global debug API, and no redaction. Debug is opt-in and may contain
   full URLs and rule text; the docs carry a PII warning.

## Consequences

- Debug builds/sessions become much noisier by design; `info` stays quiet.
- DevTools level filters now work, and `console.debug` lives under "Verbose".
- Payload discipline is mandatory: no live proxies or non-serializable values.
- The settings storage schema does not change; existing profiles need no migration.
- Performance mode still silences the dashboard context (it is a new page load). To debug
  UX, turn performance mode off and set the log level to `debug`.
- Console users who filtered on `console.log` must switch to the level-based filters.
- The logging contract, scope list, and performance rules are documented in
  `docs/architecture/logging.md` and pinned by `src/lib/core/__tests__/log.test.ts`.
