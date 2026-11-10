# ADR 0016: Motion and animation strategy

- Status: accepted (2026-10-31; amended 2026-11-03 — four canonical presets; consolidated 2026-11-06 — absorbs ADR 0034)
- Date: 2026-10-31
- Applies to: dashboard UI; rules explorer groups and tab panels; the persisted
  `motion` setting; see [gui.md](../architecture/gui.md),
  [settings-storage.md](../architecture/settings-storage.md)
- Consolidates the archived record [0034](archive/0034-motion-presets.md)

## Context

The dashboard is a dense, fold-heavy explorer (site groups, chain steps, manual
sections). Until now all folding is instant, and per-element transitions are
scattered `0.12s` literals. There is no shared motion contract, no reduced-motion
policy, and no reusable tokens. A first animation target was requested for the rules
explorer group fold/unfold.

The persisted `motion` setting originally had eight levels (`aus`, `sofort`,
`sehrSchnell`, `schnell`, `normal`, `moderat`, `langsam`, `sehrLangsam`). Three
adjacent levels differed by 20–60 ms, the settings UI presented them as a flat
dropdown, and the labels did not communicate which surfaces actually changed
duration. Users could not make a meaningful choice, and four CSS token blocks
existed solely for the fine granularity.

## Decision

1. **CSS-only motion.** No JS animation libraries and no transition frameworks.
   State owners (Svelte `$state`, native `<details open>`) remain untouched; CSS
   reacts to the resulting attribute/class changes.
2. **Shared tokens** in `:root`:
    - `--rr-motion-duration-fast: 120ms`
    - `--rr-motion-duration-base: 500ms`
    - `--rr-motion-ease-standard: cubic-bezier(.2, .8, .2, 1)`

    New transitions reference the tokens instead of raw duration literals.

3. **Four canonical presets.** `aus`, `schnell`, `normal` and `langsam` are the only
   canonical motion levels; `isMotionLevel` remains the strict guard. Existing
   durations stay:

    | Preset    | `--rr-motion-duration-fast` | `--rr-motion-duration-base` |
    | --------- | --------------------------- | --------------------------- |
    | `aus`     | 0 ms                        | 0 ms                        |
    | `schnell` | 100 ms                      | 250 ms                      |
    | `normal`  | 120 ms                      | 500 ms                      |
    | `langsam` | 220 ms                      | 1000 ms                     |

    The presets override the root tokens through `!important` in per-`[data-motion]`
    blocks. The Settings tab shows four segments, not a dropdown.

4. **Legacy values migrate silently on load** inside `normalizeMotion()`:
   `sofort`/`sehrSchnell` → `schnell`, `normal`/`moderat` → `normal`,
   `langsam`/`sehrLangsam` → `langsam`; `aus` stays `aus`. Unknown values warn and
   fall back to `normal`; a missing field falls back silently (same fail-soft shape
   as the other enum fields). No migration is written back on load.
5. **Height animation uses `max-height` + opacity** on the `rr-site-shell` wrapper
   (`max-height: 0` closed, `var(--rr-site-h, 12000px)` open; the variable is
   currently not set, so the 12000px fallback applies). Native `<details>` closed
   content is overridden to `display: block` so the wrapper can collapse without
   being removed from the layout. The earlier `interpolate-size`/`height: auto` idea
   was not shipped.
6. **Accessibility guard**: `visibility` toggles with delayed transitions so
   collapsed content is not focusable or announced while visually hidden; it
   becomes visible immediately on open.
7. **Reduced motion**: under `prefers-reduced-motion: reduce` transitions are
   disabled and the content renders instantly. This wins over any preset because
   those rules disable transitions independently of the tokens.
8. **Scope of application**: rules explorer groups
   (`.rr-master > details.rr-master-site`) plus the dashboard tab panels (horizontal
   slide using the fast token). RuleEditor preview cards and chain steps remain
   instant.

## Consequences

- Folding now has a 500 ms max-height + opacity + visibility transition (motion level
  overrides the base token); chevron rotation uses the 120 ms fast duration.
- CSS grows a small animation section plus three root tokens. Four `[data-motion]`
  block pairs collapse into the four canonical presets.
- Future animations should extend the token set rather than inventing new durations.
- The migration is one-way and intentionally lossy: `sehrLangsam` becomes `langsam`,
  `sofort`/`sehrSchnell` become `schnell`. No engine, storage-key, export-format or
  autosave change; a `motion` value outside the canonical set still normalizes safely
  on import.
- Existing E2E accessible-name and visibility expectations should remain valid: toggle
  state changes synchronously, only presentation animates.

## References

- Motion tokens and transitions: `src/lib/gui/dashboard.css`
- Normalization and defaults: `src/lib/core/settings.ts`
- Settings UI: `src/lib/gui/tabs/SystemTab.svelte`
- Docs: `docs/architecture/gui.md`, `docs/architecture/settings-storage.md`
