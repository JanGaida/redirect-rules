import { describe, expect, it } from "vitest";

import { ruleHash, type Stats } from "../../core/stats";
import type { SiteRule, UrlRule } from "../../core/settings";
import { buildStatsView, formatStatsTimestamp, ruleRawSummary, ruleSummary } from "../stats-view";

function statsFor(groups: SiteRule[], entries: Array<[number, number, number]>): Stats {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const [siteIndex, ruleIndex, count] of entries) {
        const rule = groups[siteIndex].rules[ruleIndex];
        counts[ruleHash(groups[siteIndex].siteRegex, rule)] = count;
        total += count;
    }
    return { counts, total, last: null };
}

function site(siteRegex: string, rules: UrlRule[], description?: string): SiteRule {
    return { siteRegex, ...(description !== undefined ? { description } : {}), rules };
}

function replace(regex: string, substitution: string): UrlRule {
    return { kind: "replace", regex, substitution };
}

describe("buildStatsView", () => {
    it("groups rules under their site and keeps chain order", () => {
        const groups = [site("/s/", [replace("/b/", "x"), replace("/a/", "x"), replace("/c/", "x")])];
        const view = buildStatsView(
            groups,
            statsFor(groups, [
                [0, 0, 2],
                [0, 1, 5],
                [0, 2, 2],
            ]),
            "en",
        );

        expect(view.ruleGroups).toHaveLength(1);
        expect(view.ruleGroups[0].rules.map((row) => [row.position, row.name])).toEqual([
            [1, "b → x"],
            [2, "a → x"],
            [3, "c → x"],
        ]);
        expect(view.ruleGroups[0].rules.map((row) => row.count)).toEqual([2, 5, 2]);
        expect(view.ruleGroups[0].count).toBe(9);
        expect(view.maxRule).toBe(5);
    });

    it("sorts groups by count, then label", () => {
        const groups = [site("/one/", [replace("/a/", "x")], "One site"), site("/two\\.test/", [replace("/c/", "x")])];
        const view = buildStatsView(
            groups,
            statsFor(groups, [
                [0, 0, 3],
                [1, 0, 7],
            ]),
            "en",
        );

        expect(view.ruleGroups.map((group) => [group.label, group.count, group.ruleCount])).toEqual([
            ["two.test", 7, 1],
            ["One site", 3, 1],
        ]);
        expect(view.perSite).toEqual([
            {
                id: "1",
                label: "two.test",
                raw: "/two\\.test/",
                count: 7,
                ruleCount: 1,
                share: (7 / 10) * 100,
            },
            {
                id: "0",
                label: "One site",
                raw: "/one/",
                count: 3,
                ruleCount: 1,
                share: (3 / 10) * 100,
            },
        ]);
    });

    it("uses the site description and keeps the raw gate for tooltips", () => {
        const groups = [site("/example\\.de/", [replace("/a/", "x")], "  Example site  ")];
        const view = buildStatsView(groups, statsFor(groups, []), "en");

        expect(view.ruleGroups[0].label).toBe("Example site");
        expect(view.ruleGroups[0].raw).toBe("/example\\.de/");
    });

    it("falls back to the readable site gate when no description exists", () => {
        const groups = [site("/example\\.de/", [replace("/a/", "x")])];
        const view = buildStatsView(groups, statsFor(groups, []), "en");

        expect(view.ruleGroups[0].label).toBe("example.de");
        expect(view.ruleGroups[0].raw).toBe("/example\\.de/");
    });

    it("floors card maxima at 1 when no rule has fired", () => {
        const groups = [site("/s/", [replace("/a/", "x")])];
        const view = buildStatsView(groups, statsFor(groups, []), "en");

        expect(view.maxRule).toBe(1);
        expect(view.maxSite).toBe(1);
        expect(view.maxKind).toBe(1);
    });

    it("keeps the fixed kind order and zero rows without configured rules", () => {
        const view = buildStatsView([], { counts: {}, total: 0, last: null }, "en");

        expect(view.byKind.map((row) => row.kind)).toEqual(["replace", "appendQuery", "removeQuery", "checkpoint"]);
        expect(view.byKind.map((row) => row.count)).toEqual([0, 0, 0, 0]);
        expect(view.byKind.map((row) => row.share)).toEqual([0, 0, 0, 0]);
        expect(view.appliedTotal).toBe(0);
        expect(view.activeRules).toBe(0);
        expect(view.zeroRules).toBe(0);
        expect(view.topRules).toEqual([]);
        expect(view.perSite).toEqual([]);
    });

    it("shares kinds against applied hits, not against redirect total", () => {
        const groups = [site("/s/", [replace("/a/", "x"), { kind: "appendQuery", regex: "", params: "a=1" }])];
        const stats: Stats = {
            ...statsFor(groups, [
                [0, 0, 2],
                [0, 1, 1],
            ]),
            total: 10,
        };
        const view = buildStatsView(groups, stats, "en");

        expect(view.appliedTotal).toBe(3);
        expect(view.byKind[0].share).toBeCloseTo(66.67, 1);
        expect(view.byKind[1].share).toBeCloseTo(33.33, 1);
        expect(view.byKind[2].share).toBe(0);
    });

    it("ranks active top rules deterministically and carries site fields", () => {
        const groups = [
            site("/b/", [replace("/z/", "x"), replace("/a/", "x"), replace("/n/", "x")]),
            site("/a/", [replace("/m/", "x")]),
        ];
        const view = buildStatsView(
            groups,
            statsFor(groups, [
                [0, 0, 2],
                [0, 1, 5],
                [0, 2, 0],
                [1, 0, 5],
            ]),
            "en",
        );

        expect(view.appliedTotal).toBe(12);
        expect(view.activeRules).toBe(3);
        expect(view.zeroRules).toBe(1);
        expect(view.topRules.map((row) => row.name)).toEqual(["a → x", "m → x", "z → x"]);
        expect(view.topRules.map((row) => row.siteLabel)).toEqual(["b", "a", "b"]);
        expect(view.topRules.map((row) => row.count)).toEqual([5, 5, 2]);
        expect(view.topRules[0].siteId).toBe("0");
        expect(view.topRules[0].siteRaw).toBe("/b/");
        expect(view.topRules[0].share).toBeCloseTo(41.67, 1);
    });

    it("counts active and zero rules for one site", () => {
        const groups = [site("/s/", [replace("/a/", "x"), replace("/b/", "x"), replace("/c/", "x")])];
        const view = buildStatsView(
            groups,
            statsFor(groups, [
                [0, 0, 3],
                [0, 1, 2],
            ]),
            "en",
        );

        expect(view.appliedTotal).toBe(5);
        expect(view.activeRules).toBe(2);
        expect(view.zeroRules).toBe(1);
    });

    it("groups kinds and shares against the applied-rule total", () => {
        const groups = [
            site("/s/", [
                replace("/a/", "x"),
                { kind: "appendQuery", regex: "", params: "a=1" },
                { kind: "checkpoint", regex: "/go/", mode: "continue" },
            ]),
        ];
        const view = buildStatsView(
            groups,
            statsFor(groups, [
                [0, 0, 2],
                [0, 1, 1],
            ]),
            "en",
        );

        expect(view.byKind.map((row) => [row.kind, row.count])).toEqual([
            ["replace", 2],
            ["appendQuery", 1],
            ["removeQuery", 0],
            ["checkpoint", 0],
        ]);
        expect(view.byKind[0].share).toBeCloseTo(66.67, 1);
        expect(view.byKind[1].share).toBeCloseTo(33.33, 1);
        expect(view.byKind[2].share).toBe(0);
        expect(view.byKind[3].share).toBe(0);
    });

    it("keeps duplicate rules as separate rows (content-hash collision by design)", () => {
        const groups = [site("/s/", [replace("/a/", "x"), replace("/a/", "x")])];
        const view = buildStatsView(groups, statsFor(groups, [[0, 0, 4]]), "en");

        expect(view.ruleGroups[0].rules.map((row) => [row.position, row.count])).toEqual([
            [1, 4],
            [2, 4],
        ]);
    });

    it("carries the append gate and checkpoint mode for the row detail line", () => {
        const groups = [
            site("/s/", [
                { kind: "appendQuery", regex: "/gate/", params: "a=1" },
                { kind: "checkpoint", regex: "/go/", mode: "stop" },
                replace("/a/", "x"),
            ]),
        ];
        const view = buildStatsView(groups, statsFor(groups, []), "en");

        expect(view.ruleGroups[0].rules[0].gate).toBe("gate");
        expect(view.ruleGroups[0].rules[0].mode).toBeUndefined();
        expect(view.ruleGroups[0].rules[1].mode).toBe("stop");
        expect(view.ruleGroups[0].rules[1].gate).toBe("");
        expect(view.ruleGroups[0].rules[2].mode).toBeUndefined();
    });

    it("ignores orphan counter hashes", () => {
        const groups = [site("/s/", [replace("/a/", "x")])];
        const stats: Stats = { counts: { deadbeef: 99 }, total: 99, last: null };

        const view = buildStatsView(groups, stats, "en");

        expect(view.ruleGroups[0].rules[0].count).toBe(0);
        expect(view.byKind[0].count).toBe(0);
    });
});

