// ─────────────────────────────────────────────────────────────────────────────
// MARK: JSON download — Blob URL helper for the transfer dialog
// ─────────────────────────────────────────────────────────────────────────────

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
 * Triggers a JSON download via a Blob object URL.
 *
 * @param filename - Download name.
 * @param data - JSON-serializable payload.
 */
export function downloadJson(filename: string, data: unknown): void {
    const blob = new Blob([JSON.stringify(data, null, 4)], { type: "application/json" });
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
