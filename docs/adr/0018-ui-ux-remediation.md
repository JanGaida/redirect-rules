# ADR 0018: UI/UX remediation — durable accessibility and layout contracts

- Status: accepted (2026-11-06 — reduced to the still-valid cross-cutting contracts)
- Date: 2026-11-02
- Applies to: dashboard UI (`src/lib/gui/`), dev center (`index.html`), see
  [gui.md](../architecture/gui.md)
- Superseded in part by: [ADR 0031](0031-dashboard-interaction-model.md) (row actions,
  keyboard reordering, inline rule editor, test-case rows and the `.rr-detail`
  contract), [ADR 0039](0039-delete-undo-toast.md) (row deletes without confirmation),
  [ADR 0020](0020-multi-dashboard-autosave.md) (no Save button) and the 2026-11-04
  removal of the zone-toolbar fold-all control.

## Context

A UI/UX review of the dashboard and the Vite dev center found structural problems that
were not covered by earlier visual iterations: dead controls, duplicated toolbars,
falsely-open `<details>` groups, unlabelled preview inputs, immediate destructive
deletes, hardcoded German strings, mouse-only reordering, failing WCAG AA contrast, and
three icon mechanisms including runtime Google Fonts.

Most of those defects were later re-decided by dedicated records. This ADR keeps only
the durable, cross-cutting contracts that no later record replaced: one icon system,
accessibility/contrast, mandatory i18n, keyboard operability, and the narrow layout.
The superseded decisions stay listed below for history; the current interaction model
lives in [ADR 0031](0031-dashboard-interaction-model.md).

## Decision

1. **One icon system.** Only the inline SVG registry (`src/lib/gui/icon.ts`) is used.
   Runtime Google Fonts / Material-Symbols web-font links are removed. Icons follow
   `currentColor`, so both themes stay legible.
2. **Accessibility and contrast.** `--rr-faint` is raised to AA in both themes; the type
   scale is tokenized (`--rr-fs-xs/sm/md/lg`) and stays Hack Mono (user decision).
   `documentElement.lang` follows the resolved locale. The dashboard root does not claim
   `role="application"`.
3. **Narrow layout.** Below 1100 px the explorer stacks above the preview, the dock
   spans the full width, both drag grips are hidden, and fields lose their 24 rem
   minimum. Resize grips are focusable buttons with arrow-key support.
4. **I18n is mandatory for visible text.** Existing unused keys are wired; new visible
   strings need keys in both locales. Raw code enums never reach the UI.
5. **Keyboard operability.** The dashboard is fully operable without a mouse for
   selection, reordering, filtering, and resizing.

## Superseded decisions

| Original decision                                                    | Replaced by                                                                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1 — one toolbar per zone with fold-all and global drag lock          | [ADR 0031](0031-dashboard-interaction-model.md) (no drag lock); fold-all removed 2026-11-04; empty states still carry no controls |
| 2 — test cases are list rows with a status chip and body editing     | [ADR 0031](0031-dashboard-interaction-model.md) decisions 7–8 (summary URL rows, text-only status chip)                           |
| 4 — destructive deletes require confirmation                         | [ADR 0039](0039-delete-undo-toast.md) (single-slot undo toast)                                                                    |
| 5 — Save is primary; refresh + undo secondary; language chip removed | [ADR 0031](0031-dashboard-interaction-model.md) decisions 10–11 (no save button, four footer pills)                               |

Decision 3 (controlled `<details>` groups) stays in force: the native element owns its
`open` state (`onSiteToggle` mirrors it, single-open), the site gate editor lives in the
opened body, and collapsed groups are genuinely collapsed for AT, search, and print.

## Consequences

- The durable e2e contracts stay: `.rr-dashboard`, `.rr-master-site`,
  `.rr-master-rule`, `.rr-detail`, `.rr-detail .rr-input` order, `.rr-theme-toggle`, and
  the documented accessible names. The full current DOM contract is owned by
  [ADR 0031](0031-dashboard-interaction-model.md).
- The session snapshot is no longer re-dirtied by selection bookkeeping:
  `lastSelection` is written only on explicit selection changes.
- The stale `panel-smoke` specs were removed with the dead panel code; the
  dashboard-smoke suite is the surviving E2E contract.
- No new runtime dependencies; the dev center duplicates the token block on purpose
  (it is a standalone Vite page).

## References

- Icon registry: `src/lib/gui/icon.ts`
- Dashboard styles: `src/lib/gui/dashboard.css`
- i18n dictionary: `src/lib/data/i18n.json`
- Current interaction model: [ADR 0031](0031-dashboard-interaction-model.md)
