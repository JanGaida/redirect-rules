# CONTEXT — Developer Guide

> Know-how & development flow for new agent sessions and contributors.
> End-user-facing doc: see [README.md](README.md).

## What This Is

A Tampermonkey userscript that rewrites/redirects URLs via regex rules, with an in-page
rule editor GUI (Svelte 5). Runs at `document-start` on every page (`*://*/*`), hooks
SPA navigation (pushState/popstate), merges query parameters fragment-safely, and
aborts redirect loops per tab.

Built with **Svelte 5 (Runes) + TypeScript (strict)**, bundled by **Vite +
vite-plugin-monkey** into a single `.user.js`.

## Stack & Tooling

| Layer              | Tool                                                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework          | Svelte 5 (Runes — `$state`, `$derived`, `$props`)                                                                                                                                                                 |
| Language           | TypeScript (strict via `@tsconfig/svelte`)                                                                                                                                                                        |
| Bundler            | Vite 8                                                                                                                                                                                                            |
| Userscript wrapper | vite-plugin-monkey 8                                                                                                                                                                                              |
| Typecheck          | `svelte-check` + `tsc` (combined in `npm run check`; includes tests)                                                                                                                                              |
| Docs gate          | `npm run docs:check` — `scripts/check-docs.mjs` (sections, links, generated ADR table, archive, Verified footer length)                                                                                           |
| Comment gate       | `npm run comments:check` — English, block/line length, product-copy audit, internal shorthand, root configs/HTML + test titles, Better-Comments tags at standalone block heads; `--strict` fails on hard findings |
| CSS gate           | `npm run css:check` — `scripts/check-css.mjs` (declared-but-unreferenced classes, keyframes, `--rr-*` tokens); `--strict` fails on findings                                                                       |
| Release gate       | `npm run release:check` — `scripts/check-release-config.mjs` (release-please wiring + version-mirror drift)                                                                                                       |
| Format             | Prettier (4-space, double-quote) — `npm run format` / `format:check`                                                                                                                                              |
| Test               | Vitest 4 (`node` + `jsdom` envs) — `npm run test`                                                                                                                                                                 |
| E2E                | Playwright (Firefox) against committed synthetic fixtures — `npm run test:e2e`                                                                                                                                    |

### Commands

```bash
npm install          # install deps
npm run check        # svelte-check + tsc — typecheck gate (must be green before commit; includes tests)
npm test             # vitest run — engine, append-query, settings, watcher, store + ported legacy corpus
npm run test:e2e     # playwright test — effective URL behavior against local fixtures (needs `npm run build`)
npm run screenshots  # playwright screenshot config — regenerate assets/screenshots/*.png for the README (needs `npm run build`)
npm run docs:check   # architecture-docs gate (sections, links, generated ADR table, footers)
npm run docs:index   # regenerate the ADR table in docs/architecture/INDEX.md
npm run release:check # release-please wiring + version coherence (offline; also in CI)
npm run comments:check # comment audit (English, block/line length, product copy, internal shorthand, tags at standalone heads; root configs/HTML + test titles; --strict fails hard findings)
npm run css:check    # CSS gate — declared-but-unreferenced classes, keyframes, --rr-* tokens (--strict fails hard findings)
npm run format:check # prettier gate (CI gate)
npm run dev          # vite dev server — HMR userscript integration flow (effective dev flag on)
npm run dev:gui      # vite dev server — isolated gui/component flow (best-effort, same identity)
npm run build        # production build → dist/redirect-rules.user.js
npm run build:dev    # dev build → dist/redirect-rules.dev.user.js (readable + dev-only TM-menu entries)
npm run build:prod   # production build → dist/redirect-rules.user.js
npm run install:dev  # build:dev + local HTTP launcher for Tampermonkey install
npm run install:prod # build:prod + local HTTP launcher for Tampermonkey install
npm run open:install:dev  # local HTTP launcher only (dist/redirect-rules.dev.user.js, no build)
npm run open:install:prod # local HTTP launcher only (dist/redirect-rules.user.js, no build)
npm run format       # prettier --write . (4-space auto-fix)
```

**Build output**: `dist/redirect-rules.user.js` — the file you install in Tampermonkey.
The userscript header is GENERATED from the `monkey.userscript` block in
`vite.config.ts`, never hand-written.

