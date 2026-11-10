// ─────────────────────────────────────────────────────────────────────────────
// MARK: Preview summary URLs — inline-editable Input/Output rows
// ─────────────────────────────────────────────────────────────────────────────
// * Display-only metadata around the engine fields — the rows edit `url` and
//   `testOutputUri` directly.
// * Both rows always render so an empty URL stays editable inline (the body no
//   longer carries the field copies).
// * Spans color the two DISPLAYED values against each other (input → expected
//   output), independent of the test result; the status chip owns pass/fail.

import { diffSpans, plainSpans, type PreviewSpan } from "../core/preview";
import type { PreviewEntry } from "../core/settings";

export interface PreviewSummaryUrlRow {
    key: "input" | "output";
    labelKey: "preview.url" | "preview.testOutput";
    editKey: "preview.url.edit" | "preview.testOutput.edit";
    field: "url" | "testOutputUri";
    value: string;
    /** Colored spans of `value` — empty for an empty value. */
    spans: PreviewSpan[];
}

/**
 * Resolves the inline-editable URL rows shown under the collapsed-row caption.
 *
 * * The diff compares the TRIMMED display values, so it always matches what the
 *   rows show. An empty output means "preview only": no diff, plain input spans.
 *
 * @param entry - The preview entry.
 * @returns The trimmed input row, then the trimmed output row.
 */
export function previewSummaryUrls(entry: PreviewEntry): PreviewSummaryUrlRow[] {
    const input = entry.url.trim();
    const output = entry.testOutputUri.trim();
    const pair = output === "" ? null : diffSpans(input, output);
    return [
        {
            key: "input",
            labelKey: "preview.url",
            editKey: "preview.url.edit",
            field: "url",
            value: input,
            spans: pair?.sourceSpans ?? plainSpans(input),
        },
        {
            key: "output",
            labelKey: "preview.testOutput",
            editKey: "preview.testOutput.edit",
            field: "testOutputUri",
            value: output,
            spans: pair?.targetSpans ?? [],
        },
    ];
}
