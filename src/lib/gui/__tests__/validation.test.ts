import { describe, expect, it } from "vitest";

import { ruleProblem } from "../../core/rule-policy";
import { defaultSettings, type Settings, type SiteRule, type UrlRule } from "../../core/settings";
import {
    invalidRegexCount,
    isSiteIncomplete,
    isSitePersistBlocked,
    pruneEmptyRows,
    siteHasInvalidRegex,
} from "../validation";

const REPLACE: UrlRule = { kind: "replace", regex: "/a/", substitution: "b" };
const BAD_RULE: UrlRule = { kind: "replace", regex: "/[unclosed/", substitution: "" };

function site(siteRegex: string, rules: UrlRule[] = [REPLACE]): SiteRule {
    return { siteRegex, rules };
}

function settings(rules: SiteRule[]): Settings {
    return { ...defaultSettings(), rules };
}

describe("siteHasInvalidRegex", () => {
    it("accepts a valid gate with valid rules", () => {
        expect(siteHasInvalidRegex(site("/x\\.test/"))).toBe(false);
    });

    it("flags an invalid gate", () => {
        expect(siteHasInvalidRegex(site("/[unclosed/"))).toBe(true);
    });

    it("flags an invalid rule regex", () => {
        expect(siteHasInvalidRegex(site("/x\\.test/", [REPLACE, BAD_RULE]))).toBe(true);
    });

    it("ignores an empty gate", () => {
        expect(siteHasInvalidRegex(site(""))).toBe(false);
    });

    it("ignores empty regexes on appendQuery, removeQuery and checkpoint rules", () => {
        expect(siteHasInvalidRegex(site("/x\\.test/", [{ kind: "appendQuery", params: "a=1" }]))).toBe(false);
        expect(siteHasInvalidRegex(site("/x\\.test/", [{ kind: "removeQuery", keys: "a" }]))).toBe(false);
        expect(siteHasInvalidRegex(site("/x\\.test/", [{ kind: "checkpoint", regex: "", mode: "continue" }]))).toBe(
            false,
        );
    });
});

describe("isSiteIncomplete", () => {
    it("flags an empty gate", () => {
        expect(isSiteIncomplete(site(""))).toBe(true);
    });

    it("flags one empty rule among valid ones", () => {
        const empty: UrlRule = { kind: "replace", regex: "", substitution: "" };
        expect(isSiteIncomplete(site("/x\\.test/", [REPLACE, empty]))).toBe(true);
    });

    it("flags a gated group with zero rules (prune would delete it)", () => {
        expect(isSiteIncomplete(site("/x\\.test/", []))).toBe(true);
    });

    it("does not treat an invalid non-empty gate as incomplete", () => {
        expect(isSiteIncomplete(site("/[unclosed/"))).toBe(false);
    });

    it("accepts a complete, valid group", () => {
        expect(isSiteIncomplete(site("/x\\.test/"))).toBe(false);
    });

    it("flags a substitution-only replace (engine drops it)", () => {
        const rule: UrlRule = { kind: "replace", regex: "", substitution: "x" };
        expect(ruleProblem(rule)).not.toBeNull();
        expect(isSiteIncomplete(site("/x\\.test/", [rule]))).toBe(true);
    });

    it("flags a gate-only appendQuery (engine no-op)", () => {
        const rule: UrlRule = { kind: "appendQuery", regex: "/gate/", params: "" };
        expect(ruleProblem(rule)).not.toBeNull();
        expect(isSiteIncomplete(site("/x\\.test/", [rule]))).toBe(true);
    });

    it("flags a gate-only removeQuery (engine no-op)", () => {
        const rule: UrlRule = { kind: "removeQuery", regex: "/gate/", keys: "" };
        expect(ruleProblem(rule)).not.toBeNull();
        expect(isSiteIncomplete(site("/x\\.test/", [rule]))).toBe(true);
    });

    it("accepts a replace with a non-empty regex and empty substitution (deletes the match)", () => {
        const rule: UrlRule = { kind: "replace", regex: "/delete-me/", substitution: "" };
        expect(ruleProblem(rule)).toBeNull();
        expect(isSiteIncomplete(site("/x\\.test/", [rule]))).toBe(false);
    });
});

describe("isSitePersistBlocked", () => {
    it("blocks an empty gate", () => {
        expect(isSitePersistBlocked(site(""))).toBe(true);
    });

    it("blocks an invalid gate", () => {
        expect(isSitePersistBlocked(site("/[unclosed/"))).toBe(true);
    });

    it("blocks an empty rule", () => {
        const empty: UrlRule = { kind: "replace", regex: "", substitution: "" };
        expect(isSitePersistBlocked(site("/x\\.test/", [empty]))).toBe(true);
    });

    it("blocks a gated group with zero rules", () => {
        expect(isSitePersistBlocked(site("/x\\.test/", []))).toBe(true);
    });

    it("blocks an invalid rule regex", () => {
        expect(isSitePersistBlocked(site("/x\\.test/", [BAD_RULE]))).toBe(true);
    });

    it("allows a complete, valid group", () => {
        expect(isSitePersistBlocked(site("/x\\.test/"))).toBe(false);
    });

    it("never blocks a disabled group (emergency switch, ADR 0038)", () => {
        expect(isSitePersistBlocked({ ...site(""), disabled: true })).toBe(false);
        expect(isSitePersistBlocked({ ...site("/x\\.test/", [BAD_RULE]), disabled: true })).toBe(false);
    });
});

describe("invalidRegexCount", () => {
    it("counts invalid gates and invalid rule regexes together", () => {
        const current = settings([site("/[bad-gate/"), site("/x\\.test/", [REPLACE, BAD_RULE]), site("/y\\.test/")]);
        expect(invalidRegexCount(current)).toBe(2);
    });

    it("ignores disabled groups", () => {
        const current = settings([{ ...site("/[bad-gate/"), disabled: true }]);
        expect(invalidRegexCount(current)).toBe(0);
    });
});

describe("pruneEmptyRows", () => {
    it("keeps empty disabled groups and their empty rules (parked drafts)", () => {
        const empty: UrlRule = { kind: "replace", regex: "", substitution: "" };
        const current = settings([
            { siteRegex: "", disabled: true, rules: [empty] },
            { siteRegex: "/keep\\.test/", rules: [REPLACE] },
        ]);
        pruneEmptyRows(current);
        expect(current.rules).toHaveLength(2);
        expect(current.rules[0].disabled).toBe(true);
        expect(current.rules[0].rules).toEqual([empty]);
    });

    it("keeps partially filled rows (autosave blocks them before pruning)", () => {
        const substitutionOnly: UrlRule = { kind: "replace", regex: "", substitution: "x" };
        const gateOnly: UrlRule = { kind: "appendQuery", regex: "/gate/", params: "" };
        const current = settings([{ siteRegex: "/keep\\.test/", rules: [substitutionOnly, gateOnly] }]);
        pruneEmptyRows(current);
        expect(current.rules[0].rules).toEqual([substitutionOnly, gateOnly]);
    });
});
