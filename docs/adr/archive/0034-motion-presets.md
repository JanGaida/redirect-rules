# ADR 0034: Four canonical motion presets

- Status: superseded by ADR 0016
- Date: 2026-11-03
- Applies to: `src/lib/core/settings.ts`, `src/lib/gui/tabs/SystemTab.svelte`,
  `src/lib/gui/dashboard.css`; see [gui.md](../../architecture/gui.md),
  [settings-storage.md](../../architecture/settings-storage.md)
- Amends: [ADR 0016](../0016-motion-and-animation-strategy.md) decision 2

## Context

The persisted `motion` setting had eight levels (`aus`, `sofort`, `sehrSchnell`,
`schnell`, `normal`, `moderat`, `langsam`, `sehrLangsam`). Three adjacent levels
differed by 20–60 ms, the settings UI presented them as a flat dropdown, and the
labels did not communicate which surfaces actually changed duration. Users could
not make a meaningful choice, and four CSS token blocks existed solely for the
fine granularity.

## Decision

1. **Four presets** are canonical: `aus`, `schnell`, `normal`, `langsam`.
2. **Existing durations stay** for the four presets:

    | Preset    | `--rr-motion-duration-fast` | `--rr-motion-duration-base` |
    | --------- | --------------------------- | --------------------------- |
    | `aus`     | 0 ms                        | 0 ms                        |
    | `schnell` | 100 ms                      | 250 ms                      |
    | `normal`  | 120 ms                      | 500 ms                      |
    | `langsam` | 220 ms                      | 1000 ms                     |

3. **Legacy values migrate silently on load** inside `normalizeMotion()`:
   `sofort`/`sehrSchnell` → `schnell`, `normal`/`moderat` → `normal`,
   `langsam`/`sehrLangsam` → `langsam`. `aus` stays `aus`.
4. **Unknown values warn and fall back to `normal`**; a missing field falls back
   silently (same fail-soft shape as the other enum fields).
5. **The settings UI shows four segments**, not a dropdown. `isMotionLevel`
   remains the strict guard for the four canonical values.

## Consequences

- One-way, intentionally lossy migration: `sehrLangsam` becomes `langsam`,
  `sofort`/`sehrSchnell` become `schnell`. No migration is written back on load.
- Four `[data-motion]` CSS blocks disappear; the remaining blocks keep their
  current token pairs.
- No engine, storage-key, export-format, or autosave change. A `motion` value
  outside the canonical set still normalizes safely on import.
- `prefers-reduced-motion: reduce` continues to win over any preset because those
  rules disable transitions independently of the tokens.

## References

- Motion tokens and transitions: `src/lib/gui/dashboard.css`
- Normalization and defaults: `src/lib/core/settings.ts`
- Settings UI: `src/lib/gui/tabs/SystemTab.svelte`
- Predecessor: [ADR 0016](../0016-motion-and-animation-strategy.md)
