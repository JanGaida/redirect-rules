// ─────────────────────────────────────────────────────────────────────────────
// MARK: Redirect engine — rule compilation + PURE URL application
// ─────────────────────────────────────────────────────────────────────────────
// * ADR 0001: `applyRules` is pure string transformation — no DOM, storage, or
//   navigation; the watcher owns every side effect.
// * Legacy parity: sequential single pass; each matched group contributes its
//   rules in order, each applied to the previous result.
// * Fail-soft compile: an invalid regex skips its rule with a log line.

import {
    isSiteEnabled,
    type AppendQueryRule,
    type CheckpointRule,
    type ReplaceRule,
    type RemoveQueryRule,
    type SiteRule,
    type UnwrapRule,
    type UrlRule,
} from "./settings";
import { parseRegex, stripGlobalFlag, stripStickyFlag } from "./parse-regex";
import { appendQueryParams, removeQueryParams } from "./append-query";
import { unwrapTarget } from "./unwrap-url";
import { querySurface } from "./decode-surface";
import { createLogger, isDebugEnabled } from "./log";

const log = createLogger("engine");

// ─── Compiled shapes ──────────────────────────────────────────────────────────

/** A compiled `replace` rule — `replaceRe` keeps `g` (replace-all); sticky `y` is stripped. */
interface CompiledReplace {
    kind: "replace";
    source: ReplaceRule;
    /** Authored index within the owning site group. */
    ruleIndex: number;
    replaceRe: RegExp;
}

/** A compiled `appendQuery` rule — `gateRe` is global-stripped (stateless `.test()`). */
interface CompiledAppendQuery {
    kind: "appendQuery";
    source: AppendQueryRule;
    /** Authored index within the owning site group. */
    ruleIndex: number;
    gateRe: RegExp | null;
    params: string;
}

/** A compiled `removeQuery` rule — `gateRe` is global-stripped (stateless `.test()`). */
interface CompiledRemoveQuery {
    kind: "removeQuery";
    source: RemoveQueryRule;
    /** Authored index within the owning site group. */
    ruleIndex: number;
    gateRe: RegExp | null;
    keys: string;
}

/** A compiled `checkpoint` rule — `checkpointRe` is global-stripped (stateless `.test()`). */
interface CompiledCheckpoint {
    kind: "checkpoint";
    source: CheckpointRule;
    /** Authored index within the owning site group. */
    ruleIndex: number;
    checkpointRe: RegExp;
}

/** A compiled `unwrap` rule — `unwrapRe` is global-stripped (stateless `.exec()`). */
interface CompiledUnwrap {
    kind: "unwrap";
    source: UnwrapRule;
    /** Authored index within the owning site group. */
    ruleIndex: number;
    unwrapRe: RegExp;
}

export type CompiledRule =
    CompiledReplace | CompiledAppendQuery | CompiledRemoveQuery | CompiledCheckpoint | CompiledUnwrap;

/** A compiled site rule — `gateRe` is global-stripped (stateless `.test()`). */
export interface CompiledSiteRule {
    source: SiteRule;
    gateRe: RegExp;
    rules: CompiledRule[];
}

/** Record of one applied rule (old/new URL pair) — returned for logging + tests. */
export interface AppliedRule {
    siteRegex: string;
    rule: UrlRule;
    oldUrl: string;
    newUrl: string;
}

/** Result of applying all rules to one URL. */
export interface ApplyResult {
    /** The rewritten URL (identical to the input when nothing matched). */
    url: string;
    /** Whether any rule changed the URL. */
    changed: boolean;
    /** Every applied rule, in application order. */
    applied: AppliedRule[];
}

/** Why one compiled step ended where it did — engine/preview shared vocabulary. */
export type StepReason =
    "applied" | "unchanged" | "no-match" | "gate-no-match" | "checkpoint-continue" | "checkpoint-stopped";

