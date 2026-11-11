// ─────────────────────────────────────────────────────────────────────────────
// MARK: Caption edit gesture — own click-pair window
// ─────────────────────────────────────────────────────────────────────────────
// * Native `dblclick` follows the OS interval (~500 ms) — too tight for a
//   deliberate edit gesture, so the caption counts its own click pair.
// * Inclusive window: a second click AT the limit still counts.

/** Click-pair window for the caption edit overlay (ms). */
export const CAPTION_EDIT_CLICK_MS = 800;

/**
 * True when the click at `now` completes a pair that started at `lastAt`.
 *
 * * `null` means "no pending click" (first click, or a consumed pair).
 * * A backwards clock (delta < 0) never pairs — the caller passes
 *   `performance.now()`, so this only guards a stale stored value.
 *
 * @param lastAt - Timestamp of the previous caption click.
 * @param now - Timestamp of the current caption click.
 * @returns `true` when both clicks belong to one edit gesture.
 */
export function isCaptionEditClick(lastAt: number | null, now: number): boolean {
    if (lastAt === null) return false;
    const delta = now - lastAt;
    return delta >= 0 && delta <= CAPTION_EDIT_CLICK_MS;
}
