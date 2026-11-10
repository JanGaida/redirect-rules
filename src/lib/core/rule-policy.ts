// ─────────────────────────────────────────────────────────────────────────────
// MARK: Rule policy — single source for emptiness/incompleteness/regex
// ─────────────────────────────────────────────────────────────────────────────
// * Mirrors the engine: a replace/checkpoint with an empty regex is dropped and
//   an appendQuery with empty params is a no-op.
// * `isRuleEmpty` = ENTIRELY empty (prune-on-save drops these).
// * `isRuleIncomplete` = NOT usable by the engine (blocks persistence/import):
//   substitution-only replace and gate-only appendQuery count as incomplete.

import { isValidRegex } from "./parse-regex";
import type { UrlRule } from "./settings";

/** Why a rule cannot be persisted/imported. */
export type RuleProblem = "empty" | "regex";

/**
 * Whether a rule is entirely empty — prune-on-save drops it.
 *
 * @param rule - The rule to test.
 */
export function isRuleEmpty(rule: UrlRule): boolean {
    if (rule.kind === "replace") return rule.regex === "" && rule.substitution === "";
    if (rule.kind === "checkpoint") return rule.regex === "";
    if (rule.kind === "removeQuery") return rule.keys === "" && !rule.regex;
    return rule.params === "" && !rule.regex;
}

/**
 * Whether the engine cannot use the rule — blocks persistence/import.
 *
 * * Substitution-only replace: the engine drops it (empty regex).
 * * Gate-only appendQuery: the engine treats it as a no-op (empty params).
 *
 * @param rule - The rule to test.
 */
export function isRuleIncomplete(rule: UrlRule): boolean {
    if (rule.kind === "replace") return rule.regex === "";
    if (rule.kind === "checkpoint") return rule.regex === "";
    if (rule.kind === "removeQuery") return rule.keys === "";
    return rule.params === "";
}

/**
 * Whether a NON-EMPTY regex fails to compile.
 *
 * @param rule - The rule to test.
 */
export function ruleRegexInvalid(rule: UrlRule): boolean {
    const regex = rule.kind === "replace" ? rule.regex : (rule.regex ?? "");
    return regex !== "" && !isValidRegex(regex);
}

/**
 * The single rule-validity policy shared by GUI validation and transfer.
 *
 * @param rule - The rule to test.
 */
export function ruleProblem(rule: UrlRule): RuleProblem | null {
    if (isRuleIncomplete(rule)) return "empty";
    if (ruleRegexInvalid(rule)) return "regex";
    return null;
}