/** One compiled step's outcome — the single sequence truth for engine + preview. */
export interface RuleStepOutcome {
    rule: CompiledRule;
    /** Authored index within the owning site group. */
    ruleIndex: number;
    oldUrl: string;
    newUrl: string;
    changed: boolean;
    reason: StepReason;
}

/** One group replay: gate result, ordered outcomes, final URL, abort state. */
export interface GroupExecution {
    gateMatched: boolean;
    /** Outcomes up to (and including) the first aborting checkpoint. */
    steps: RuleStepOutcome[];
    finalUrl: string;
    aborted: boolean;
}

// ─── Compilation (fail-soft) ─────────────────────────────────────────────────

/**
 * Compiles site rules into testable shape — invalid regexes SKIP their rule.
 *
 * Every skip is logged at error level (the rule author must see WHY a rule is
 * dead); the rest of the ruleset keeps working.
 *
 * @param siteRules - The settings rule list.
 * @param options   - `includeDisabled` compiles off groups too (preview only).
 * @returns Compiled rules — site rules with unusable gates/rules dropped.
 */
export function compileRules(siteRules: SiteRule[], options: { includeDisabled?: boolean } = {}): CompiledSiteRule[] {
    const compiled: CompiledSiteRule[] = [];
    let disabled = 0;
    let dropped = 0;

    for (const siteRule of siteRules) {
        if (!isSiteEnabled(siteRule) && options.includeDisabled !== true) {
            disabled += 1;
            log.debug("skipping site rule — disabled", { siteRegex: siteRule.siteRegex });
            continue;
        }
        if (siteRule.siteRegex === "") {
            dropped += 1;
            log.error("skipping site rule — empty siteRegex", { siteRegex: "" });
            continue;
        }

        let gateRe: RegExp;
        try {
            gateRe = stripGlobalFlag(parseRegex(siteRule.siteRegex));
        } catch (e) {
            dropped += 1;
            log.error("skipping site rule — invalid siteRegex", {
                siteRegex: siteRule.siteRegex,
                error: String(e),
            });
            continue;
        }

        const rules: CompiledRule[] = [];
        for (let ruleIndex = 0; ruleIndex < siteRule.rules.length; ruleIndex++) {
            const rule = siteRule.rules[ruleIndex];
            try {
                if (rule.kind === "replace") {
                    if (rule.regex === "") {
                        dropped += 1;
                        log.error("skipping replace rule — empty regex", {
                            siteRegex: siteRule.siteRegex,
                            rule,
                        });
                        continue;
                    }
                    rules.push({
                        kind: "replace",
                        source: rule,
                        ruleIndex,
                        replaceRe: stripStickyFlag(parseRegex(rule.regex)),
                    });
                } else if (rule.kind === "appendQuery") {
                    const gateRe2 = rule.regex ? stripGlobalFlag(parseRegex(rule.regex)) : null;
                    rules.push({
                        kind: "appendQuery",
                        source: rule,
                        ruleIndex,
                        gateRe: gateRe2,
                        params: rule.params,
                    });
                } else if (rule.kind === "removeQuery") {
                    const gateRe3 = rule.regex ? stripGlobalFlag(parseRegex(rule.regex)) : null;
                    rules.push({
                        kind: "removeQuery",
                        source: rule,
                        ruleIndex,
                        gateRe: gateRe3,
                        keys: rule.keys,
                    });
                } else if (rule.kind === "unwrap") {
                    if (rule.regex === "") {
                        dropped += 1;
                        log.error("skipping unwrap rule — empty regex", {
                            siteRegex: siteRule.siteRegex,
                            rule,
                        });
                        continue;
                    }
                    rules.push({
                        kind: "unwrap",
                        source: rule,
                        ruleIndex,
                        unwrapRe: stripGlobalFlag(parseRegex(rule.regex)),
                    });
                } else {
                    if (rule.regex === "") {
                        dropped += 1;
                        log.error("skipping checkpoint rule — empty regex", {
                            siteRegex: siteRule.siteRegex,
                            rule,
                        });
                        continue;
                    }
                    rules.push({
                        kind: "checkpoint",
                        source: rule,
                        ruleIndex,
                        checkpointRe: stripGlobalFlag(parseRegex(rule.regex)),
                    });
                }
            } catch (e) {
                dropped += 1;
                log.error("skipping url rule — invalid regex", {
                    siteRegex: siteRule.siteRegex,
                    rule,
                    error: String(e),
                });
            }
        }

        compiled.push({ source: siteRule, gateRe, rules });
    }

    if (isDebugEnabled()) {
        log.debug("compiled rules", {
            sourceGroups: siteRules.length,
            groups: compiled.length,
            rules: compiled.reduce((total, group) => total + group.rules.length, 0),
            disabled,
            dropped,
        });
    }
    return compiled;
}

