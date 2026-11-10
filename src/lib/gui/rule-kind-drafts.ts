// ─────────────────────────────────────────────────────────────────────────────
// MARK: Rule-kind drafts — session-only distinct-field memory
// ─────────────────────────────────────────────────────────────────────────────
// * Kind switch keeps `regex` shared and restores only the distinct field.
// * Drafts are keyed by LIVE rule identity (WeakMap) — reorder/selection safe,
// * never cloned into copies, gone with the rule. Nothing is persisted.
// * Same pattern as preview-visibility (ADR 0040): state lives outside the store.

import type { UrlRule } from "../core/settings";

export type RuleKind = UrlRule["kind"];

/** Distinct authored fields per kind — the regex is shared and never drafted. */
type KindDraft =
    | { kind: "replace"; substitution: string }
    | { kind: "appendQuery"; params: string }
    | { kind: "removeQuery"; keys: string }
    | { kind: "checkpoint"; mode: "continue" | "stop" };

const drafts = new WeakMap<UrlRule, Map<RuleKind, KindDraft>>();

/** Whether a ChoiceGroup string is a known rule kind. */
function isRuleKind(value: string): value is RuleKind {
    return value === "replace" || value === "appendQuery" || value === "removeQuery" || value === "checkpoint";
}

/** Stores the current kind's distinct field; the regex is intentionally skipped. */
function stash(rule: UrlRule): void {
    let bucket = drafts.get(rule);
    if (bucket === undefined) {
        bucket = new Map<RuleKind, KindDraft>();
        drafts.set(rule, bucket);
    }
    if (rule.kind === "replace") bucket.set("replace", { kind: "replace", substitution: rule.substitution });
    else if (rule.kind === "appendQuery") bucket.set("appendQuery", { kind: "appendQuery", params: rule.params });
    else if (rule.kind === "removeQuery") bucket.set("removeQuery", { kind: "removeQuery", keys: rule.keys });
    else bucket.set("checkpoint", { kind: "checkpoint", mode: rule.mode });
}

/** Builds the target shape: current regex plus the restored draft or kind defaults. */
function build(rule: UrlRule, kind: RuleKind, draft: KindDraft | undefined): UrlRule {
    const regex = rule.regex ?? "";
    if (kind === "replace") {
        return { kind, regex, substitution: draft?.kind === "replace" ? draft.substitution : "" };
    }
    if (kind === "appendQuery") {
        return { kind, regex, params: draft?.kind === "appendQuery" ? draft.params : "" };
    }
    if (kind === "removeQuery") {
        return { kind, regex, keys: draft?.kind === "removeQuery" ? draft.keys : "" };
    }
    return { kind, regex, mode: draft?.kind === "checkpoint" ? draft.mode : "continue" };
}

/** Writes `next` onto `target` without replacing the object (draft identity). */
function overwriteInPlace(target: UrlRule, next: UrlRule): void {
    const record = target as unknown as Record<string, unknown>;
    const nextRecord = next as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        if (!(key in nextRecord)) delete record[key];
    }
    Object.assign(record, nextRecord);
}

/**
 * Switches a rule to another kind, restoring that kind's session draft.
 * Mutates in place so the identity-keyed draft survives the switch.
 *
 * @param rule - Live rule object (settings store proxy).
 * @param kind - Raw ChoiceGroup value; unknown values are ignored.
 */
export function switchRuleKind(rule: UrlRule, kind: string): void {
    if (!isRuleKind(kind) || rule.kind === kind) return;
    stash(rule);
    const draft = drafts.get(rule)?.get(kind);
    overwriteInPlace(rule, build(rule, kind, draft));
}
