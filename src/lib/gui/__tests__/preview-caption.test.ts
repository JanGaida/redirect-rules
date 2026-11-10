import { describe, expect, it } from "vitest";
import type { PreviewEntry } from "../../core/settings";
import { previewCaption } from "../preview-caption";

function entry(url: string, testOutputUri = "", description?: string): PreviewEntry {
    return { url, testOutputUri, description };
}

describe("previewCaption", () => {
    it("prefers a trimmed description", () => {
        expect(previewCaption(entry("https://example.de/a", "", "  Docs redirect  "))).toBe("Docs redirect");
    });

    it("falls back to the dash placeholder instead of the URL", () => {
        expect(previewCaption(entry("https://example.de/a"))).toBe("—");
        expect(previewCaption(entry("  https://example.de/a  ", "", "   "))).toBe("—");
        expect(previewCaption(entry("https://example.de/a", "", ""))).toBe("—");
    });
});
