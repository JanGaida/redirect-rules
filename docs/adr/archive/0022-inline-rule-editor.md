# ADR 0022: Inline rule editor — the editor dock is removed

- Status: accepted
- Date: 2026-11-02
- Applies to: the rules tab (`src/lib/gui/tabs/RulesTab.svelte`,
  `src/lib/gui/dashboard.css`), see [gui.md](../../architecture/gui.md)
- Supersedes in part: [ADR 0018](../0018-ui-ux-remediation.md) (`.rr-detail` E2E
  contract, narrow-layout dock)

## Context

The RULES tab used a second editing surface below the work area: a full-width
editor dock (`--rr-dock-h`, chrome frame) that rendered
`RuleEditor mode="fields"` for the selected rule. It duplicated context that
already lived in the explorer row (kind chip, rule number, label, clone/delete)
and forced a third grid row plus a second drag grip. Visually it read as a
legacy footer, and its only unique content — the fields — is small enough to
live next to the rule it edits.

Opening a group also auto-selected its first rule purely to feed that dock,
which made "open a group to look at it" mutate the selection and the editor
context.

## Decision

1. **Remove the editor dock.** The `.rr-editor-dock` block, its grid row, the
   horizontal drag grip, the `--rr-dock-h` token and the `a11y.dragDockHeight`
   label are deleted.
2. **Rules unfold inline.** Every rule row is a native `<details>` inside
   `.rr-master-rules`; its summary carries chevron + chips + label +
   RowActions, and unfolding mounts `RuleEditor mode="fields"` in
   `.rr-master-rule-body`.
3. **Selection == open, single-open.** Exactly one rule is unfolded at a time
   (across groups). Unfolding selects it (preview highlight, chat context,
   persisted `lastSelection`); closing clears the selection. A state-driven
   close of another row must not clear the fresh selection.
4. **Opening a group selects nothing.** The group accordion still binds the
   preview, but the rule fold is an explicit second step.
5. **Chain-step click opens the editor.** Clicking a preview step selects the
   rule, unfolds it and scrolls it into view — without stealing focus, so
   keyboard chain navigation keeps working.
6. **New rules open automatically.** "Add rule" and chat import select the new
   rule so the fields are immediately editable.
7. **Two zones at a 50/50 default.** Editor column (explorer + inline editor)
   and preview share the width; the vertical grip still resizes
   `--rr-explorer-w` per session (minimum 420px, because the left column now
   hosts the editor). The status line stays as a full-width bottom row.
8. **The token reference moves to its own FAB + popover** (`TokenReference`),
   left of the chat FAB. It shows the kind-dependent substitution/params tokens
   and toggles the full RegexManual, so the rule fold stays compact. The FAB is
   rendered only while a rule is selected; both popovers share one
   single-popover state (`uiState.popover`), so ESC closes whichever is open.
9. **No height animation for rule folds.** Only the chevron rotates and the
   frame colors use the fast token; ADR 0016's motion scope stays limited to
   site groups and tab panels (autogrowing fields and the manual make a
   max-height tween janky).
10. **Mount the fields editor only for the open rule**, not merely hide it via
    `<details>`. A `fields` instance skips the preview derivation, so closed
    rows cost nothing.

## Consequences

- The `.rr-detail` alias (ADR 0018 consequence) is gone; the e2e spec scopes to
  `.rr-master-rule[open]` and uses `.rr-group-summary` / `.rr-master-rule-summary`
  to avoid nested `<details>` ambiguity.
- `--rr-dock-h`, `.rr-drag-h`, `--rr-chrome-field(-line)` and
  `a11y.dragDockHeight` are removed; the chat FAB keeps its constant 38px
  bottom offset.
- The explorer column is the only editing surface: its minimum width grows from
  260px to 420px, and the rule list loses its 12px indent so the editor gets the
  full column width.
- The site-shell fold cap rises to 12000px so an inline editor plus an open
  RegexManual is never clipped by the CSS-only group animation (ADR 0016).
- Two FABs sit above the status edge (token reference + chat); the token FAB is
  absent without a selected rule. `uiState.popoverOpen` became
  `uiState.popover` (`"chat" | "tokens" | null`), and `RuleEditor` no longer owns
  the tokref/manual state.
- No data-model change: the store, normalize contract, autosave, and preview
  engine are untouched.
