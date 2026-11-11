# ADR 0031: Dashboard interaction model

- Status: accepted (2026-11-02; amended 2026-11-03 — preview summary rows and pills; consolidated 2026-11-06 — absorbs ADR 0033 and ADR 0036; amended 2026-11-11 — responsive navigation, phone pane switch, second grip axis)
- Amended by: [ADR 0045](0045-mobile-layout-bottom-nav-and-pane-switch.md) (layout breakpoints, bottom bar, pane switch, horizontal grip)
- Date: 2026-11-02
- Applies to: the dashboard (`src/lib/gui/App.svelte`, `src/lib/gui/tabs/*.svelte`,
  `src/lib/gui/components/*.svelte`, `src/lib/gui/drag-controller.ts`,
  `src/lib/gui/dashboard.css`) and the persisted settings shape in
  `src/lib/core/settings.ts`; see [gui.md](../architecture/gui.md)
- Consolidates the archived records [0021](archive/0021-row-actions-hover-and-reorder.md),
  [0022](archive/0022-inline-rule-editor.md), [0023](archive/0023-dashboard-rail-navigation.md),
  [0024](archive/0024-autosave-speed-pill-and-countdown.md), [0025](archive/0025-drag-lock-rail-pill.md),
  [0026](archive/0026-info-tab-hero-and-single-scroll-changelog.md),
  [0027](archive/0027-stats-tab-hero-and-cards.md), [0028](archive/0028-brand-color-from-app-icon.md),
  [0029](archive/0029-drag-handle-replaces-drag-lock.md),
  [0030](archive/0030-preview-summary-restyle.md),
  [0033](archive/0033-single-description-surface.md) and
  [0036](archive/0036-rules-tab-row-chrome-reveal.md)

## Context

The dashboard interaction surface was built incrementally: single UI steps recorded
between 2026-11-02 morning and 2026-11-03, including one decision (the global drag
lock, ADR 0025) that was reversed hours later (ADR 0029). Reading the current
contract therefore required following a supersede chain across many files, and the
architecture index mixed durable contracts with presentation restyles.

This ADR records the resulting interaction model as one contract. Presentation-only
decisions (hero cards, changelog layout, brand token naming, caption restyles) are
deliberately excluded: they are reversible and stay as code/doc prose. Later UI
steps with a single component surface (ADR 0033 caption pencil, ADR 0036 reveal
rule) were absorbed here instead of starting new records, per the consolidation
rule in the Consequences.

## Decision

1. **One drag origin.** Reordering starts only from the per-row `DragHandle` grip.
   Rows are never draggable themselves, so accidental drags and text-selection
   conflicts are structurally impossible. The grip is hidden below two items.
2. **One pointer controller.** `drag-controller.ts` handles mouse, touch and pen
   through pointer events: pointer capture, a 4 px activation threshold, a floating
   row ghost, edge autoscroll, and Escape/pointercancel abort. HTML5 drag-and-drop is
   not used. The drop commit and the keyboard path share `moveIndex`.
3. **Keyboard reordering.** ArrowUp/ArrowDown on a focused grip move the row one
   _visible_ position (explorer and preview filters keep one semantics);
   `aria-keyshortcuts` advertises the keys.
4. **No global drag lock.** The lock, its rail pill, its glyphs, its i18n keys and
   `settings.defaultLocked` are gone. `normalizeSettings` copies known fields only,
   so a stored `defaultLocked` is dropped silently — no migration step.
5. **One reveal rule.** In the Rules tab every row-chrome control — the clone/delete
   strip and the caption pencil — is hidden at rest on hover-capable devices and
   appears on row hover, keyboard focus (`:focus-within`) or an open/active row. A
   site group is active while it is open (`details.rr-master-site[open]`); a rule row
   is active while it is selected, which is the same state as its open fold. Under
   `hover: none` the strip and pencil stay permanently visible. Visibility uses
   `opacity` and `pointer-events` only: no layout shift, no hit-box change, and the
   pencil keeps its tab stop. Move up/down buttons do not exist; the action strip is
   clone + delete.
