import { describe, expect, it } from "vitest";
import { brandIcons } from "../brand-icons";
import { PROVIDERS } from "../providers";

describe("PROVIDERS", () => {
    it("lists nine copy-paste targets", () => {
        expect(PROVIDERS).toHaveLength(9);
    });

    it("uses unique names and https links", () => {
        const names = PROVIDERS.map((provider) => provider.name);
        expect(new Set(names).size).toBe(names.length);
        for (const provider of PROVIDERS) {
            expect(provider.href.startsWith("https://")).toBe(true);
        }
    });

    it("references checked-in brand glyphs", () => {
        for (const provider of PROVIDERS) {
            expect(brandIcons[provider.icon]).toContain("<svg");
        }
    });

    it("keeps Grok out", () => {
        expect(PROVIDERS.some((provider) => /grok/i.test(provider.name))).toBe(false);
    });
});
