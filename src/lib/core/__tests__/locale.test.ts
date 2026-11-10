import { afterEach, describe, expect, it, vi } from "vitest";
import { detectLocale } from "../locale";

// * detectLocale is environment-dependent when the real navigator leaks through
//   (node ≥ 24 exposes one) — every case stubs the navigator explicitly.
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("detectLocale", () => {
    it("detects de from the primary navigator.languages entry", () => {
        vi.stubGlobal("navigator", { languages: ["de-DE", "en-US"], language: "de-DE" });
        expect(detectLocale()).toBe("de");
    });

    it("falls back to navigator.language when languages is empty", () => {
        vi.stubGlobal("navigator", { languages: [], language: "de-AT" });
        expect(detectLocale()).toBe("de");
    });

    it("returns en for a non-de primary locale", () => {
        vi.stubGlobal("navigator", { languages: ["fr-FR", "de-DE"], language: "fr-FR" });
        expect(detectLocale()).toBe("en");
    });

    it("matches the de prefix case-insensitively", () => {
        vi.stubGlobal("navigator", { languages: ["DE-de"], language: "DE-de" });
        expect(detectLocale()).toBe("de");
    });

    it("returns en when navigator access throws (sandbox)", () => {
        vi.stubGlobal("navigator", undefined);
        expect(detectLocale()).toBe("en");
    });
});
