# Architecture Documentation — Index

> Entry point for all architecture docs. Read order: `system-overview.md` →
> `redirect-engine.md` → the component docs. Every agent session working on a component
> MUST read its doc first (see AGENTS.md) and keep it in sync during Phase 9 (Verify).
> Template + gate source: `docs/architecture/_template.md` and `scripts/check-docs.mjs`.

## Reading Order

| #   | Doc                                            | Answers                                                                                       | Level (C4)                 |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | [system-overview.md](system-overview.md)       | What does the userscript consist of, how does it boot, who talks to whom?                     | 1–2 (context, container)   |
| 2   | [redirect-engine.md](redirect-engine.md)       | How are rules compiled, applied, and how does the watcher navigate?                           | 2–3 (container, component) |
| 3   | [query-append.md](query-append.md)             | How do the `appendQuery`/`removeQuery` kinds merge or delete query parameters?                | 3 (component)              |
| 4   | [settings-storage.md](settings-storage.md)     | What is persisted, how is it normalized, and how does the store save?                         | 3 (component)              |
| 5   | [stats.md](stats.md)                           | How are redirect counters identified and persisted across contexts?                           | 3 (component)              |
| 6   | [gui.md](gui.md)                               | How is the hash-takeover dashboard structured (tabs, inline editor, preview, R9 affordances)? | 3 (component)              |
| 7   | [dashboard-protocol.md](dashboard-protocol.md) | How do marker, host, boot request, and tab restore connect menu to dashboard?                 | 3 (component)              |
| 8   | [testing.md](testing.md)                       | How is the system verified at each layer?                                                     | cross-cutting              |
| 9   | [logging.md](logging.md)                       | How are levels, scopes, payloads, and the silent fast path defined?                           | cross-cutting              |

## Component Coverage

Every component doc listed here is validated by `docs:check` for mandatory sections
(`Component Structure`, `Scope Boundaries`, `References`, `Verified` footer).

| Component            | Doc                                            | Status     |
| -------------------- | ---------------------------------------------- | ---------- |
| `redirect-engine`    | [redirect-engine.md](redirect-engine.md)       | documented |
| `query-append`       | [query-append.md](query-append.md)             | documented |
| `settings-storage`   | [settings-storage.md](settings-storage.md)     | documented |
| `stats`              | [stats.md](stats.md)                           | documented |
| `gui`                | [gui.md](gui.md)                               | documented |
| `dashboard-protocol` | [dashboard-protocol.md](dashboard-protocol.md) | documented |
| `logging`            | [logging.md](logging.md)                       | documented |

## Architecture Decision Records

Durable decisions live in [docs/adr/](../adr/) — an ADR is warranted only when a
decision is hard to reverse or crosses component/external contracts (test in
`AGENTS.md`). Reversible, single-component decisions stay as code/doc prose.
Superseded and consolidated records are frozen in [archive/](../adr/archive/) and are
not listed below.

The table is generated — never edit it by hand:

- Regenerate after adding, archiving or amending an ADR: `npm run docs:index`
- `npm run docs:check` fails when the committed table drifts.

<!-- ADR-INDEX:START -->

