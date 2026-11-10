# ADR 0023: Dashboard rail navigation and header status

- Status: accepted (amended 2026-11-02 by ADR 0024 — rail stopwatch pill, no save button; amended 2026-11-02 by ADR 0025 — drag-lock pill moved to the rail footer; amended 2026-11-02 by ADR 0029 — drag-lock pill removed)
- Date: 2026-11-02
- Applies to: the dashboard root (`src/lib/gui/App.svelte`,
  `src/lib/gui/dashboard.css`, `src/lib/gui/components/StatusLine.svelte`) and
  the RulesTab grid (`src/lib/gui/tabs/RulesTab.svelte`), see
  [gui.md](../../architecture/gui.md)

## Context

The dashboard navigation lived in the header as a centered tab strip, next to a
theme pill and the DEV/HMR chips. The status line was duplicated: the RULES tab
rendered it as its own grid row and App rendered it as a bottom strip for the
other tabs. Locale switching required opening the Config tab, and the locally
iterated topbar prototype series settled on variant 02a ("Rail Classic"): a
vertical rail with the utilities in the rail footer. The header middle was
blocked by the tab strip, which made the status line and the brand compete for
space.

## Decision

1. **Vertical rail navigation.** The header tabs become a left rail (80px;
   72px at ≤760px): caption, four vertical tabs (Rules, Stats, Info, Config),
   a spacer, and a footer with theme pill, locale pill, autosave-speed pill, and
   version. There is **no rail counter**.
2. **Header = brand + status + actions.** The header keeps the app icon, the
   title, and the actions in the prototype order (refresh → undo → drag lock →
   close; the Save button was removed by ADR 0024). The drag lock remains in the
   header and is only rendered on the Rules tab. The header keeps the
   `--rr-chrome` window-frame surface.
3. **Status line in the header.** `StatusLine` renders exactly once, as the
   middle header segment (ready + shape + autosave phase + conflict). The
   RulesTab status row and the App bottom strip are removed. The rules grid is
   one row; `--rr-chat-fab-bottom` drops from 38px to 16px.
4. **Locale popup with Auto.** The locale pill shows the resolved language
   (`DE`/`EN`) and opens a small `role="group"` popup with Auto / English /
   Deutsch. Auto remains selectable; selecting an option persists through the
   autosave flow and relabels the dashboard immediately via `t()`.
5. **Theme stays tri-state.** The rail theme pill keeps ADR 0013's
   `auto → dark → light` cycle and the `T` hotkey.
6. **Dev chips in the rail footer.** DEV and HMR (and any future disclaimer
   chips) stack vertically in the rail footer instead of the header.
7. **Vertical panel slide.** Tab panels animate with `translateY` so the content
   follows the vertical rail; `prefers-reduced-motion` disables the transition.
8. **E2E contracts stay stable.** `.rr-theme-toggle` remains the theme pill and
   `.rr-status` remains the status line; tab selectors keep using roles.

## Consequences

- The header is relieved of navigation and gains a stable status segment that is
  visible on every tab.
- Locale switching no longer requires a detour through the Config tab while Auto
  remains available.
- The rail footer carries utility chrome; the rail becomes the single place for
  navigation and quick settings.
- The rules grid loses its status row and the FABs move closer to the bottom
  edge; the E2E locators remain valid.
- No settings or data migration is needed: `locale` and `theme` keep their types
  and persistence.
