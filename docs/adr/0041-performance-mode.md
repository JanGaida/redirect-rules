# ADR 0041: Performance mode — stats-off and non-destructive silent logging

- Status: accepted
- Date: 2026-11-05
- Applies to: `src/lib/core/settings.ts`, `src/lib/core/log.ts`, `src/main.ts`,
  `src/lib/gui/dashboard.ts`, `src/lib/gui/tabs/SystemTab.svelte`,
  `src/lib/gui/tabs/StatsTab.svelte`, `src/lib/gui/App.svelte`,
  `src/lib/core/settings-transfer.ts`;
  see [settings-storage.md](../architecture/settings-storage.md),
  [stats.md](../architecture/stats.md), [gui.md](../architecture/gui.md)

## Context

Every issued redirect performs a stats read-modify-write against GM storage and
stashes a pending delta in `window.name`; logging emits a console line per
applied rule. Users who want the redirect engine without either cost had no
single switch, and turning stats off would otherwise make the Stats tab look
broken. Three-way `optimized | accurate | custom` presets were rejected earlier:
they implied an accuracy trade-off that does not exist and would silently
override explicit settings.

## Decision

1. **One persisted boolean** `performanceMode`, default `false`. It is a
   preference, not statistics data, and it is included in backup export, import,
   merge, and replace (`SETTINGS_FIELDS`). Unlike `hideSkipped` (ADR 0040), it is
   not UI-only: it reconfigures the boot of every page context, so excluding it
   from a backup would make a restore silently re-enable recording.
2. **Stats gating at the boot wiring**, not inside the sink: `src/main.ts` passes
   `undefined` to `startWatcher` when the mode is on. `createWatcher` already
   treats the sink as optional, so this also skips the per-redirect GM write and
   the `window.name` stash. `stats.ts` keeps its existing contract.
3. **Non-destructive silent logging**: `effectiveLogLevel(settings)` derives
   `performanceMode ? "silent" : logLevel`. The stored `logLevel` is never
   overwritten, so turning the mode off restores the user's choice. The Settings
   tab disables the log-level control with an explanatory hint while the mode is
   on.
4. **Boot-scoped effect**: normal page boots read settings once, so the mode
   applies to new page loads. Already-running tabs keep recording until reload;
   there is no live settings listener. The dashboard applies the effective level
   immediately so its own console is silent.
5. **Stats-tab banner**: while on, a warning-toned banner above the hero explains that
   new page loads stop counting and open pages continue until reload, and offers
   a link-styled button that switches to the Settings tab. Existing counters
   stay visible and untouched.
6. **Data recovery is unconditional**: `drainPendingStats()` still runs at boot,
   so a delta stashed by a failed write before the mode was enabled is not lost.
   `flush` and `prune` are unchanged.

## Consequences

- Stored settings without the field normalize to `false`; no migration is
  written on load and the first autosave persists the field.
- Backups written before this feature are partial imports: merge keeps the
  current value, Replace stays unavailable because the file is incomplete. No
  compatibility fallback is added to `isFullAndValid`; the strict transfer
  contract is deliberate.
- Running tabs and the opener are not reconfigured; the dashboard applies the
  mode to its own context, including imported settings.
- The Stats tab never clears or hides counters, so a frozen value is explained
  rather than presented as a defect.
- Adding the field to `SETTINGS_FIELDS` keeps the `MissingSettingsField`
  compile-time coverage guard at `true`.