**Build modes** (selected via env var, see `vite.config.ts` + `package.json` scripts):

| Mode    | Command              | Flag                                      | Artifact                                                              |
| ------- | -------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| prod    | `npm run build`      | `__DEV__ = false`                         | `redirect-rules.user.js` (minified, dev entries dead-code-eliminated) |
| dev     | `npm run build:dev`  | `RR_DEV=1` → `__DEV__ = true`             | `redirect-rules.dev.user.js` (readable, dev-only TM-menu entries)     |
| prod    | `npm run build:prod` | `NODE_ENV=production` → `__DEV__ = false` | `redirect-rules.user.js`                                              |
| dev/HMR | `npm run dev`        | mode development → effective dev flag on  | (no artifact; Vite HMR userscript flow)                               |
| dev/GUI | `npm run dev:gui`    | mode gui (best-effort, same identity)     | (no artifact; isolated component flow)                                |

The dev artifact intentionally has no `@updateURL`/`@downloadURL` (ADR 0015 decision 3), so
it is never auto-replaced by a release; reinstall the prod build to switch back.

## Project Structure

```
src/
├── main.ts                       # Boot: load → logLevel → compile → watcher+stats → GM menu (dashboard entries)
├── vite-env.d.ts                 # __DEV__ build flag + ambient GM_* types (incl. GM_info)
└── lib/
    ├── core/                     # framework-free logic (pure TS) + ONE side-effect layer
    │   ├── log.ts                # Scoped logger: levels, plain payloads, runId correlation, silent fast path
    │   ├── storage.ts            # GM wrapper — keys "settings" + "stats" + "dashboard-request"
    │   ├── locale.ts             # detectLocale: de/en
    │   ├── parse-regex.ts        # /pattern/flags + literal fallback + WS normalization + stripGlobalFlag
    │   ├── settings.ts           # Settings types/defaults/normalize + load/save
    │   ├── redirect-engine.ts    # compileRules + executeCompiledGroup + applyRules — PURE
    │   ├── append-query.ts       # appendQueryParams — pure string surgery
    │   ├── unwrap-url.ts         # unwrapTarget — one-pass wrapper-target decode + http(s) guard
    │   ├── decode-surface.ts     # querySurface/paramKeySurface — matching-level decode
    │   ├── preview.ts            # previewGroup/previewChain/splitUrlComponents/expandSubstitution — PURE
    │   ├── stats.ts              # StatsSink (eager delta) + ruleHash + per-context getStatsSink singleton
    │   ├── stats-drain.ts        # drainPendingStats/clearStatsDeltaStash — boot recovery for truncated GM writes
    │   ├── settings-diff.ts      # countChanges (row-granular change badge)
    │   ├── settings-transfer.ts  # export envelope + strict parse/diff/merge/replace (ADR 0037)
    │   ├── chat-template.ts      # renderChatTemplate (LLM prompt text)
    │   ├── assistant-proposal.ts # parseAssistantProposal + resolveProposal (tolerant answer → strict transfer)
    │   ├── encoding.ts           # decodeText for build-time Base64 payloads
    │   ├── watcher.ts            # SPA hook, loop guard (window.name), location.replace, stats recording
    │   └── __tests__/            # 21 vitest files + gm-stubs.ts
    ├── stores/
    │   └── settings.svelte.ts    # $state<Settings> singleton — single source of truth, prune-on-save
    └── gui/                      # Svelte 5 dashboard (hash-takeover tab, lazy via GM menu — ADR 0011/0012)
        ├── dashboard.ts          # openDashboard (GM_openInTab, multi-tab) + startDashboardMode (stop+wipe+mount)
        ├── dashboard-protocol.ts # pure: #rr-dashboard marker + host + boot request shapes
        ├── autosave.svelte.ts    # debounce + pause gates + session snapshot (undo) + remote-sync policy
        ├── autosave-speed.ts     # canonical fast/normal/slow steps + nearest/next mapping
        ├── App.svelte            # Dashboard root: header + status segment + rail nav, undo/close, ESC/beforeunload on win
        ├── i18n.svelte.ts        # TRANSLATIONS de/en + reactive t(key, params)
        ├── i18n.keys.ts          # generated key union (i18n:gen)
        ├── dashboard.css         # .rr-* classes (global; ?inline into the dashboard doc)
        ├── validation.ts         # invalidRegexCount + pruneEmptyRows (save policy)
        ├── highlight.ts          # regex/substitution tokenizer for field mirrors
        ├── reorder.ts            # pure DnD/lock/fold index math
        ├── drag-controller.ts    # pointer list drag: capture, ghost, autoscroll
        ├── icon.ts               # inline SVG registry
        ├── ui-state.svelte.ts    # popover/modal/toast transient view state
        ├── settings-transfer-view.ts # transfer rows/labels/tri-state/filter (ADR 0037)
        ├── download.ts           # Blob JSON download helper
        ├── clipboard.ts          # GM_setClipboard → navigator.clipboard → execCommand
        ├── tabs/RulesTab.svelte  # explorer | preview + inline rule editor (no status row)
        ├── tabs/AssistantTab.svelte # split workbench: prompt card + provider links | JSON import + reveal
        ├── tabs/StatsTab.svelte  # redirect counters, per-rule/site/kind
        ├── tabs/SystemTab.svelte # locale/logLevel/theme/motion/host + transfer dialog trigger
        ├── tabs/InfoTab.svelte   # version (GM_info), links, embedded changelog
        └── components/           # RuleEditor · RegexManual · TextInput · TextArea · ChoiceGroup ·
                                  # SettingsChoiceRow · RowActions · DragHandle · StatusLine ·
                                  # TokenReference · Icon · ProviderLinks · SettingsTransferDialog · autogrow
e2e/
├── global-setup.ts / global-teardown.ts
├── helpers/                      # fixture-server (port 4184) · gm-polyfill · userscript injection · dashboard tab
└── tests/                        # redirect-on-load · no-match · spa-navigation · append-query · loop-guard
                                  # dashboard-smoke · group-enable · toast-undo · performance-mode
docs/                             # project documentation root
├── architecture/                 # TRACKED · INDEX.md + component docs (gate-checked)
├── adr/                          # TRACKED · decision log (see INDEX.md for the current list)
├── todo/                         # local-only · TODO/backlog notes — default place for open work
├── prototype/                    # local-only · HTML design prototypes/POCs
└── analysis/                     # local-only · reviews/analysis reports
.vscode/                          # editor integration · tasks.json + code-workspace tracked
```

