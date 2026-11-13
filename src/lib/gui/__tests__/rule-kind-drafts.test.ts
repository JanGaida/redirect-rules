import { describe, expect, it } from "vitest";
import type { UrlRule } from "../../core/settings";
import { switchRuleKind } from "../rule-kind-drafts";

function replaceRule(): UrlRule {
    return { kind: "replace", regex: "/old/", substitution: "new" };
}

function appendQueryRule(): UrlRule {
    return { kind: "appendQuery", regex: "/gate/", params: "a=1" };
}

describe("rule-kind session drafts", () => {
    it("restores the replace substitution after a round trip", () => {
        const rule = replaceRule();
        switchRuleKind(rule, "appendQuery");
        expect(rule.kind).toBe("appendQuery");
        switchRuleKind(rule, "replace");
        expect(rule).toEqual({ kind: "replace", regex: "/old/", substitution: "new" });
    });

    it("restores appendQuery params and checkpoint mode", () => {
        const rule = appendQueryRule();
        switchRuleKind(rule, "checkpoint");
        if (rule.kind === "checkpoint") rule.mode = "stop";
        switchRuleKind(rule, "appendQuery");
        expect(rule).toEqual({ kind: "appendQuery", regex: "/gate/", params: "a=1" });
        switchRuleKind(rule, "checkpoint");
        expect(rule).toEqual({ kind: "checkpoint", regex: "/gate/", mode: "stop" });
    });

    it("restores removeQuery keys after a round trip", () => {
        const rule: UrlRule = { kind: "removeQuery", regex: "/gate/", keys: "utm_*" };
        switchRuleKind(rule, "checkpoint");
        switchRuleKind(rule, "removeQuery");
        expect(rule).toEqual({ kind: "removeQuery", regex: "/gate/", keys: "utm_*" });
    });

    it("starts a first-time removeQuery with an empty keys string", () => {
        const rule = replaceRule();
        switchRuleKind(rule, "removeQuery");
        expect(rule).toEqual({ kind: "removeQuery", regex: "/old/", keys: "" });
    });

    it("starts a first-time kind with the existing defaults", () => {
        const rule = replaceRule();
        switchRuleKind(rule, "appendQuery");
        expect(rule).toEqual({ kind: "appendQuery", regex: "/old/", params: "" });
        switchRuleKind(rule, "checkpoint");
        expect(rule).toEqual({ kind: "checkpoint", regex: "/old/", mode: "continue" });
    });

    it("carries the current regex over and keeps edits made in the new kind", () => {
        const rule = replaceRule();
        switchRuleKind(rule, "appendQuery");
        if (rule.kind === "appendQuery") rule.regex = "/edited/";
        switchRuleKind(rule, "replace");
        expect(rule).toEqual({ kind: "replace", regex: "/edited/", substitution: "new" });
    });

    it("mutates in place so the draft identity survives", () => {
        const rule = replaceRule();
        const before = rule;
        switchRuleKind(rule, "checkpoint");
        expect(rule).toBe(before);
    });

    it("drops distinct fields the target kind does not own", () => {
        const rule = replaceRule();
        switchRuleKind(rule, "appendQuery");
        expect("substitution" in rule).toBe(false);
        switchRuleKind(rule, "checkpoint");
        expect("params" in rule).toBe(false);
        switchRuleKind(rule, "replace");
        expect("mode" in rule).toBe(false);
        expect(JSON.parse(JSON.stringify(rule))).toEqual({ kind: "replace", regex: "/old/", substitution: "new" });
    });

    it("switches to unwrap without a distinct field and carries the regex", () => {
        const rule = replaceRule();
        switchRuleKind(rule, "unwrap");
        expect(rule).toEqual({ kind: "unwrap", regex: "/old/" });
        if (rule.kind === "unwrap") rule.regex = "/u=([^&]+)/";
        switchRuleKind(rule, "replace");
        expect(rule).toEqual({ kind: "replace", regex: "/u=([^&]+)/", substitution: "new" });
        switchRuleKind(rule, "unwrap");
        expect(rule).toEqual({ kind: "unwrap", regex: "/u=([^&]+)/" });
    });

    it("does not leak drafts into identical rules or clones", () => {
        const rule = replaceRule();
        switchRuleKind(rule, "appendQuery");
        const clone: UrlRule = { ...rule };
        const twin: UrlRule = { kind: "appendQuery", regex: "/old/", params: "" };

        switchRuleKind(clone, "replace");
        switchRuleKind(twin, "replace");
        expect(clone).toEqual({ kind: "replace", regex: "/old/", substitution: "" });
        expect(twin).toEqual({ kind: "replace", regex: "/old/", substitution: "" });

        switchRuleKind(rule, "replace");
        expect(rule).toEqual({ kind: "replace", regex: "/old/", substitution: "new" });
    });

    it("ignores the current kind and unknown values", () => {
        const rule = replaceRule();
        switchRuleKind(rule, "replace");
        expect(rule).toEqual({ kind: "replace", regex: "/old/", substitution: "new" });
        switchRuleKind(rule, "bogus");
        expect(rule).toEqual({ kind: "replace", regex: "/old/", substitution: "new" });
    });
});
