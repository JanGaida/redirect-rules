// ─────────────────────────────────────────────────────────────────────────────
// MARK: Motion — FLIP duration from the motion preset
// ─────────────────────────────────────────────────────────────────────────────
// * Mirrors the `--rr-motion-duration-fast` values in `dashboard.css`; the map is
//   pinned to the CSS by `motion.test.ts` — change both files together.
// * ! A computed-style read with `parseInt(...) || 120` turned the `aus` preset's
//   `0ms` into 120 ms; the explicit map keeps zero.
// * ! The OS reduced-motion preference wins over the preset: JS FLIP must stop
//   too, not only the CSS transitions.

import type { MotionLevel } from "../core/settings";

/** FLIP duration (ms) per motion preset — mirrors `:root[data-motion]` fast tokens. */
export const MOTION_FAST_MS: Record<MotionLevel, number> = {
    aus: 0,
    schnell: 100,
    normal: 120,
    langsam: 220,
};

/** Fallback for a hand-edited value that escaped normalization. */
const FALLBACK_FAST_MS = 120;

/** Whether the OS asks for reduced motion (guarded for non-browser test runs). */
function prefersReducedMotion(): boolean {
    return (
        typeof globalThis.matchMedia === "function" && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

/**
 * Returns the fast FLIP duration for a motion preset.
 *
 * @param motion - The normalized settings motion level.
 */
export function motionFastDuration(motion: MotionLevel): number {
    if (prefersReducedMotion()) return 0;
    const value = MOTION_FAST_MS[motion];
    return typeof value === "number" ? value : FALLBACK_FAST_MS;
}