// ─── Application (pure) ───────────────────────────────────────────────────────

/** Whether a replace regex has any match — only stateful flags need an isolated clone. */
function replaceHasMatch(re: RegExp, input: string): boolean {
    const matcher = re.global || re.sticky ? new RegExp(re.source, re.flags) : re;
    return matcher.test(input);
}

/**
 * Replays ONE compiled group — the single sequence truth for engine + preview.
 *
 * * The site gate tests `gateUrl` (the engine's ORIGINAL url), while rules start
 *   at `inputUrl` (the current result of earlier groups).
 * * Rules apply sequentially; a checkpoint aborts the rest of the group.
 * * Pure and silent: logging is the engine consumer's concern.
 *
 * @param group    - One compiled site rule.
 * @param inputUrl - The URL entering the group's rule chain.
 * @param gateUrl  - The URL the site gate tests (defaults to `inputUrl`).
 */
export function executeCompiledGroup(
    group: CompiledSiteRule,
    inputUrl: string,
    gateUrl: string = inputUrl,
): GroupExecution {
    const gateMatched = group.gateRe.test(gateUrl);
    if (!gateMatched) return { gateMatched: false, steps: [], finalUrl: inputUrl, aborted: false };

    let current = inputUrl;
    const steps: RuleStepOutcome[] = [];
    let aborted = false;

    for (const rule of group.rules) {
        if (aborted) break;
        if (rule.kind === "checkpoint") {
            const matched = rule.checkpointRe.test(current);
            const allowContinue = rule.source.mode === "continue" ? matched : !matched;
            steps.push({
                rule,
                ruleIndex: rule.ruleIndex,
                oldUrl: current,
                newUrl: current,
                changed: false,
                reason: allowContinue ? "checkpoint-continue" : "checkpoint-stopped",
            });
            if (!allowContinue) aborted = true;
            continue;
        }
        if (rule.kind === "replace") {
            const next = current.replace(rule.replaceRe, rule.source.substitution);
            const reason: StepReason =
                next !== current ? "applied" : replaceHasMatch(rule.replaceRe, current) ? "unchanged" : "no-match";
            steps.push({
                rule,
                ruleIndex: rule.ruleIndex,
                oldUrl: current,
                newUrl: next,
                changed: next !== current,
                reason,
            });
            current = next;
            continue;
        }
        // * Gates match the query-DECODED surface while edits stay raw (fuq.com).
        if (rule.kind === "removeQuery") {
            if (rule.gateRe && !rule.gateRe.test(querySurface(current))) {
                steps.push({
                    rule,
                    ruleIndex: rule.ruleIndex,
                    oldUrl: current,
                    newUrl: current,
                    changed: false,
                    reason: "gate-no-match",
                });
                continue;
            }
            const next = removeQueryParams(current, rule.keys);
            steps.push({
                rule,
                ruleIndex: rule.ruleIndex,
                oldUrl: current,
                newUrl: next,
                changed: next !== current,
                reason: next !== current ? "applied" : "unchanged",
            });
            current = next;
            continue;
        }
        if (rule.kind === "unwrap") {
            const outcome = unwrapTarget(current, rule.unwrapRe);
            const next = outcome.target ?? current;
            steps.push({
                rule,
                ruleIndex: rule.ruleIndex,
                oldUrl: current,
                newUrl: next,
                changed: next !== current,
                reason: !outcome.matched ? "no-match" : next !== current ? "applied" : "unchanged",
            });
            current = next;
            continue;
        }
        if (rule.gateRe && !rule.gateRe.test(querySurface(current))) {
            steps.push({
                rule,
                ruleIndex: rule.ruleIndex,
                oldUrl: current,
                newUrl: current,
                changed: false,
                reason: "gate-no-match",
            });
            continue;
        }
        const next = appendQueryParams(current, rule.params);
        steps.push({
            rule,
            ruleIndex: rule.ruleIndex,
            oldUrl: current,
            newUrl: next,
            changed: next !== current,
            reason: next !== current ? "applied" : "unchanged",
        });
        current = next;
    }

    return { gateMatched: true, steps, finalUrl: current, aborted };
}

