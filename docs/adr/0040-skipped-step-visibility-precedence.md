# ADR 0040: Skipped-step visibility — persisted global default, per-group override

- Status: accepted (amended 2026-11-07 — backup-boundary rationale)
- Date: 2026-11-04
- Applies to: `src/lib/core/settings.ts`, `src/lib/core/settings-transfer.ts`,
  `src/lib/gui/preview-visibility.svelte.ts`, `src/lib/gui/App.svelte`,
  `src/lib/gui/components/RuleEditor.svelte`, `src/lib/gui/dashboard.css`;
  see [gui.md](../architecture/gui.md), [settings-storage.md](../architecture/settings-storage.md)

## Context

The preview chain renders every authored rule, including skipped steps. The
preview toolbar's eye button toggled them per `RuleEditor` instance, so the
choice was lost on remount and could not be made dashboard-wide. Users wanted
one persistent default plus the ability to inspect skipped steps for a single
group without changing that default.

The rail footer has room for exactly four 28px pills (2×2); a third column does
not fit the 92px rail.

## Decision

1. **Persisted default** `hideSkipped: boolean`, default `false` (show skipped
   steps — the previous behavior). It is a display preference only: no engine,
   preview-derivation, or save-gate semantics.
2. **Global switch** in `.rr-rail-tools` as the fourth pill (row 2, beside the
   autosave pill), toggling the setting through the autosave flow. It renders
   `aria-pressed` and the shared eye/eye-off glyph pair.
3. **Precedence**: `effective = local exception ?? settings.hideSkipped`. A local
   exception always wins, regardless of the global value.
4. **Overrides are session-only**, keyed by `SiteRule` identity, and therefore
   survive group switches but never persist, export, or sync across dashboards.
   A clone starts without an exception; reorder/rename keeps it attached to its
   group.
5. **Reset paths**: flipping the global switch clears every exception; a local
   click that would land on the global value drops its exception instead of
   storing a redundant one. An active exception is indicated non-color-only by
   an accessible-name suffix and a brand outline.
6. **Backup boundary**: `hideSkipped` is excluded from export, import, and the
   merge diff (like `lastSelection`); replace restores the default `false`. A
   persisted display default is not a portable setting: unlike `performanceMode`,
   which changes boot behavior on every page (ADR 0041), it only decides how this
   profile's preview renders, and a restore must not silently flip the receiving
   profile's viewing default.
7. **Checkpoint steps stay visible** in both states — a stopped chain must never
   look like an empty chain.

## Consequences

- Old stored settings normalize to `hideSkipped: false`; no migration is written
  on load and the first autosave persists the field.
- A new Settings field is visible in the transfer coverage guard's `Omit` list,
  so forgetting to exclude a future UI-only field breaks `npm run check`.
- The global switch is rail-only; the Settings tab does not duplicate it.
- Local exceptions are invisible to other dashboards and vanish when a dashboard
  closes — acceptable for a transient inspection aid, and consistent with the
  deliberately unpersisted `ui-state.svelte.ts` chrome.
