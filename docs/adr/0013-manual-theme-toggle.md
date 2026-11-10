# ADR 0013: Manual theme toggle ships — persisted tri-state (auto/dark/light)

- Status: accepted
- Date: 2026-10-27
- Supersedes: the theme-toggle DEFERRAL in `gui.md` (prototype round A10–A13 evaluated a
  manual toggle and shipped auto-only)

## Context

The restyle port (design A9, 27.10.) deliberately deferred the manual theme toggle: the
shipped CSS applied the light token set via an UNCONDITIONAL `prefers-color-scheme`
media query plus a `data-theme="light"` escape hatch — auto-only by design, and the
prototype header carried a `theme-toggle` pill (`◐ Auto → ☾ Dunkel → ☀ Hell`, hotkey
`T`, prototype R15) that was not ported.

The user decision (2026-10-27, master planning session) reversed the deferral: ALL
prototype elements transfer, and the toggle PERSISTS (not session-only like the
prototype demo, which cycles `data-theme` without storing it).

## Decision

1. **Settings schema**: `theme: "auto" | "dark" | "light"`, default `"auto"` —
   normalized fail-soft like `locale`/`logLevel` (unknown labels keep `"auto"`); it
   persists through the autosave flow (2 s debounce by default, configurable via
   `autosaveDelayMs`), exactly like locale and logLevel. No separate GM key.
2. **CSS tri-state** (prototype selector contract):
    - dark tokens = `:root` default (`data-theme="dark"` and the pre-mount instant
      both resolve here),
    - `:root[data-theme="light"]` = forced light (accent `#1d4ed8`),
    - `@media (prefers-color-scheme: light)` scoped to `:root[data-theme="auto"]`
      (accent `#3561e8` — the prototype's slightly lighter auto-light accent).
      The previously unconditional media block is GONE — a forced `dark` now survives
      a light OS.
3. **Application**: App.svelte `$effect` mirrors `store.settings.theme` onto the
   takeover document's `<html data-theme>` — the dashboard tab's own realm (ADR
   0011), so `document` is the dashboard's. The header pill + the `T` hotkey cycle
   the value; the hotkey is guarded against editable targets (input/textarea/select/
   contentEditable) and modifier keys — the prototype's unguarded `t` handler fires
   while typing, which is a demo bug and not ported.

## Consequences

- Changing the theme schedules an autosave commit (consistent with locale/logLevel
  switches; visual apply is immediate regardless).
- E2E pins the cycle: `data-theme` auto → dark → light + `T` back to auto
  (`dashboard-smoke.spec.ts`).
- The auto-light accent differs from forced-light (`#3561e8` vs `#1d4ed8`) — an
  intentional prototype nuance (R29), not a bug.
- Escaped-theme CSS var defaults (`--rr-chrome-field` tokens) now exist in the DARK
  base too — they were previously only defined in the light blocks, leaving dock
  fields on undefined vars in dark mode.
