// ─────────────────────────────────────────────────────────────────────────────
// MARK: Autosave speed — canonical steps + nearest/next mapping
// ─────────────────────────────────────────────────────────────────────────────
// * Three canonical delays drive the rail pill; the persisted value stays
//   `autosaveDelayMs`, so old profiles and imports keep working (ADR 0024).
// * Legacy/custom values stay valid: the pill maps them to the nearest step,
//   and the next click advances from that step.

/** The three pill states, in cycle order. */
export type AutosaveSpeedId = "fast" | "normal" | "slow";

/** One canonical speed step (id drives the i18n label, ms the debounce). */
export interface AutosaveSpeedStep {
    id: AutosaveSpeedId;
    ms: number;
}

/** Canonical cycle order: fast → normal → slow (ADR 0024). */
export const AUTOSAVE_SPEEDS: readonly AutosaveSpeedStep[] = [
    { id: "fast", ms: 1000 },
    { id: "normal", ms: 2000 },
    { id: "slow", ms: 5000 },
];

/**
 * Nearest canonical step for a persisted delay.
 *
 * * Ties prefer the LATER step (1500 → normal, 3500 → slow) — a custom value
 *   in the middle rounds up to the calmer autosave.
 *
 * @param ms - Persisted `autosaveDelayMs` (any normalized value).
 */
export function nearestAutosaveSpeed(ms: number): AutosaveSpeedStep {
    let best = AUTOSAVE_SPEEDS[0];
    for (const step of AUTOSAVE_SPEEDS) {
        if (Math.abs(step.ms - ms) <= Math.abs(best.ms - ms)) best = step;
    }
    return best;
}

/**
 * Delay of the step AFTER the nearest one (slow wraps to fast).
 *
 * @param ms - Persisted `autosaveDelayMs` (any normalized value).
 */
export function nextAutosaveDelay(ms: number): number {
    const current = nearestAutosaveSpeed(ms);
    const index = AUTOSAVE_SPEEDS.indexOf(current);
    return AUTOSAVE_SPEEDS[(index + 1) % AUTOSAVE_SPEEDS.length].ms;
}