### Documentation Folders

`docs/` is the single documentation root. Only `docs/architecture/` and `docs/adr/` are
tracked and gate-checked by `npm run docs:check`; everything else there is local-only
(gitignored) working material:

- docs/todo — TODO/backlog notes; the default place for open work
- docs/prototype — HTML design prototypes and POCs
- docs/analysis — reviews and analysis reports

Use these existing folders (create the folder/file there on demand) instead of inventing
new locations. Never reference local-only material as a required path in tracked docs —
the docs gate rejects prototype/analysis path references.

**VS Code integration** belongs in `.vscode/`: `tasks.json` and
`redirect-rules.code-workspace` are tracked, every other file there is gitignored — do not
add editor config elsewhere.

## Rule Model (ADR 0002, ADR 0046)

```ts
type ReplaceRule = { kind: "replace"; regex: string; substitution: string };
type AppendQueryRule = { kind: "appendQuery"; regex?: string; params: string }; // regex normalizes to ""
type RemoveQueryRule = { kind: "removeQuery"; regex?: string; keys: string }; // regex normalizes to ""
type CheckpointRule = { kind: "checkpoint"; regex: string; mode: "continue" | "stop" };
type UnwrapRule = { kind: "unwrap"; regex: string }; // group 1 (or whole match) = encoded target
type SiteRule = {
    siteRegex: string;
    description?: string;
    disabled?: boolean; // true = engine skips the group; absent = active (ADR 0038)
    previewEntries?: PreviewEntry[];
    rules: UrlRule[];
};
```

- `replace`: STANDARD `String.replace` semantics — no magic tokens. Regex in
  `/pattern/flags` notation, else literal-escaped. Whitespace variants: authored
  `" "`/`\s` (outside character classes) match both the raw and `%20` forms
  (`parse-regex.ts` `normalizeWhitespaceVariants`).
