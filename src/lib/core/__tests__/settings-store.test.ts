import { installGmStubs, uninstallGmStubs } from "./gm-stubs";

// ! The store singleton loads settings AT IMPORT TIME ($state initializer calls
//   loadSettings) — the GM stubs must exist BEFORE the store module is imported,
//   hence the top-level install + dynamic import.
installGmStubs();
const { store } = await import("../../stores/settings.svelte");

import { afterAll, describe, expect, it } from "vitest";
import { EXAMPLE_RULES } from "../settings";
import { parseRegex } from "../parse-regex";
import { STORAGE_KEY } from "../storage";

afterAll(() => {
    uninstallGmStubs();
});

/** Resets the store to a clean saved state between tests (the singleton persists). */
function resetStore(): void {
    store.replace({ locale: "en", rules: [] });
    store.save();
}

describe("settings store", () => {
    it("boots with defaults (first boot writes them)", () => {
        // * ADR 0003 amendment: the first-boot defaults SHIP the example rules.
        expect(store.settings.rules).toEqual(EXAMPLE_RULES);
        expect(store.dirty).toBe(false);
    });

    it("site-rule CRUD: add, move (clamped), clone (deep), remove", () => {
        resetStore();
        store.addSiteRule();
        store.addSiteRule();
        store.settings.rules[0].siteRegex = "/a\\.test/";
        store.settings.rules[1].siteRegex = "/b\\.test/";
        store.settings.rules[1].description = "Beta";

        store.moveSiteRule(1, -1);
        expect(store.settings.rules.map((s) => s.siteRegex)).toEqual(["/b\\.test/", "/a\\.test/"]);
        store.moveSiteRule(0, -1); // * clamped — no wrap-around
        expect(store.settings.rules.map((s) => s.siteRegex)).toEqual(["/b\\.test/", "/a\\.test/"]);

        store.cloneSiteRule(0);
        expect(store.settings.rules).toHaveLength(3);
        expect(store.settings.rules[1].siteRegex).toBe("/b\\.test/");
        expect(store.settings.rules[1].description).toBe("Beta");
        // * deep clone: mutating the copy leaves the original alone
        store.settings.rules[1].siteRegex = "/c\\.test/";
        expect(store.settings.rules[0].siteRegex).toBe("/b\\.test/");

        store.removeSiteRule(0);
        expect(store.settings.rules.map((s) => s.siteRegex)).toEqual(["/c\\.test/", "/a\\.test/"]);

        resetStore();
    });

    it("group toggle: sparse flag is set/removed and cloned", () => {
        resetStore();
        store.addSiteRule();
        store.settings.rules[0].siteRegex = "/a\\.test/";

        store.toggleSiteEnabled(0);
        expect(store.settings.rules[0].disabled).toBe(true);
        store.cloneSiteRule(0);
        expect(store.settings.rules[1].disabled).toBe(true);

        store.toggleSiteEnabled(0);
        expect("disabled" in store.settings.rules[0]).toBe(false);

        resetStore();
    });

    it("save() keeps an empty disabled group (parked draft)", () => {
        resetStore();
        store.addSiteRule();
        store.settings.rules[0].disabled = true;

        store.save();
        expect(store.settings.rules).toHaveLength(1);
        expect(store.settings.rules[0].disabled).toBe(true);

        resetStore();
    });

    it("rule CRUD within a site rule: add, move (clamped), clone, remove", () => {
        resetStore();
        store.addSiteRule();
        const si = 0;
        store.addRule(si);
        store.addRule(si);
        store.settings.rules[si].rules[0] = { kind: "replace", regex: "/1/", substitution: "a" };
        store.settings.rules[si].rules[1] = { kind: "appendQuery", params: "x=1" };

        store.moveRule(si, 1, -1);
        expect(store.settings.rules[si].rules[0].kind).toBe("appendQuery");
        store.moveRule(si, 0, -1); // * clamped
        expect(store.settings.rules[si].rules[0].kind).toBe("appendQuery");

        store.cloneRule(si, 0);
        expect(store.settings.rules[si].rules).toHaveLength(3);
        expect(store.settings.rules[si].rules[1]).toEqual({ kind: "appendQuery", params: "x=1" });

        store.removeRule(si, 2);
        expect(store.settings.rules[si].rules).toHaveLength(2);

        resetStore();
    });

    it("insert-after-delete restores the original index and clamps (ADR 0039)", () => {
        resetStore();
        store.addSiteRule();
        store.addSiteRule();
        store.settings.rules[0].siteRegex = "/a\\.test/";
        store.settings.rules[1].siteRegex = "/b\\.test/";
        const removedSite = store.settings.rules[0];
        store.removeSiteRule(0);

        // * Preferred index far beyond the list length clamps to the end.
        expect(store.insertSiteRule(99, removedSite)).toBe(1);
        expect(store.settings.rules.map((s) => s.siteRegex)).toEqual(["/b\\.test/", "/a\\.test/"]);

        const si = 1;
        store.addRule(si);
        store.settings.rules[si].rules[0] = { kind: "replace", regex: "/1/", substitution: "a" };
        const removedRule = store.settings.rules[si].rules[0];
        store.removeRule(si, 0);
        expect(store.insertRule(si, 0, removedRule)).toBe(0);
        expect(store.settings.rules[si].rules[0]).toEqual(removedRule);
        expect(store.insertRule(99, 0, removedRule)).toBe(-1);

        const entry = { url: "https://a.test/", testOutputUri: "https://b.test/" };
        store.settings.rules[si].previewEntries = [entry];
        store.removePreviewEntry(si, 0);
        expect(store.insertPreviewEntry(si, 0, entry)).toBe(0);
        expect(store.settings.rules[si].previewEntries).toEqual([entry]);
        expect(store.insertPreviewEntry(99, 0, entry)).toBe(-1);

        resetStore();
    });

    it("dirty tracking: mutation flips dirty, save resets it", () => {
        resetStore();
        expect(store.dirty).toBe(false);
        store.addSiteRule();
        expect(store.dirty).toBe(true);
        store.save();
        // * save() prunes the empty row — the persisted + working state agree.
        expect(store.dirty).toBe(false);
        expect(store.settings.rules).toEqual([]);
    });

    it("a failed GM write keeps the state dirty; a later save recovers", () => {
        resetStore();
        store.addSiteRule();
        store.settings.rules[0].siteRegex = "/a\\.test/";
        store.addRule(0);
        store.settings.rules[0].rules[0] = { kind: "replace", regex: "/old/", substitution: "/new/" };

        const gmSetValue = (globalThis as Record<string, unknown>).GM_setValue as (key: string, value: unknown) => void;
        (globalThis as Record<string, unknown>).GM_setValue = () => {
            throw new Error("quota exceeded");
        };
        try {
            expect(store.save()).toBe(false);
            expect(store.dirty).toBe(true);
        } finally {
            (globalThis as Record<string, unknown>).GM_setValue = gmSetValue;
        }

        expect(store.save()).toBe(true);
        expect(store.dirty).toBe(false);

        resetStore();
    });

    it("save() prunes entirely-empty rows and empty site groups (legacy parity)", () => {
        resetStore();
        store.addSiteRule(); // * site rule left entirely empty
        store.addSiteRule();
        store.settings.rules[1].siteRegex = "/keep\\.test/";
        store.addRule(1);
        store.addRule(1);
        // * rule 0: replace with BOTH fields empty → dropped
        // * rule 1: appendQuery with params + no gate → kept
        store.settings.rules[1].rules[1] = { kind: "appendQuery", params: "a=1" };

        store.save();
        expect(store.settings.rules).toEqual([
            {
                siteRegex: "/keep\\.test/",
                previewEntries: [{ url: "", testOutputUri: "" }],
                rules: [{ kind: "appendQuery", params: "a=1" }],
            },
        ]);

        const gmGetValue = (globalThis as Record<string, unknown>).GM_getValue as (
            key: string,
            def: unknown,
        ) => unknown;
        const persisted = gmGetValue(STORAGE_KEY, null);
        expect(persisted).toEqual(store.settings);
    });

    it("appendImportedRules appends normalized rules and returns object refs", () => {
        resetStore();
        store.addSiteRule();
        store.settings.rules[0].siteRegex = "/a\\.test/";

        const created = store.appendImportedRules(0, [
            { kind: "replace", regex: "/x/", substitution: "y" },
            { kind: "appendQuery", params: "k=v" },
        ]);

        expect(store.settings.rules[0].rules).toHaveLength(2);
        expect(created).toHaveLength(2);
        expect(created[0].rule).toEqual({ kind: "replace", regex: "/x/", substitution: "y" });
        expect(store.settings.rules[0].rules.includes(created[0].rule)).toBe(true);
        expect(store.settings.rules[0].rules.includes(created[1].rule)).toBe(true);

        // * Missing parent group is a no-op, never a throw.
        expect(store.appendImportedRules(99, [{ kind: "appendQuery", params: "k=v" }])).toEqual([]);

        resetStore();
    });

    it("appendImportedRules carries verification entries with the imported rules", () => {
        resetStore();
        store.addSiteRule();
        store.settings.rules[0].siteRegex = "/a\\.test/";
        store.settings.rules[0].previewEntries = [{ url: "https://a.test/old", testOutputUri: "" }];

        const created = store.appendImportedRules(
            0,
            [{ kind: "replace", regex: "/x/", substitution: "y" }],
            [{ url: "https://a.test/x", testOutputUri: "https://a.test/y", description: "replace" }],
        );

        expect(created).toHaveLength(1);
        expect(store.settings.rules[0].previewEntries).toEqual([
            { url: "https://a.test/old", testOutputUri: "" },
            { url: "https://a.test/x", testOutputUri: "https://a.test/y", description: "replace" },
        ]);

        resetStore();
    });

    it("appendImportedRules drops verification entries when no rule was imported", () => {
        resetStore();
        store.addSiteRule();
        store.settings.rules[0].siteRegex = "/a\\.test/";

        store.appendImportedRules(0, [], [{ url: "https://a.test/x", testOutputUri: "", description: "replace" }]);

        expect(store.settings.rules[0].previewEntries).toEqual([{ url: "", testOutputUri: "" }]);

        resetStore();
    });

    it("createSiteRuleWithRules creates a group and returns stored refs", () => {
        resetStore();
        const created = store.createSiteRuleWithRules("/b\\.test/", [
            { kind: "replace", regex: "/x/", substitution: "y" },
        ]);

        expect(store.settings.rules).toHaveLength(1);
        expect(store.settings.rules[0].siteRegex).toBe("/b\\.test/");
        expect(store.settings.rules[0].previewEntries).toEqual([{ url: "", testOutputUri: "" }]);
        expect(created).toHaveLength(1);
        expect(store.settings.rules[0].rules.includes(created[0].rule)).toBe(true);
        // * The group ref resolves too — "Open in Rules" relies on it.
        expect(store.settings.rules.includes(created[0].site)).toBe(true);

        resetStore();
    });

    it("createSiteRuleWithRules seeds the group with verified test cases", () => {
        resetStore();
        store.createSiteRuleWithRules(
            "/b\\.test/",
            [{ kind: "replace", regex: "/x/", substitution: "y" }],
            [{ url: "https://b.test/x", testOutputUri: "https://b.test/y", description: "replace" }],
        );

        expect(store.settings.rules[0].previewEntries).toEqual([
            { url: "https://b.test/x", testOutputUri: "https://b.test/y", description: "replace" },
        ]);

        resetStore();
    });

    it("replace() normalizes fail-soft before assignment", () => {
        resetStore();
        store.replace({ locale: "de", rules: [{ siteRegex: "/ok\\.test/", rules: ["garbage"] }] });
        expect(store.settings.locale).toBe("de");
        expect(store.settings.rules).toEqual([{ siteRegex: "/ok\\.test/", rules: [], previewEntries: [] }]);
        expect(store.dirty).toBe(true);

        store.replace("total garbage");
        // * Unusuable input degrades to DEFAULTS — which now carry the example
        // rule list (ADR 0003 amendment), not an empty list.
        expect(store.settings.rules).toEqual(EXAMPLE_RULES);
        expect(store.dirty).toBe(true);

        resetStore();
    });

    it("generation increments on whole-tree replacement only", () => {
        resetStore();
        const start = store.generation;

        // * Ordinary mutations never bump the generation.
        store.addSiteRule();
        store.settings.rules[0].siteRegex = "/a\\.test/";
        store.addRule(0);
        expect(store.generation).toBe(start);

        store.replace({ locale: "en", rules: [] });
        expect(store.generation).toBe(start + 1);

        store.reloadRemote({ locale: "en", rules: [] });
        expect(store.generation).toBe(start + 2);

        // * A plain mutation after the swaps still does not bump it.
        store.addSiteRule();
        expect(store.generation).toBe(start + 2);

        resetStore();
    });

    it("replacementSource tracks undo vs external swaps", () => {
        resetStore();
        // * resetStore() uses a default replace → external.
        expect(store.replacementSource).toBe("external");

        store.replace({ locale: "en", rules: [] }, { source: "undo" });
        expect(store.replacementSource).toBe("undo");

        store.replace({ locale: "en", rules: [] });
        expect(store.replacementSource).toBe("external");

        // * Remote adoption is never an undo source.
        store.replace({ locale: "en", rules: [] }, { source: "undo" });
        store.reloadRemote({ locale: "en", rules: [] });
        expect(store.replacementSource).toBe("external");

        resetStore();
    });

    it("create-rule prefill gate is an anchored authority match", () => {
        resetStore();
        const indexes = store.addSiteRuleFromUrl("https://github.com/user/repo");
        expect(indexes).toEqual({ siteIndex: 0, ruleIndex: 0 });

        const gate = parseRegex(store.settings.rules[0].siteRegex);
        expect(gate.test("https://github.com/x")).toBe(true);
        expect(gate.test("https://github.com:443/x")).toBe(true);
        expect(gate.test("https://user@github.com/x")).toBe(true);

        expect(gate.test("https://evil.test/?next=github.com")).toBe(false);
        expect(gate.test("https://evil.test/github.com")).toBe(false);
        expect(gate.test("https://github.com.evil.test/")).toBe(false);
        expect(gate.test("https://sub.github.com/")).toBe(false);

        resetStore();
    });
});
