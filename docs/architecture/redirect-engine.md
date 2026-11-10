# Architecture: Redirect Engine

> How site rules are compiled and applied to a URL, and how the watcher turns a changed
> URL into a navigation. Diagrams depict relationships, structure, and boundaries — no
> implementation details.

## Component Structure

Pure transformation split from the side-effect layer (ADR 0001):

```mermaid
flowchart TB
    subgraph Core["src/lib/core/"]
        Settings["settings.ts<br/>(SiteRule, UrlRule types)"]
        Parse["parse-regex.ts<br/>(parseRegex, normalizeWhitespaceVariants,<br/>stripGlobalFlag, stripStickyFlag)"]
        Decode["decode-surface.ts<br/>(querySurface, paramKeySurface —<br/>matching-level percent-decode)"]
        Compile["compileRules()"]
        Apply["applyRules()"]
        Append["append-query.ts<br/>(appendQueryParams)"]
        Watcher["watcher.ts<br/>(createWatcher, startWatcher)"]
        Preview["preview.ts<br/>(previewGroup, previewChain)"]
        Stats["stats.ts<br/>(StatsSink, ruleHash)"]
    end

    Settings -->|"site rules"| Compile
    Compile -->|"gate regex / rule regex"| Parse
    Compile -->|"CompiledSiteRule[]"| Apply
    Apply -->|"appendQuery kind"| Append
    Apply -->|"appendQuery gate test"| Decode
    Apply -->|"checkpoint gate test"| Parse
    Append -->|"key match test"| Decode
    Watcher -->|"applyRules(url, compiled)"| Apply
    Preview -->|"replays applyRules semantics"| Apply
    Preview -->|"substitution expansion"| Parse
    Watcher -->|"record applied rules (pre-redirect)"| Stats
```

## Compilation — fail-soft (`compileRules`)

```mermaid
flowchart TB
    Start["per SiteRule in settings.rules"] --> Enabled{"disabled === true?"}
    Enabled -->|"yes (and !includeDisabled)"| DropDisabled["skip site rule<br/>Log.debug"]
    Enabled -->|"no"| GateTry{"parseRegex(siteRegex)<br/>throws?"}
    GateTry -->|"yes"| DropSite["skip site rule<br/>Log.error"]
    GateTry -->|"no"| Gate["gateRe = stripGlobalFlag(...)"]
    Gate --> RuleLoop["per UrlRule in siteRule.rules"]
    RuleLoop --> Kind{"kind"}
    Kind -->|"replace"| Replace["replaceRe = stripStickyFlag(parseRegex(regex))"]
    Kind -->|"appendQuery"| Gate2{"regex authored?"}
    Kind -->|"removeQuery"| RQGate{"regex authored?"}
    Kind -->|"checkpoint"| CheckpointRe["checkpointRe = stripGlobalFlag(parseRegex(...))"]
    Gate2 -->|"no"| AppendRule["gateRe = null"]
    Gate2 -->|"yes"| AppendGate["gateRe = stripGlobalFlag(...)"]
    RQGate -->|"no"| RQRule["gateRe = null<br/>keys kept"]
    RQGate -->|"yes"| RQGateRe["gateRe = stripGlobalFlag(...)"]
    Replace --> Try{"throws?"}
    CheckpointRe --> Try
    AppendGate --> Try
    AppendRule --> Try
    RQGateRe --> Try
    RQRule --> Try
    Try -->|"yes"| DropRule["skip rule<br/>Log.error"]
    Try -->|"no"| Keep["keep compiled rule"]
```

- Disabled groups (ADR 0038) are skipped at compile by default; `includeDisabled`
  exists only for the group-scoped preview (`previewGroup`), which must simulate
  an off group while the real engine ignores it.
- Gate regexes are stored global-stripped — a `g`-flagged `.test()` would leak
  `lastIndex` state across calls (a latent legacy bug, fixed in `parse-regex.ts`).
- `replace` rules strip the sticky `y` flag at compile (`stripStickyFlag`) but keep `g`
  (replace-all semantics). A sticky regex advances `lastIndex` across
  `String.replace` calls, which made consecutive runs non-deterministic; `g` alone stays
  supported.
- Invalid or unknown flags fall back to the LITERAL path: a string that does not match
  the accepted `/pattern/[dgimsuvy]*` notation is escaped and matched literally — it is
  never rejected as an invalid flag (known limitation, documented behavior).
- `checkpoint` regexes are global-stripped like gates. At run time the regex
  tests the CURRENT url; `continue` proceeds only on a match, `stop` aborts the
  rest of the group on a match (ADR 0019). A checkpoint never changes the URL.