describe("ruleSummary", () => {
    it("renders readable labels for every rule kind", () => {
        expect(ruleSummary(replace("/a/", "b"))).toBe("a → b");
        expect(ruleSummary(replace("/:\\/\\/example\\.de\\//", "://target.example/"))).toBe(
            "://example.de/ → ://target.example/",
        );
        expect(ruleSummary({ kind: "appendQuery", regex: "", params: "a=1" })).toBe("a=1");
        expect(ruleSummary({ kind: "appendQuery", regex: "/g/", params: "a=1" })).toBe("a=1");
        expect(ruleSummary({ kind: "checkpoint", regex: "/go/", mode: "stop" })).toBe("go");
    });
});

describe("ruleRawSummary", () => {
    it("keeps the raw regex, params and mode for tooltips", () => {
        expect(ruleRawSummary(replace("/a/", "b"))).toBe("/a/ → b");
        expect(ruleRawSummary({ kind: "appendQuery", regex: "", params: "a=1" })).toBe("a=1");
        expect(ruleRawSummary({ kind: "appendQuery", regex: "/g/", params: "a=1" })).toBe("a=1 (/g/)");
        expect(ruleRawSummary({ kind: "checkpoint", regex: "/go/", mode: "stop" })).toBe("/go/ (stop)");
    });
});

describe("formatStatsTimestamp", () => {
    it("formats a valid epoch in the given locale", () => {
        const text = formatStatsTimestamp(Date.UTC(2026, 10, 2, 12, 30), "en");

        expect(text).toContain("2026");
    });

    it("falls back to an em dash for non-finite input", () => {
        expect(formatStatsTimestamp(Number.NaN, "en")).toBe("—");
        expect(formatStatsTimestamp(Number.POSITIVE_INFINITY, "de")).toBe("—");
    });
});
