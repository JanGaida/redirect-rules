// ─────────────────────────────────────────────────────────────────────────────
// MARK: Clipboard — best-effort text copy in the dashboard context
// ─────────────────────────────────────────────────────────────────────────────
// * Priority chain: GM_setClipboard (Tampermonkey,
//   works in the takeover tab — its own context with GM access, ADR 0011) →
//   async navigator.clipboard → execCommand fallback on the caller's node.
// * The GM API is synchronous fire-and-forget — no result signal; treat it as
//   success (Tampermonkey owns the failure UX there).

/**
 * Copies text to the clipboard — never throws blindly: the execCommand
 * fallback is the last resort and its failure rejects (caller decides whether
 * that is worth surfacing).
 *
 * @param text             - The text to copy.
 * @param fallbackNode - The textarea to select() for the execCommand path.
 */
export async function copyToClipboard(text: string, fallbackNode?: HTMLTextAreaElement): Promise<void> {
    if (typeof GM_setClipboard === "function") {
        GM_setClipboard(text);
        return;
    }
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    if (fallbackNode) {
        fallbackNode.select();
        if (!document.execCommand("copy")) throw new Error("execCommand copy failed");
        fallbackNode.setSelectionRange(0, 0);
        return;
    }
    throw new Error("no clipboard API available");
}