- `appendQuery`: params (`k=v&k2=v2`) merged fragment-safe — `?`/`&` correct, existing
  key overwrites in place, raw encodings preserved, NO `new URL()` on the engine path.
- `removeQuery`: `keys` (`utm_*&fbclid`) remove matching query pairs — a trailing `*`
  is a prefix wildcard, ALL matches (duplicates included) are removed, raw encodings
  and the fragment are preserved, an emptied query drops the `?` (ADR 0044).
- `checkpoint`: tests the CURRENT url without changing it; `continue` proceeds only on a
  match, `stop` aborts the rest of the group on a match (ADR 0019). It is not an
  `AppliedRule` and never increments stats.
- `unwrap`: matches the RAW url, decodes capture group 1 (or the whole match) once with
  `decodeURIComponent`, and replaces the WHOLE url only when the target is absolute
  `http(s)` (ADR 0046). No `+`→space, no re-encoding, no `new URL()`; the fragment comes
  from the target. `unwrapTarget` owns the decode + scheme guard.
- Engine: pure single pass — site gates evaluated ONCE against the input url;
  rules apply sequentially within matched groups (legacy semantics, corpus-pinned).
- Group on/off (ADR 0038): `SiteRule.disabled` is a sparse group-level flag
  (no per-rule switch). The engine skips off groups at compile; `previewGroup`
  still simulates them with an explicit banner. Off groups are inert for the
  autosave gate/prune, so a broken group can be parked and saved.
- Preview (`preview.ts`): group-bound — preview/test entries live on the SITE
  GROUP (`SiteRule.previewEntries` — each entry has `url` + `testOutputUri`; empty output = preview only);
  `previewGroup` replays the exact `applyRules` semantics SCOPED to one group
  (every authored rule gets a chain step: applied or skipped + reason), pinned
  to `applyRules` outputs by tests — engine refactors MUST update the preview
  parity tests together (`preview.test.ts`); `previewChain` stays the
  full-settings parity oracle. GUI: single-open explorer accordion, chain =
  rule number within group + rule label summary, selected rule = highlight only.
- Stats (`stats.ts`): per-rule redirect counters under the separate `stats` GM key,
  identity = `ruleHash(siteRegex, rule)` content hash (editing a rule resets its
  counter — user-accepted trade-off, no rule IDs in the schema). Eager delta persistence
  (read-modify-write), failed-write retry via `window.name`.

## Critical Constraints

- **`@run-at document-start`**: the boot must not touch `documentElement`/`document.head`
  on NORMAL pages; the dashboard is a HASH-TAKEOVER tab (ADR 0011) on an inert host stub
  (ADR 0012) with the `#rr-dashboard` marker that `startDashboardMode` stops and wipes at
  document-start.
- **TM menu callbacks have NO transient user activation**: `window.open` from a menu
  command is popup-blocked by real browsers (Playwright is not — false-green trap) —
  the dashboard MUST open via `GM_openInTab` (granted).
- **Popup-provisional commit**: window.open'ed/GM_openInTab'ed tabs run their init
  scripts on the provisional `about:blank` document before the real url commits —
  the boot defers while `location.href === "about:blank"` (capped 2 s poll in main.ts).
- **Dashboard tab lifetime**: the takeover tab IS its own userscript context — no
  opener dependency. MULTI-DASHBOARD (decision 27.10.): every menu click opens its
  own tab — no heartbeat, no forwarding; tabs stay in sync via the settings
  value-change listener (remote reload while clean, conflict hint while dirty —
  `autosave.svelte.ts`), and settings persist via the configurable autosave
  debounce (rail stopwatch: 1/2/5 s, ADR 0031) with fail-safe pause gates
  (invalid regex / empty rows never reach storage); Close/ESC flush synchronously.
- **Dashboard styles**: ONE global stylesheet (`dashboard.css`, `?inline`) injected
  via `adoptedStyleSheets` (CSP-exempt) — per-component scoped styles would land in
  the WRONG `<head>` (host-page context) and never reach the dashboard.
- **Takeover tab's `load` event never fires** (`window.stop()` aborts it) — e2e waits
  for the dashboard SELECTOR, not load state.
- **GM globals**: `GM_*` are Tampermonkey grants — types in `src/vite-env.d.ts` must
  match the `@grant` list in `vite.config.ts` (`GM_info` needs no grant but a type).