- Empty `replace` and `checkpoint` regexes are dropped at compile (`Log.error`),
  so a hand-edited `stop` checkpoint cannot abort every redirect; an empty
  `appendQuery` or `removeQuery` gate still means "no gate".
- `removeQuery` removes every matching query pair by key: `keys` is
  `&`-separated, matched through `paramKeySurface`, and a trailing `*` is a
  prefix wildcard (`*` alone clears the query). Duplicates are all removed, the
  fragment is never touched, and an emptied query drops the `?` (ADR 0044).
- Whitespace normalization: `parseRegex` rewrites
  authored literal spaces and `\s` OUTSIDE character classes into the
  both-variants class `(?:%20|\s)` — `location.href` always carries `%20`, so
  whitespace-authored regexes could never match before. Inside character classes
  nothing is rewritten (users author `%20` there — documented in the
  rules-editor manual).
- Decoded gate surface (28.10., fuq.com loop): `appendQuery`/`removeQuery` gate
  regexes are tested against `querySurface(current)` — the query component's
  percent-escapes decoded (`filter%5Bquality%5D=` visible as `filter[quality]=`),
  `+` read as space, path/fragment raw. Motivation: gates and params strings are
  authored RAW while pages deliver keys percent-encoded; a raw-exact test appended
  duplicates until the page bounced back (A→B→A loop). The URL string itself is
  still never decoded for EDITS — `appendQueryParams`/`removeQueryParams` keep the
  raw-encoding contract intact; site gates stay tested against the raw url.
  Details: `docs/architecture/query-append.md` + `decode-surface.ts`.

## Application — pure single pass (`applyRules`)

```mermaid
flowchart TB
    In["url"] --> Filter{"siteRule.gateRe.test(url)<br/>— evaluated ONCE against the INPUT url"}
    Filter -->|"no match"| Skip["Log.debug — skipped"]
    Filter -->|"match"| Rules["per rule of the matched site rule"]
    Rules --> Kind{"rule.kind"}
    Kind -->|"replace"| Replace["current.replace(replaceRe, substitution)"]
    Kind -->|"appendQuery"| QGate{"gateRe<br/>absent or matches?"}
    Kind -->|"removeQuery"| RQGate{"gateRe<br/>absent or matches?"}
    Kind -->|"checkpoint"| CGate{"checkpointRe<br/>matches current?"}
    CGate -->|"continue + match<br/>or stop + no match"| NextRule["next rule"]
    CGate -->|"continue + no match<br/>or stop + match"| Abort["abort rest of group"]
    NextRule --> Rules
    Abort --> Out["{ url, changed, applied }"]
    QGate -->|"gate fails"| SkipRule["Log.debug — skipped"]
    QGate -->|"ok"| Append["appendQueryParams(current, params)"]
    RQGate -->|"gate fails"| SkipRule
    RQGate -->|"ok"| Remove["removeQueryParams(current, keys)"]
    Replace --> Changed{"result differs?"}
    Append --> Changed
    Remove --> Changed
    Changed -->|"yes"| Record["Log.info + applied[] entry<br/>current = result"]
    Changed -->|"no"| Next["Log.debug — did not change"]
    Record --> Out
    Next --> Out
```

- Legacy single-pass semantics: the site gates are evaluated once against the
  ORIGINAL url — a rewrite into another group's scope does not trigger that group
  in the same run (it applies on the next page load, after the redirect).
- Within a matched site rule, each rule sees the previous rule's result.
- The sequence lives in the pure `executeCompiledGroup(group, inputUrl, gateUrl)`
  executor (ADR 0017): it returns `{ gateMatched, steps, finalUrl, aborted }` with
  `ruleIndex` and one reason per step (`applied`, `unchanged`, `no-match`,
  `gate-no-match`, `checkpoint-continue`, `checkpoint-stopped`). `applyRules`,
  `previewChain`, and `previewGroup` consume it; preview only builds colored spans.
- `applyRules` records only changed non-checkpoint steps as `AppliedRule`.
  Checkpoints therefore never appear in the applied list or in stats counters.

## Watcher — the side-effect layer (`watcher.ts`)

