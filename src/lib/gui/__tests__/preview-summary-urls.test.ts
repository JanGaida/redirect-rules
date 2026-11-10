import { describe, expect, it } from "vitest";
import type { PreviewEntry } from "../../core/settings";
import { previewSummaryUrls } from "../preview-summary-urls";

function entry(url: string, testOutputUri = "", description?: string): PreviewEntry {
    return { url, testOutputUri, description };
}

describe("previewSummaryUrls", () => {
    it("always returns the input row before the output row", () => {
        expect(previewSummaryUrls(entry("https://example.de/a", "https://example.de/b"))).toEqual([
            expect.objectContaining({
                key: "input",
                labelKey: "preview.url",
                editKey: "preview.url.edit",
                field: "url",
                value: "https://example.de/a",
            }),
            expect.objectContaining({
                key: "output",
                labelKey: "preview.testOutput",
                editKey: "preview.testOutput.edit",
                field: "testOutputUri",
                value: "https://example.de/b",
            }),
        ]);
    });

    it("keeps empty rows editable instead of hiding them", () => {
        expect(previewSummaryUrls(entry("", ""))).toEqual([
            expect.objectContaining({ key: "input", value: "", spans: [] }),
            expect.objectContaining({ key: "output", value: "", spans: [] }),
        ]);
    });

    it("trims both values before diffing", () => {
        const rows = previewSummaryUrls(entry("  https://example.de/a  ", "  https://example.de/b  "));
        expect(rows.map((row) => row.value)).toEqual(["https://example.de/a", "https://example.de/b"]);
        expect(rows[0].spans.some((span) => span.text.startsWith(" "))).toBe(false);
        expect(rows[1].spans.some((span) => span.text.endsWith(" "))).toBe(false);
    });

    it("colors the input red and the expected output green", () => {
        const [input, output] = previewSummaryUrls(entry("https://example.de/a", "https://example.de/b"));
        expect(input.spans.filter((span) => span.diff === "match").map((span) => span.text)).toEqual(["a"]);
        expect(output.spans.filter((span) => span.diff === "insertion").map((span) => span.text)).toEqual(["b"]);
        expect(input.spans[0]).toEqual({ text: "https://", component: "scheme", diff: null });
    });

    it("keeps the input plain when the output is empty", () => {
        const [input, output] = previewSummaryUrls(entry("https://example.de/a", ""));
        expect(output.spans).toEqual([]);
        expect(input.spans.every((span) => span.diff === null)).toBe(true);
    });

    it("has no diff spans when input and output are identical", () => {
        const rows = previewSummaryUrls(entry("https://example.de/a", "https://example.de/a"));
        expect(rows[0].spans.every((span) => span.diff === null)).toBe(true);
        expect(rows[1].spans.every((span) => span.diff === null)).toBe(true);
    });

    it("diffs an empty input against a set output", () => {
        const [input, output] = previewSummaryUrls(entry("", "https://example.de/b"));
        expect(input.spans).toEqual([]);
        expect(output.spans.some((span) => span.diff === "insertion")).toBe(true);
    });
});
