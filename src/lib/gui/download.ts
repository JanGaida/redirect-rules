// ─────────────────────────────────────────────────────────────────────────────
// MARK: JSON download — GM_download first, Blob URL fallback
// ─────────────────────────────────────────────────────────────────────────────
// * ! The dashboard host stub (raw.githubusercontent.com) ships
// *   `Content-Security-Policy: ...; sandbox` — a sandboxed document silently
// *   drops `<a download>` blob downloads (the Blob URL degrades to
// *   `blob:null/...`). The export therefore goes through GM_download, which
// *   runs in the userscript manager and is exempt from the page CSP.
// * The Blob anchor stays as the dev/browser fallback (no GM API there).

import { createLogger } from "../core/log";

const log = createLogger("transfer");

/** Local `YYYYMMDD-HHmm` stamp for file names. */
function stamp(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
        date.getMinutes(),
    )}`;
}

/**
 * File name for a transfer export.
 *
 * @param kind - Partial (selective) or full backup.
 * @param date - Timestamp source (test seam).
 */
export function exportFilename(kind: "partial" | "full", date = new Date()): string {
    const base = kind === "full" ? "redirect-rules-backup" : "redirect-rules-export";
    return `${base}-${stamp(date)}.json`;
}

/**
 * Triggers a JSON download via the userscript manager, Blob fallback.
 *
 * @param filename - Download name.
 * @param data - JSON-serializable payload.
 */
export function downloadJson(filename: string, data: unknown): void {
    const text = JSON.stringify(data, null, 4);
    if (typeof GM_download === "function") {
        try {
            // * Data URL — self-contained; the sandbox's blob:null URL is not
            //   resolvable outside the opaque-origin document.
            const url = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
            GM_download({
                url,
                name: filename,
                saveAs: false,
                onerror: (error) => log.warn("GM_download failed", { filename, error: String(error) }),
            });
            return;
        } catch (error) {
            log.warn("GM_download threw — falling back to Blob download", { filename, error: String(error) });
        }
    }
    downloadViaBlob(filename, text);
}

/** Legacy Blob-anchor download — works only outside a sandboxed document. */
function downloadViaBlob(filename: string, text: string): void {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // * Revoke after the click task — some browsers cancel an immediate revoke.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
