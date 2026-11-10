// ─────────────────────────────────────────────────────────────────────────────
// MARK: Preview caption — description-only test-case label
// ─────────────────────────────────────────────────────────────────────────────
// * Display-only: the engine never reads this label.
// * The URLs have their own inline-editable summary rows, so the caption never
//   falls back to them (that would show the input URL twice).

import type { PreviewEntry } from "../core/settings";

/**
 * Resolves the collapsed-row caption for one preview test case.
 *
 * @param entry - The preview entry.
 * @returns Trimmed description, else "—".
 */
export function previewCaption(entry: PreviewEntry): string {
    const description = entry.description?.trim() ?? "";
    return description !== "" ? description : "—";
}
