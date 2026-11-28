import { describe, expect, it } from "vitest";

import { isRuleEmpty, isRuleIncomplete, ruleProblem, ruleRegexInvalid } from "../rule-policy";
import type { UrlRule } from "../settings";

const REPLACE_VALID: UrlRule = { kind: "replace", regex: "/a/", substitution: "b" };
const REPLACE_EMPTY: UrlRule = { kind: "replace", regex: "", substitution: "" };
const CHECKPOINT_VALID: UrlRule = { kind: "checkpoint", regex: "/a/", mode: "continue" };
const UNWRAP_VALID: UrlRule = { kind: "unwrap", regex: "/a/" };

describe("isRuleEmpty", () => {
    it("treats a fully blank replace rule as empty", () => {
        expect(isRuleEmpty(REPLACE_EMPTY)).toBe(true);
    });

    it("keeps partially authored rules", () => {
        expect(isRuleEmpty({ kind: "replace", regex: "", substitution: "b" })).toBe(false);
        expect(isRuleEmpty({ kind: "replace", regex: "/a/", substitution: "" })).toBe(false);
    });

    it("treats regex-less checkpoint and unwrap rules as empty", () => {
        expect(isRuleEmpty({ kind: "checkpoint", regex: "", mode: "stop" })).toBe(true);
        expect(isRuleEmpty(CHECKPOINT_VALID)).toBe(false);
        expect(isRuleEmpty({ kind: "unwrap", regex: "" })).toBe(true);
        expect(isRuleEmpty(UNWRAP_VALID)).toBe(false);
    });

    it("treats a key-less removeQuery rule without gate as empty", () => {
        expect(isRuleEmpty({ kind: "removeQuery", keys: "" })).toBe(true);
        expect(isRuleEmpty({ kind: "removeQuery", keys: "", regex: "" })).toBe(true);
        expect(isRuleEmpty({ kind: "removeQuery", keys: "", regex: "/a/" })).toBe(false);
        expect(isRuleEmpty({ kind: "removeQuery", keys: "utm_source" })).toBe(false);
    });

    it("treats a param-less appendQuery rule without gate as empty", () => {
        expect(isRuleEmpty({ kind: "appendQuery", params: "" })).toBe(true);
        expect(isRuleEmpty({ kind: "appendQuery", params: "", regex: "" })).toBe(true);
        expect(isRuleEmpty({ kind: "appendQuery", params: "", regex: "/a/" })).toBe(false);
        expect(isRuleEmpty({ kind: "appendQuery", params: "a=1" })).toBe(false);
    });
});

describe("isRuleIncomplete", () => {
    it("flags a substitution-only replace rule", () => {
        expect(isRuleIncomplete({ kind: "replace", regex: "", substitution: "b" })).toBe(true);
        expect(isRuleIncomplete(REPLACE_VALID)).toBe(false);
    });

    it("flags regex-less checkpoint and unwrap rules", () => {
        expect(isRuleIncomplete({ kind: "checkpoint", regex: "", mode: "continue" })).toBe(true);
        expect(isRuleIncomplete(CHECKPOINT_VALID)).toBe(false);
        expect(isRuleIncomplete({ kind: "unwrap", regex: "" })).toBe(true);
        expect(isRuleIncomplete(UNWRAP_VALID)).toBe(false);
    });

    it("flags key-less and param-less gate-only rules", () => {
        expect(isRuleIncomplete({ kind: "removeQuery", keys: "" })).toBe(true);
        expect(isRuleIncomplete({ kind: "removeQuery", keys: "", regex: "/a/" })).toBe(true);
        expect(isRuleIncomplete({ kind: "removeQuery", keys: "utm_source" })).toBe(false);
        expect(isRuleIncomplete({ kind: "appendQuery", params: "" })).toBe(true);
        expect(isRuleIncomplete({ kind: "appendQuery", params: "", regex: "/a/" })).toBe(true);
        expect(isRuleIncomplete({ kind: "appendQuery", params: "a=1" })).toBe(false);
    });
});

describe("ruleRegexInvalid", () => {
    it("treats an empty regex as valid (nothing to compile)", () => {
        expect(ruleRegexInvalid(REPLACE_EMPTY)).toBe(false);
        expect(ruleRegexInvalid({ kind: "checkpoint", regex: "", mode: "stop" })).toBe(false);
        expect(ruleRegexInvalid({ kind: "unwrap", regex: "" })).toBe(false);
        expect(ruleRegexInvalid({ kind: "appendQuery", params: "a=1" })).toBe(false);
        expect(ruleRegexInvalid({ kind: "removeQuery", keys: "a" })).toBe(false);
    });

    it("flags a non-empty regex that does not compile", () => {
        expect(ruleRegexInvalid({ kind: "replace", regex: "/(/", substitution: "b" })).toBe(true);
        expect(ruleRegexInvalid({ kind: "checkpoint", regex: "/(/", mode: "stop" })).toBe(true);
        expect(ruleRegexInvalid({ kind: "unwrap", regex: "/(/" })).toBe(true);
        expect(ruleRegexInvalid({ kind: "appendQuery", params: "a=1", regex: "/(/" })).toBe(true);
        expect(ruleRegexInvalid({ kind: "removeQuery", keys: "a", regex: "/(/" })).toBe(true);
    });

    it("accepts a compiling regex in notation and literal form", () => {
        expect(ruleRegexInvalid(REPLACE_VALID)).toBe(false);
        expect(ruleRegexInvalid({ kind: "replace", regex: "plain-literal", substitution: "b" })).toBe(false);
    });
});

describe("ruleProblem", () => {
    it("returns null for a usable rule", () => {
        expect(ruleProblem(REPLACE_VALID)).toBeNull();
        expect(ruleProblem({ kind: "appendQuery", params: "a=1" })).toBeNull();
    });

    it("reports empty before regex (incomplete wins)", () => {
        expect(ruleProblem({ kind: "appendQuery", params: "", regex: "/(/" })).toBe("empty");
        expect(ruleProblem({ kind: "removeQuery", keys: "", regex: "/(/" })).toBe("empty");
        expect(ruleProblem(REPLACE_EMPTY)).toBe("empty");
    });

    it("reports a broken regex on a complete rule", () => {
        expect(ruleProblem({ kind: "replace", regex: "/(/", substitution: "b" })).toBe("regex");
        expect(ruleProblem({ kind: "checkpoint", regex: "/(/", mode: "stop" })).toBe("regex");
    });
});