- **Loop-guard storage = `window.name`**: sessionStorage THROWS in Firefox
  pre-URL-commit contexts (document-start / Playwright init) — it silently disabled
  the guard until the E2E caught it. See `watcher.ts` header. The persisted loop
  history stores hashed keys, not raw URLs.
- **Persistence read failures are not empty storage**: `loadSettings` writes defaults only after a SUCCESSFUL read of an absent key; a failed read returns defaults without writing. The stats sink and boot drain keep pending deltas on a failed read instead of merging them into an empty base.
- **noEmit is required** (see comment in `tsconfig.json`): emitted `*.config.js`
  would SHADOW the `.ts` configs (Vite loads `.js` first).
- **Dev-build flag**: `__DEV__` (compile-time, replaced by Vite `define` from
  `RR_DEV`) gates the dev-only TM-menu entries in `src/main.ts` — prod builds
  dead-code-eliminate them; the artifact names differ per mode (see Build modes).
- **Engine refactors**: require a concrete case + a new ADR (ADR 0017); update the
  preview parity tests in the same change (see Rule Model).
- **`history.replaceState` is not hooked**: deliberate legacy parity — revisit only
  with a concrete use case.

## Testing

- **Unit (node)**: pure logic incl. the ported legacy corpus (~115 cases,
  `corpus.test.ts`), whitespace normalization (`parse-regex.test.ts`), preview
  parity + substitution-expansion corpus (`preview.test.ts`), stats hash/sink
  (`stats.test.ts`), logger level/payload/performance contract (`log.test.ts`),
  dashboard protocol (marker/boot request — `dashboard-protocol.test.ts`), autosave gates
    - session snapshot + remote-sync policy (`autosave.test.ts`), autosave speed mapping
      (`autosave-speed.test.ts`), logLevel normalization (`settings.test.ts`), shipped-default
        - group on/off pinning (`example-rules.test.ts`, `redirect-engine.test.ts`,
          `validation.test.ts`, `autosave.test.ts`, `settings-transfer.test.ts`).
- **Integration (jsdom)**: watcher loop-guard (injectable runtime) + stats sink
  recording/abort split, store CRUD.
- **E2E (Firefox, in CI)**: real navigations via CONTEXT-scoped addInitScript
  injection against committed synthetic fixtures (ADR 0004); `dashboard-smoke.spec.ts`
  drives the REAL takeover tab (context page event) across all three tabs + the
  autosave round-trip, the speed pill + header countdown indicator, the close flush, the
  multi-dashboard sync (second tab, remote reload), the undo restore and group
  enable/disable (`group-enable.spec.ts`). Takeover caveats: provisional-
  about:blank commit deferral, aborted `load` event.
- **Manual**: Tampermonkey install, real-world rules, native `confirm()`/`beforeunload`
  dialogs, busy + strict-CSP site for the takeover wipe, multi-tab autosave
  conflicts on a real profile.
- **Known CI gap**: both workflows run on Node 22 only, while `engines` allows
  `^20.19.0 || >=22.12.0` — Node 20 compatibility is not exercised by CI.

## Release Workflow

- Dev on a branch, squash-merge PRs to `main` with **Conventional Commits** titles
  (ADR 0009) — `main` is protected.
- `feat`/`fix` commits update the pending release-please PR; merging it tags the
  release, publishes the GitHub Release, and attaches `dist/redirect-rules.user.js`
  (ADR 0008 — the `updateURL` target Tampermonkey auto-updates from).
- `.release-please-manifest.json` is the version source of truth; tags are `vX.Y.Z`
  (`include-component-in-tag: false`).
- Distribution is GitHub Releases only. The Terser-minified prod build is intentional;
  Greasy Fork is not supported because its code rules forbid minified bundles.
- CI (`.github/workflows/ci.yml`): `gate` (check/test/comments:check/css:check/docs:check/release:check/format:check/build),
  `e2e` (build → Playwright Firefox → test:e2e), and `secrets` (gitleaks over full history).

## License

GPL-3.0 — see [LICENSE](LICENSE). The `@license` directive in the `vite.config.ts`
userscript block must stay `GPL-3.0` to match.