| ADR                                                             | Decision                                                                              | Status   | Date       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------- | ---------- |
| [0001](../adr/0001-pure-engine-split.md)                        | Pure redirect engine split from the side-effecting watcher                            | accepted | 2026-10-25 |
| [0002](../adr/0002-typed-rule-kinds.md)                         | Typed rule kinds — `replace` and `appendQuery` — over magic substitution tokens       | accepted | 2026-10-25 |
| [0003](../adr/0003-blank-storage-restart.md)                    | Blank storage restart — no migration from the legacy settings keys                    | amended  | 2026-10-25 |
| [0004](../adr/0004-synthetic-e2e-in-ci.md)                      | Committed synthetic E2E fixtures — E2E runs in CI                                     | accepted | 2026-10-25 |
| [0008](../adr/0008-release-please-automation-contract.md)       | Release-please automation contract — bump target, PR-update rule, in-workflow assets  | amended  | 2026-10-25 |
| [0009](../adr/0009-squash-merge-and-pr-title-contract.md)       | Squash-only merges with Conventional-Commits PR titles                                | amended  | 2026-10-25 |
| [0011](../adr/0011-dashboard-hash-takeover.md)                  | Dashboard = hash-takeover page (GM_openInTab + document-start takeover)               | amended  | 2026-10-26 |
| [0012](../adr/0012-dashboard-host-stub.md)                      | Dashboard host stub and the `dashboardHost` selector                                  | accepted | 2026-11-02 |
| [0013](../adr/0013-manual-theme-toggle.md)                      | Manual theme toggle ships — persisted tri-state (auto/dark/light)                     | accepted | 2026-10-27 |
| [0014](../adr/0014-static-text-build-time-base64-encoding.md)   | Build-time Base64 encoding for static text literals that must not surface as raw text | accepted | 2026-10-31 |
| [0015](../adr/0015-dev-flow-and-script-identity.md)             | Dev flow and single userscript identity                                               | accepted | 2026-11-01 |
| [0016](../adr/0016-motion-and-animation-strategy.md)            | Motion and animation strategy                                                         | amended  | 2026-10-31 |
| [0017](../adr/0017-shared-compiled-step-executor.md)            | Shared compiled-step executor for engine and preview                                  | accepted | 2026-11-02 |
| [0018](../adr/0018-ui-ux-remediation.md)                        | UI/UX remediation — durable accessibility and layout contracts                        | accepted | 2026-11-02 |
| [0019](../adr/0019-checkpoint-rule-kind.md)                     | Checkpoint rule kind for in-group flow control                                        | accepted | 2026-11-02 |
| [0020](../adr/0020-multi-dashboard-autosave.md)                 | Multi-dashboard tabs and the autosave/session workflow                                | amended  | 2026-10-27 |
| [0031](../adr/0031-dashboard-interaction-model.md)              | Dashboard interaction model                                                           | amended  | 2026-11-02 |
| [0032](../adr/0032-touch-input-support.md)                      | Touch input support                                                                   | amended  | 2026-11-02 |
| [0035](../adr/0035-assistant-tab.md)                            | Rule configuration assistant as a rail tab                                            | amended  | 2026-11-03 |
| [0037](../adr/0037-settings-export-import-dialog.md)            | Settings export/import as one dialog with raw export and strict merge                 | accepted | 2026-11-03 |
| [0038](../adr/0038-per-group-enable-disable.md)                 | Per-group enable/disable (group level only)                                           | accepted | 2026-11-04 |
| [0039](../adr/0039-delete-undo-toast.md)                        | Delete without confirmation — single-slot undo toast                                  | accepted | 2026-11-04 |
| [0040](../adr/0040-skipped-step-visibility-precedence.md)       | Skipped-step visibility — persisted global default, per-group override                | amended  | 2026-11-04 |
| [0041](../adr/0041-performance-mode.md)                         | Performance mode — stats-off and non-destructive silent logging                       | accepted | 2026-11-05 |
| [0043](../adr/0043-logging-contract.md)                         | Logging contract — scoped logger, sparse info, complete debug, fast silent path       | accepted | 2026-11-05 |
| [0044](../adr/0044-remove-query-rule-kind.md)                   | `removeQuery` rule kind for key-based query removal                                   | accepted | 2026-11-09 |
| [0045](../adr/0045-mobile-layout-bottom-nav-and-pane-switch.md) | Mobile layout — bottom navigation and phone pane switch                               | amended  | 2026-11-11 |

<!-- ADR-INDEX:END -->

## Diagram Conventions (Legend)

Notation follows the C4 model review checklist (c4model.com/diagrams/checklist):

- **Title**: every doc section heading names what the diagram answers.
- **Node labels**: real file/component/DOM-selector names from `src/` — grep-verified before
  writing, never invented. Browser/Storage interfaces (`sessionStorage`, `location.replace`,
  `GM_*`) are part of the architecture: the browser environment is the unstable interface
  this userscript codes against.
- **Arrows**: labeled with the relationship intent (`applyRules`, `save`, `register`).
- **Content**: diagrams + prose only — no embedded code snippets.
- **Line styles**: solid = direct call/data flow; dotted (`-.->`) = production/consumption
  across a boundary (e.g., E2E helpers consuming the built userscript).
- **Subgraphs**: group by directory (`gui/`, `stores/`, `core/`) or runtime scope.
- **Scope Boundaries**: every component doc has a `Supported` / `Deliberately not supported`
  block — the anti-feature-creep contract for future sessions.
- **Line breaks in labels**: use `<br/>` (Mermaid portability) — never `\n`.
- **Language**: English. German UI strings (menu labels) are quoted verbatim where they are
  the locale-dependent anchor.
- **Verified footer**: every doc ends with exactly ONE
  `Verified: YYYY-MM-DD — against ...` footer stating which code it was checked against.
  Date + scope only, max 240 characters — history belongs to git, not the footer.
- **ADR numbering**: append-only and unique. The title number matches the filename; the
  table above is generated from the files. Gaps are allowed (0005–0007 and 0042 are unused)
  and are not reported. Fully superseded ADRs move to `archive/` and leave the active table.
- **Local-only sources**: working analysis and prototype material stay outside the tracked
  architecture contract. Tracked docs never reference them as required paths.
