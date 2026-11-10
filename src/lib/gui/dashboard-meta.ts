// ─────────────────────────────────────────────────────────────────────────────
// MARK: Dashboard viewport meta (takeover document)
// ─────────────────────────────────────────────────────────────────────────────
// * The takeover boot wipes `<html>` (ADR 0011), which also removes the host
//   stub's viewport meta. Without it tablets fall back to the ~980px layout
//   viewport and the dashboard renders zoomed-out.
// * Idempotent: updates an existing meta instead of stacking duplicates.
// * Never `user-scalable=no` — pinch zoom stays available (WCAG 1.4.4).

/** Zoom-left content for the dashboard's own viewport. */
const VIEWPORT_CONTENT = "width=device-width, initial-scale=1";

/** Ensures exactly one device-width viewport meta in `doc`. */
export function ensureViewportMeta(doc: Document): void {
    const head = doc.head;
    if (!head) return;
    const existing = head.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const meta = existing ?? doc.createElement("meta");
    if (!existing) {
        meta.name = "viewport";
        head.appendChild(meta);
    }
    if (meta.getAttribute("content") !== VIEWPORT_CONTENT) meta.setAttribute("content", VIEWPORT_CONTENT);
}