/**
 * Applies every site-matching rule to the URL — pure, sequential single pass.
 *
 * * Site gates evaluate ONCE against the ORIGINAL url (legacy single-pass
 *   semantics); rules within a matched group apply sequentially.
 * * The sequence itself lives in {@link executeCompiledGroup}; this function
 *   only maps outcomes to logs + the public `AppliedRule` records.
 *
 * @param url      - The current URL (any string — no URL-object validation).
 * @param compiled - The compiled site rules (see {@link compileRules}).
 * @param context  - Optional correlation data (`runId` from the watcher).
 */
export function applyRules(url: string, compiled: CompiledSiteRule[], context: { runId?: number } = {}): ApplyResult {
    let current = url;
    const applied: AppliedRule[] = [];
    const debug = isDebugEnabled();
    const runId = context.runId;

    for (const siteRule of compiled) {
        const execution = executeCompiledGroup(siteRule, current, url);
        if (!execution.gateMatched) {
            if (debug) log.debug("site rule skipped", { runId, siteRegex: siteRule.source.siteRegex, url });
            continue;
        }
        if (debug) log.debug("site gate matched", { runId, siteRegex: siteRule.source.siteRegex, url });
        for (const step of execution.steps) {
            if (step.rule.kind === "checkpoint") {
                if (debug) {
                    log.debug("checkpoint evaluated", {
                        runId,
                        siteRegex: siteRule.source.siteRegex,
                        ruleIndex: step.ruleIndex,
                        reason: step.reason,
                        url: step.oldUrl,
                    });
                }
                continue;
            }
            if (step.changed) {
                const record: AppliedRule = {
                    siteRegex: siteRule.source.siteRegex,
                    rule: step.rule.source,
                    oldUrl: step.oldUrl,
                    newUrl: step.newUrl,
                };
                applied.push(record);
                log.info("rule applied", { runId, ...record });
            } else if (step.reason === "gate-no-match") {
                if (debug) {
                    log.debug("query gate did not match", {
                        runId,
                        siteRegex: siteRule.source.siteRegex,
                        regex: step.rule.source.regex,
                        url: step.oldUrl,
                    });
                }
            } else {
                if (debug) {
                    log.debug("rule did not change the url", {
                        runId,
                        siteRegex: siteRule.source.siteRegex,
                        rule: step.rule.source,
                        reason: step.reason,
                        url: step.oldUrl,
                    });
                }
            }
        }
        current = execution.finalUrl;
    }

    if (debug) {
        log.debug("rules evaluated", {
            runId,
            url,
            finalUrl: current,
            changed: current !== url,
            applied: applied.length,
            groups: compiled.length,
        });
    }
    return { url: current, changed: current !== url, applied };
}
