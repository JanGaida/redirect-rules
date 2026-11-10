# ADR 0024: Autosave speed pill, countdown ring, and save-button removal

- Status: accepted
- Date: 2026-11-02
- Applies to: the dashboard rail footer (`src/lib/gui/components/AutosavePill.svelte`),
  the header indicator (`src/lib/gui/components/AutosaveIndicator.svelte`,
  `src/lib/gui/components/StatusLine.svelte`), the speed mapping
  (`src/lib/gui/autosave-speed.ts`), the root (`src/lib/gui/App.svelte`), the
  styles (`src/lib/gui/dashboard.css`), and the autosave singleton
  (`src/lib/gui/autosave.svelte.ts`), see
  [gui.md](../../architecture/gui.md)

## Context

Autosave used a fixed default debounce of 2000 ms; the only way to change it was
a five-step select buried in the Config tab (0.5 s–10 s). The header carried a
Save button whose only unique job was an immediate flush — Close/ESC already
flushed synchronously before leaving, because GM storage writes are synchronous.
The debounce itself was invisible: a pending save only pulsed the Save button's
border, and that signal disappeared with the button.

The rail footer already held the theme pill (cycle) and the locale pill (popup).
A third quick setting — autosave speed — belonged there, and the pending state
needed a visible countdown rather than a pulsing button.

## Decision

1. **Three canonical speeds in the rail footer.** A stopwatch pill cycles
   `fast (1000 ms) → normal (2000 ms) → slow (5000 ms)`. The persisted field
   stays `autosaveDelayMs` (number, normalized 250–30000 ms), so imports and old
   profiles remain valid; the pill maps legacy/custom values to the nearest step
   (ties prefer the later step) and advances from there.
2. **Config row removed.** The autosave-delay select is deleted from the Config
   tab. The rail pill is the only UI control; import/export can still carry
   arbitrary normalized values.
3. **Save button removed.** Close, ESC, and the native tab-close guard call
   `flush()` — a synchronous GM write under the same fail-safe gate. The
   paused-dirty confirm (invalid regex / empty row) remains. `saveNow()` is
   removed; `flush()` is the single manual/close path.
4. **Countdown ring in the header.** While pending, a small ring in the status
   line fills clockwise from 12 o'clock in the accent color (`--rr-accent`) over
   the active delay. It sits in the SAME leading slot as the success checkmark
   (`✓` after an apply), so loading and receipt never occupy two different
   places. The CSS animation is keyed by `autosave.pendingSeq`, so every change
   (and every speed change) restarts it. Paused shows a full amber ring
   (`--rr-warn`); idle and applied show the checkmark instead. The rail
   stopwatch pill carries NO progress animation — speed and progress are
   separate signals. The ring is functional, not a motion-decoration, and is
   not disabled by the motion setting.
5. **Changes count moves into the pending label.** The old green badge on the
   Save button becomes part of the autosave state: the pending state renders the
   ring plus `saving N changes…` (singular `saving 1 change…`); a settings-only
   change with no row diff falls back to `saving changes…`. There is no separate
   counter span. The applied state shows `✓ saved HH:MM`; paused keeps its own
   text without a count.
6. **Rail layout wraps.** The footer tools keep the 80 px rail (64 px content):
   theme + locale stay on the first row and the stopwatch centers on the second.
   No rail widening.

## Consequences

- One fewer header action; the close path is explicitly the only manual commit
  outside autosave. Users who relied on a separate Save button lose that button
  but keep the same synchronous behavior on Close/ESC.
- Autosave speed is discoverable next to theme/language, and the pending state
  has a continuous visual countdown instead of a pulsing border.
- The rail footer grows by one row; short viewports must still fit the stacked
  tabs/footer (verified at 72 px rail width).
- E2E selectors change: `.rr-save-badge` and the Save button are replaced by
  `.rr-status-pending` (with the row count in its text), `.rr-autosave-toggle`,
  and the header `.rr-status-ring`.
- No settings-schema migration: legacy `autosaveDelayMs` values stay valid and
  snap to a canonical step only on the next pill click.
- `AUTOSAVE_DELAY_MS` remains the default (2000 ms) for normalization and tests.

## References

- [ADR 0020](../0020-multi-dashboard-autosave.md) — debounce/gates/remote sync
- [ADR 0023](0023-dashboard-rail-navigation.md) — rail navigation + footer
- [gui.md](../../architecture/gui.md) — autosave/close sequence
