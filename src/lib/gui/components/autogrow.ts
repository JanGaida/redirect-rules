// ─────────────────────────────────────────────────────────────────────────────
// MARK: autogrow — Svelte action for progressive textarea height
// ─────────────────────────────────────────────────────────────────────────────
// * Height follows content with NO cap; the explorer column is the only scroll
//   container — the scrollbar never sits inside a field.
// * No ResizeObserver BY DESIGN: inline height pins the box, so a font change
//   cannot resize it; `change` (blur) covers residual cases.
// * Future: `field-sizing: content` (Chromium-only; revisit when baseline).

/**
 * Grows a textarea to fit its content — attach as `use:autogrow`.
 *
 * @param node - The textarea to grow (height set inline, `resize` stays CSS-controlled).
 */
export function autogrow(node: HTMLTextAreaElement): { destroy(): void } {
    const grow = (): void => {
        node.style.height = "auto";
        node.style.height = `${node.scrollHeight}px`;
    };

    node.addEventListener("input", grow);
    node.addEventListener("change", grow);
    grow();

    return {
        destroy(): void {
            node.removeEventListener("input", grow);
            node.removeEventListener("change", grow);
        },
    };
}