```mermaid
sequenceDiagram
    participant Nav as navigation / SPA
    participant W as watcher.ts
    participant Eng as applyRules()
    participant Name as window.name
    participant Loc as location.replace

    Nav->>W: load OR urlchange (pushState/popstate)
    W->>Eng: applyRules(location.href, compiled)
    Eng-->>W: { url, changed }
    alt changed = false
        W-->>Nav: nothing
    else changed = true
        W->>Name: read rrLoop history (prune entries older than 3000ms)
        alt current url IS a recent source
            W->>Name: clear history
            Note over W: Log.error "redirect loop detected" — ABORT
        else
            W->>Name: append { source: current, ts } (cap 10)
            W->>Loc: replace(result.url)
        end
    end
```

- The guard keeps a time-windowed HISTORY of redirect sources — a single
  last-source marker cannot catch 2-cycles (A→B→A): on the third hop the marker
  would hold the OTHER page. Found by the E2E loop-guard spec (real A→B→A
  navigations — see testing.md), pinned by `watcher.test.ts` ("blocks 2-cycle
  oscillations").
- The history lives in `window.name`, NOT sessionStorage: sessionStorage is
  unavailable (throws) in pre-URL-commit contexts — Firefox at document-start —
  which silently disabled the guard until the E2E spec exposed it. `window.name`
  is synchronous at document-start and survives same-tab navigations; a foreign
  clobber self-heals to an empty history, so the guard stays armed.
- `createWatcher(compiled, runtime, sink?)` takes an injectable `WatcherRuntime`
  and an optional `StatsSink` — the loop-guard AND the stats recording are
  unit-testable without a browser (`watcher.test.ts`). The sink records applied
  rules AFTER the loop guard passes but BEFORE `location.replace`: the replace
  can synchronously trigger `beforeunload` persistence, so counters must already
  be in memory; loop-guard aborts count nothing.
- `installSpaHook` patches `history.pushState` ONCE per page and adds
  popstate + urlchange listeners; `Watcher.dispose` removes the listeners.

## Scope Boundaries

```mermaid
flowchart LR
    subgraph Supported["Supported"]
        A["replace rules: standard<br/>String.replace semantics"]
        B["appendQuery rules:<br/>fragment-safe merge"]
        H["removeQuery rules:<br/>key-based query removal"]
        C["fail-soft compile +<br/>fail-soft settings load"]
        D["loop-guard: time-windowed<br/>source history (cap 10)"]
        E["SPA: pushState + popstate"]
        F["checkpoint: continue/stop<br/>inside the current group"]
        G["group on/off: engine skips<br/>disabled groups (ADR 0038)"]
    end
    subgraph NotSupported["Deliberately not supported"]
        X["worker pools / concurrency<br/>(legacy dead code, dropped)"]
        Y["history.replaceState hook<br/>(legacy parity)"]
        Z["re-triggering site gates<br/>mid-run after a rewrite"]
        AA["per-rule / per-step enable-disable<br/>(group level only, ADR 0038)"]
    end
```

## Deviation from plan

The plan named the GUI reorder component "DraggableRow"; the first build shipped
`RowActions.svelte`. Pointer-drag reordering now exists, and the move-up/move-down
buttons were removed in favor of the drag path plus a delete/clone-only action strip
(always visible on site rows, hover/selection-revealed on rule rows) — see
[ADR 0031](../adr/0031-dashboard-interaction-model.md).

## References

- Engine: `src/lib/core/redirect-engine.ts`
- Watcher: `src/lib/core/watcher.ts`
- Regex parsing: `src/lib/core/parse-regex.ts`
- Decode surface (matching-level decode): `src/lib/core/decode-surface.ts`
- Preview model (engine-parity replays): `src/lib/core/preview.ts`
- Stats (redirect counters): `src/lib/core/stats.ts`
- Rule types: `src/lib/core/settings.ts`
- Specs: `src/lib/core/__tests__/redirect-engine.test.ts`, `src/lib/core/__tests__/watcher.test.ts`, `src/lib/core/__tests__/corpus.test.ts`, `src/lib/core/__tests__/preview.test.ts`, `src/lib/core/__tests__/stats.test.ts`, `src/lib/core/__tests__/decode-surface.test.ts`
- Query merge: `docs/architecture/query-append.md`
- Decisions: `docs/adr/0001-pure-engine-split.md`, `docs/adr/0017-shared-compiled-step-executor.md`, `docs/adr/0019-checkpoint-rule-kind.md`, `docs/adr/0038-per-group-enable-disable.md`, `docs/adr/0044-remove-query-rule-kind.md`

Verified: 2026-11-09 — removeQuery compile/execute branches, gates and query surgery against `redirect-engine.ts`/`append-query.ts`; replace sticky-flag stripping, window.name guard and stats ordering rechecked.
