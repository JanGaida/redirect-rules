import { describe, expect, it } from "vitest";
import type { SiteRule } from "../../core/settings";
import { siteCaption } from "../site-caption";

function site(siteRegex: string, description?: string): SiteRule {
    return { siteRegex, rules: [], description };
}

describe("siteCaption", () => {
    it("prefers a trimmed description", () => {
        expect(siteCaption(site("/example\\.de/", "  Example site  "))).toBe("Example site");
    });

    it("falls back to the readable regex when the description is absent or blank", () => {
        expect(siteCaption(site("/example\\.de/"))).toBe("example.de");
        expect(siteCaption(site("/example\\.de/", "   "))).toBe("example.de");
        expect(siteCaption(site("/example\\.de/", ""))).toBe("example.de");
    });

    it("passes non-notation literals through unchanged", () => {
        expect(siteCaption(site("example.de"))).toBe("example.de");
    });

    it("renders an empty gate as the placeholder dash", () => {
        expect(siteCaption(site(""))).toBe("—");
    });
});
