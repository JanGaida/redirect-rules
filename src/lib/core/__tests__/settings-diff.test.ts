import { describe, expect, it } from "vitest";
import { countChanges } from "../settings-diff";
import { defaultSettings, type Settings, type SiteRule, type UrlRule } from "../settings";

function settings(rules: SiteRule[]): Settings {
    return { ...defaultSettings(), rules };
}

const REPLACE: UrlRule = { kind: "replace", regex: "/a/", substitution: "b" };
const OTHER: UrlRule = { kind: "replace", regex: "/c/", substitution: "d" };

describe("countChanges — row granularity", () => {
    it("reports 0 for identical settings", () => {
        const a = settings([{ siteRegex: "/s/", rules: [REPLACE] }]);
        // * Same CONTENT, different object identity — identity must not count.
        const b = settings([{ siteRegex: "/s/", rules: [{ ...REPLACE }] }]);
        expect(countChanges(a, b)).toBe(0);
    });

    it("counts an added site as 1 (+ its rules as rows)", () => {
        const a = settings([]);
        const b = settings([{ siteRegex: "/s/", rules: [] }]);
        expect(countChanges(a, b)).toBe(1);
        // * The site's rules are added rules — 1 shell + 2 rules = 3.
        const c = settings([{ siteRegex: "/s/", rules: [REPLACE, OTHER] }]);
        expect(countChanges(a, c)).toBe(3);
    });

    it("counts a removed site as 1 (+ its rules as rows)", () => {
        const a = settings([{ siteRegex: "/s/", rules: [REPLACE] }]);
        const b = settings([]);
        expect(countChanges(a, b)).toBe(2);
    });

    it("counts a modified site gate as 1 (rules unchanged)", () => {
        const a = settings([{ siteRegex: "/s/", rules: [REPLACE] }]);
        const b = settings([{ siteRegex: "/t/", rules: [REPLACE] }]);
        expect(countChanges(a, b)).toBe(1);
    });

    it("counts a modified site description as 1 (rules unchanged)", () => {
        const a = settings([{ siteRegex: "/s/", rules: [REPLACE] }]);
        const b = settings([{ siteRegex: "/s/", description: "Label", rules: [REPLACE] }]);
        expect(countChanges(a, b)).toBe(1);
    });

    it("counts a group enable/disable change as 1 (ADR 0038)", () => {
        const a = settings([{ siteRegex: "/s/", rules: [REPLACE] }]);
        const b = settings([{ siteRegex: "/s/", disabled: true, rules: [REPLACE] }]);
        expect(countChanges(a, b)).toBe(1);
        expect(countChanges(b, a)).toBe(1);
    });

    it("treats an absent and an empty description as equal", () => {
        const a = settings([{ siteRegex: "/s/", rules: [REPLACE] }]);
        const b = settings([{ siteRegex: "/s/", description: "", rules: [REPLACE] }]);
        expect(countChanges(a, b)).toBe(0);
    });

    it("counts each added/removed/modified rule as 1", () => {
        const base = settings([{ siteRegex: "/s/", rules: [REPLACE] }]);
        // * Modified rule.
        expect(countChanges(base, settings([{ siteRegex: "/s/", rules: [OTHER] }]))).toBe(1);
        // * Added rule.
        expect(countChanges(base, settings([{ siteRegex: "/s/", rules: [REPLACE, OTHER] }]))).toBe(1);
        // * Removed rule.
        expect(countChanges(base, settings([{ siteRegex: "/s/", rules: [] }]))).toBe(1);
    });

    it("sums site-gate + rule changes independently (2 total)", () => {
        const a = settings([{ siteRegex: "/s/", rules: [REPLACE] }]);
        const b = settings([{ siteRegex: "/t/", rules: [OTHER] }]);
        expect(countChanges(a, b)).toBe(2);
    });

    it("counts a two-rule swap as 2 (ordered compare, no LCS — documented)", () => {
        const a = settings([{ siteRegex: "/s/", rules: [REPLACE, OTHER] }]);
        const b = settings([{ siteRegex: "/s/", rules: [OTHER, REPLACE] }]);
        expect(countChanges(a, b)).toBe(2);
    });

    it("ignores non-rules settings fields (locale/logLevel/theme are not rows)", () => {
        const a = settings([{ siteRegex: "/s/", rules: [REPLACE] }]);
        const b = { ...a, locale: "de" as const, theme: "dark" as const };
        expect(countChanges(a, b)).toBe(0);
    });
});