6. **One description surface.** `InlineCaption.svelte` owns the summary caption, the
   absolute overlay input, the draft/focus/blur cycle and `<summary>`-safe event
   guards. Double-click or F2 opens it; Enter commits, Escape cancels, blur commits;
   an unchanged trimmed value is not written. Only one row edits at a time
   (`editingSite` / `editingPreview`). It is the only description editor for site
   groups and preview test cases — the duplicate body fields are removed and
   descriptions are single-line. A trailing icon-only pencil is the touch route: one
   tap opens the same overlay, and the accessible name `a11y.edit` ("Edit
   description" / "Beschreibung bearbeiten") names it while the icon stays
   decorative. The pencil is absolutely positioned and the caption host reserves its
   width via padding, so the caption box, the outward-expanded overlay geometry and
   the zero-jump contract stay intact.
7. **Preview rows mirror site rows.** The caption is the trimmed description, else
   `—`; it never falls back to the URL because the URL rows already show it. `Input`
   and `Output` URL rows always render as
   label-left rows with one shared `max-content` label column and a 6 px gap, span
   the full summary width, and stay editable when empty. At rest each value is a
   `.rr-preview-panel` rendering URI tones plus the input↔expected-output diff
   (`PreviewSpans` / `diffSpans`); the diff does not depend on the test result. A
   double-click or the row pencil opens the same zero-jump overlay as the caption;
   the expanded body no longer carries URL fields. The status chip is text-only short
   labels — `ok` / `fail` / `—` — positioned ahead of the caption (between the
   chevron and the description); color carries the state and the long label (`test
successful` / `test failed` / `no test`) lives in the tooltip and a visually
   hidden accessible name. The TOTAL block is hidden only when a pinned test passes
   (its start/end pair is then identical to the summary rows). The two-line clamp is
   unchanged. The filter matches description, URL, expected output and raw status;
   the add-preview action is reachable in both branches.
8. **Test cases are list rows.** Status is a chip with icon **and** accessible text;
   editing happens in the expanded body with visible labels; test cases are not plain
   always-open inputs and not a second editing dock.
9. **One rules editing surface.** The bottom editor dock is removed. Rules open as
   folds in the explorer; the default split is 50/50; the `.rr-detail` element and
   its input order remain the E2E contract.
10. **Rail navigation and footer utilities.** Tabs live in a vertical rail: Rules,
    Assistant, Stats, Info and System. The header carries a status segment; the
    footer grid carries four pills — theme cycle, locale popup, skipped-step
    visibility and autosave. Pairs keep their fixed 28px cells; a lone trailing pill
    spans both columns and centers, so the stopwatch is not left hanging in the left
    cell. There is no save button.
11. **Autosave.** Speeds are 1/2/5 s, chosen through the pill, with a countdown ring;
    closing the dashboard flushes synchronously. The header distinguishes saving
    (ring) from saved (check).
12. **Presentation is not contract.** Colors, card chrome, hero layouts, caption
    geometry and token names may change without an ADR and without a separate log.

## Consequences

- The DOM contract used by E2E stays: `.rr-dashboard`, `.rr-master-site`,
  `.rr-master-rule`, `.rr-detail`, `.rr-detail .rr-input` order, `.rr-theme-toggle`,
  `.rr-lang-toggle`, `.rr-visibility-toggle`, `.rr-autosave-toggle`, `.rr-rail-tab`
  and the documented accessible names. `rr-ed-preview` names both the preview section
  and its rows, so row-scoped CSS/tests must use `details.rr-ed-preview`.
- Keyboard users get one extra tab stop per row (the grip, plus the caption pencil);
  drag is no longer pointer-only.
- Hybrid devices (`hover: hover`) need two taps for descriptions: the first tap opens
  the group, the second hits the revealed pencil. This is the trade-off ADR 0032
  decision 8 already accepts for row actions. Keyboard users are unaffected: tabbing
  into the row triggers `:focus-within`, so controls are visible before they are
  reached.
- Descriptions that already contain newlines remain readable (HTML collapses
  whitespace in the caption) but can no longer be authored as multiline.
- No settings migration exists or is needed: removed fields are dropped by
  normalization.
- Archived ADRs remain the historical rationale; this ADR is the current truth.
  When this model changes, amend this ADR instead of adding a new UI record — unless
  the change is irreversible or cross-cutting (see the ADR rule in `AGENTS.md`).

## Alternatives considered

- **Keep the lock and add a grip anyway.** Rejected: two safety layers for one
  failure mode; the lock hides reordering by default.
- **Put the grip inside `.rr-actions`.** Rejected: actions are hover-revealed, so
  the drag affordance would be invisible at rest and sit next to delete.
- **Keep whole-row drag as a fallback.** Rejected: it reintroduces text-selection
  and accidental-drag problems.
- **Keep HTML5 DnD plus a touch fallback.** Rejected: two divergent gesture paths
  with different threshold, ghost and abort semantics.
- **Keep a per-UI-step ADR.** Rejected: many records for one model buried the durable
  contracts and forced every reader through a supersede chain.
- **Rely on synthetic `dblclick` for touch descriptions.** Rejected: platform
  dependent, and ADR 0032 explicitly rejected double-tap as an edit gesture.
- **Keep a subtle pencil at rest (0.45).** Rejected: one control would stay
  permanently visible in a row that hides the others, defeating the uniform reveal
  rule.

## References

- Dashboard: `src/lib/gui/App.svelte`, `src/lib/gui/dashboard.css`
- Drag: `src/lib/gui/drag-controller.ts`, `src/lib/gui/components/DragHandle.svelte`
- Captions: `src/lib/gui/components/InlineCaption.svelte`
- Settings: `src/lib/core/settings.ts`
- Docs: `docs/architecture/gui.md`
