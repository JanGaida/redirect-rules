// ─────────────────────────────────────────────────────────────────────────────
// MARK: Preview — pure model for the rule editor's colored before/after view
// ─────────────────────────────────────────────────────────────────────────────
// * Pure model (no DOM/storage), pinned to applyRules semantics: gates evaluate
//   once against the input, rules apply sequentially.
// * Group-scoped: previewGroup renders the open group's full chain;
//   previewChain is the engine-parity oracle; splitUrlComponents colors URI parts.
// * `expandSubstitution` replicates String.replace substitution semantics exactly.

import {
    compileRules,
    executeCompiledGroup,
    type CompiledRule,
    type CompiledSiteRule,
    type RuleStepOutcome,
    type StepReason,
} from "./redirect-engine";
import type { SiteRule, UrlRule } from "./settings";

/** Sample URL for the editor's "load sample" button — exercises every component. */
export const SAMPLE_URL = "https://sample.example.com/path/page?utm_source=x&lang=de#frag";

// ─── URI component segmentation ────────────────────────────────────────────────

/** One URI component piece of a URL (for the subtle background coloring). */
export type UrlComponentType = "scheme" | "userinfo" | "host" | "port" | "path" | "query" | "fragment" | "context";

/** One segment of a URL with its component classification + character range. */
export interface UrlSegment {
    text: string;
    component: UrlComponentType;
    /** Inclusive start index into the source URL. */
    start: number;
    /** Exclusive end index into the source URL. */
    end: number;
}

/**
 * Splits a URL into lenient component segments — never throws, never drops text.
 *
 * * Scheme requires `://` (a `mailto:`-style prefix is not a scheme here).
 * * Without a scheme, everything before `?`/`#` is one `context` segment
 *   (host-vs-path is ambiguous — corpus strings like `www.test.com/path` stay
 *   honest instead of guessing).
 * * IPv6 hosts: the port splits at the first `:` AFTER the closing `]`.
 *
 * @param url - Any string (engine truth: no URL-object validation anywhere).
 */
export function splitUrlComponents(url: string): UrlSegment[] {
    const segments: UrlSegment[] = [];
    let cursor = 0;

    const push = (component: UrlComponentType, text: string): void => {
        if (text === "") return;
        segments.push({ component, text, start: cursor, end: cursor + text.length });
        cursor += text.length;
    };

    let rest = url;
    const schemeMatch = rest.match(/^[A-Za-z][A-Za-z0-9+.\-]*:\/\//);
    const scheme = schemeMatch ? schemeMatch[0] : "";
    if (schemeMatch) {
        push("scheme", scheme);
        rest = rest.slice(scheme.length);

        // * Authority runs to the first /, ?, # — then splits userinfo/host/port.
        const authEndMatch = rest.match(/^[^/?#]*/);
        let authority = authEndMatch ? authEndMatch[0] : "";
        const authEnd = authority.length;

        const at = authority.lastIndexOf("@");
        if (at >= 0) {
            push("userinfo", authority.slice(0, at + 1));
            authority = authority.slice(at + 1);
        }

        let host = authority;
        let port = "";
        if (authority.startsWith("[")) {
            // * IPv6: the port starts at the first ':' after the closing ']'.
            const closeBracket = authority.indexOf("]");
            const colon = authority.indexOf(":", closeBracket >= 0 ? closeBracket + 1 : 0);
            if (colon >= 0) {
                host = authority.slice(0, colon);
                port = authority.slice(colon);
            }
        } else {
            const colon = authority.indexOf(":");
            if (colon >= 0) {
                host = authority.slice(0, colon);
                port = authority.slice(colon);
            }
        }
        push("host", host);
        push("port", port);
        rest = rest.slice(authEnd);
    }

    // * Remaining pieces: path (or context without a scheme), query, fragment.
    const hashIdx = rest.indexOf("#");
    const fragment = hashIdx >= 0 ? rest.slice(hashIdx) : "";
    const withoutFragment = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest;
    const queryIdx = withoutFragment.indexOf("?");
    const path = queryIdx >= 0 ? withoutFragment.slice(0, queryIdx) : withoutFragment;
    const query = queryIdx >= 0 ? withoutFragment.slice(queryIdx) : "";

    push(schemeMatch ? "path" : "context", path);
    push("query", query);
    push("fragment", fragment);
    push("context", url.slice(cursor));

    return segments;
}

// ─── Native-parity substitution expansion ─────────────────────────────────────

/**
 * Expands a `String.replace` substitution template EXACTLY like the engine's
 * native replace does (ECMA-262 GetSubstitution): `$$`, `$&`, `` $` ``, `$'`,
 * `$1`…`$99` (two-digit preferred, single-digit fallback), `$<name>` (missing
 * group → empty string; undefined namedCaptures → literal `$`).
 *
 * @param template        - The rule's substitution string.
 * @param matched         - The matched substring.
 * @param position        - Match start index into the subject.
 * @param string          - The full subject string.
 * @param captures        - Capture results (index 0 = $1).
 * @param namedCaptures  - Named capture results (undefined when the regex has no names).
 */
export function expandSubstitution(
    template: string,
    matched: string,
    position: number,
    string: string,
    captures: Array<string | undefined>,
    namedCaptures: Record<string, string | undefined> | undefined,
): string {
    let out = "";
    let i = 0;

    while (i < template.length) {
        if (template[i] !== "$") {
            out += template[i];
            i += 1;
            continue;
        }
        const c1 = template[i + 1];
        if (c1 === undefined) {
            out += "$";
            i += 1;
            continue;
        }
        if (c1 === "$") {
            out += "$";
            i += 2;
            continue;
        }
        if (c1 === "&") {
            out += matched;
            i += 2;
            continue;
        }
        if (c1 === "`") {
            out += string.slice(0, position);
            i += 2;
            continue;
        }
        if (c1 === "'") {
            out += string.slice(position + matched.length);
            i += 2;
            continue;
        }
        if (c1 >= "0" && c1 <= "9") {
            const c2 = template[i + 2];
            if (c2 !== undefined && c2 >= "0" && c2 <= "9") {
                const nn = Number(c1 + c2);
                if (nn > 0 && nn <= captures.length) {
                    out += captures[nn - 1] ?? "";
                    i += 3;
                    continue;
                }
            }
            const n = Number(c1);
            if (n > 0 && n <= captures.length) {
                out += captures[n - 1] ?? "";
                i += 2;
                continue;
            }
            // * Not a valid capture reference — "$" + the digit stay literal.
            out += `$${c1}`;
            i += 2;
            continue;
        }
        if (c1 === "<") {
            const close = template.indexOf(">", i + 2);
            if (namedCaptures !== undefined && close >= 0) {
                const name = template.slice(i + 2, close);
                out += namedCaptures[name] ?? "";
                i = close + 1;
                continue;
            }
            // * No named captures → the "$" stays literal (spec behavior).
            out += "$";
            i += 1;
            continue;
        }
        out += "$";
        i += 1;
    }

    return out;
}

// ─── Preview shapes ────────────────────────────────────────────────────────────

/** Why a chain step stands where it does — engine reasons + compile/gate states. */
export type PreviewReason = StepReason | "site-no-match" | "invalid-regex";

/** One colored piece of the before/after preview. */
export interface PreviewSpan {
    text: string;
    /** The URI component underneath (subtle coloring). */
    component: UrlComponentType;
    /** The diff overlay — red `match` on the before side, green `insertion` on the after side. */
    diff: "match" | "insertion" | null;
}

/** One two-sided before/after preview with colored spans (group steps). */
export interface PreviewResult {
    beforeUrl: string;
    afterUrl: string;
    beforeSpans: PreviewSpan[];
    afterSpans: PreviewSpan[];
    changed: boolean;
    reason: PreviewReason;
}

/** One applied rule of the full chain (see `previewChain`). */
export interface ChainStep {
    siteIndex: number;
    ruleIndex: number;
    oldUrl: string;
    newUrl: string;
}

/** The full-chain preview (step list + final url). */
export interface ChainPreview {
    steps: ChainStep[];
    finalUrl: string;
    changed: boolean;
}

/** One red/green range over a preview string (character indexes, end exclusive). */
interface DiffRange {
    start: number;
    end: number;
    diff: "match" | "insertion";
}

// ─── Span assembly — URI components underneath, diff ranges on top ────────────

/**
 * Merges the URI segmentation with diff ranges into renderable spans.
 *
 * Span boundaries: segment edges AND diff edges — a diff range always wins the
 * color overlay, the component stays the subtle background layer.
 */
function buildSpans(text: string, ranges: DiffRange[]): PreviewSpan[] {
    const segments = splitUrlComponents(text);
    const points = new Set<number>([0, text.length]);
    for (const segment of segments) {
        points.add(Math.min(segment.start, text.length));
        points.add(Math.min(segment.end, text.length));
    }
    for (const range of ranges) {
        points.add(Math.max(0, Math.min(range.start, text.length)));
        points.add(Math.max(0, Math.min(range.end, text.length)));
    }
    const sorted = [...points].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b);

    const spans: PreviewSpan[] = [];
    for (let k = 0; k + 1 < sorted.length; k++) {
        const start = sorted[k];
        const end = sorted[k + 1];
        if (end <= start) continue;
        const segment = segments.find((s) => s.start <= start && start < s.end);
        const range = ranges.find((r) => r.start <= start && end <= r.end);
        const last = spans[spans.length - 1];
        const span: PreviewSpan = {
            text: text.slice(start, end),
            component: segment?.component ?? "context",
            diff: range?.diff ?? null,
        };
        // * Adjacent pieces with identical coloring merge — fewer DOM nodes.
        if (last && last.component === span.component && last.diff === span.diff) {
            last.text += span.text;
        } else {
            spans.push(span);
        }
    }
    return spans;
}

/**
 * Plain URL spans without a diff overlay — URI component tones only.
 *
 * @param text - The URL to segment.
 * @returns The component spans, empty for an empty string.
 */
export function plainSpans(text: string): PreviewSpan[] {
    return buildSpans(text, []);
}

/** Convenience — the unchanged preview (plain spans, no diff). */
function plainResult(url: string, reason: PreviewReason): PreviewResult {
    return {
        beforeUrl: url,
        afterUrl: url,
        beforeSpans: plainSpans(url),
        afterSpans: plainSpans(url),
        changed: false,
        reason,
    };
}

// ─── Chain replay (engine-parity) ──────────────────────────────────────────────

/**
 * Replays the FULL rule chain — one step per applied rule, in application order.
 *
 * Engine parity: gates evaluate once against the ORIGINAL url; rules apply
 * sequentially within matched groups. The sequence comes from the shared
 * executor (ADR 0017); parity is pinned against `applyRules`.
 */
export function previewChain(url: string, siteRules: SiteRule[]): ChainPreview {
    const compiled = compileRules(siteRules);
    let current = url;
    const steps: ChainStep[] = [];

    for (const siteRule of compiled) {
        const execution = executeCompiledGroup(siteRule, current, url);
        const siteIndex = siteRules.indexOf(siteRule.source);
        for (const step of execution.steps) {
            if (!step.changed) continue;
            steps.push({
                siteIndex,
                ruleIndex: step.ruleIndex,
                oldUrl: step.oldUrl,
                newUrl: step.newUrl,
            });
        }
        current = execution.finalUrl;
    }

    return { steps, finalUrl: current, changed: current !== url };
}

// ─── Group preview — the group's FULL chain + prominent total (group binding) ──

/** The rule's identifying label — regex (replace) / params (appendQuery). */
export function ruleLabel(rule: UrlRule): string {
    if (rule.kind === "replace") return rule.regex ?? "";
    if (rule.kind === "appendQuery") return rule.params ?? "";
    if (rule.kind === "removeQuery") return rule.keys;
    return rule.regex ?? "";
}

/** Whether one chain step actually changed the url (the applied/skipped chip). */
export type StepStatus = "applied" | "skipped";

/** One GROUP step WITH its own two-sided colored preview — built for EVERY authored rule. */
export interface GroupStepPreview {
    /** The step rule's index WITHIN its group (parity with the explorer chips). */
    ruleIndex: number;
    kind: "replace" | "appendQuery" | "removeQuery" | "checkpoint";
    /** The rule's identifying label — the step summary's "name". */
    label: string;
    /** The chain chip: the rule changed the url, or it was skipped (any reason). */
    status: StepStatus;
    /** Why the rule stands where it does (chip tooltip + selected-row reason line). */
    reason: PreviewReason;
    oldUrl: string;
    newUrl: string;
    oldSpans: PreviewSpan[];
    newSpans: PreviewSpan[];
}

/**
 * The group-scoped preview package: one preview per AUTHORED rule + the
 * START-vs-END total (source vs final, common-prefix/suffix diff).
 */
export interface GroupPreview {
    /** Site-gate result from the shared executor — false for an empty or invalid gate. */
    gateMatched: boolean;
    /** Every authored rule of the group — applied AND skipped, in order. */
    steps: GroupStepPreview[];
    finalUrl: string;
    /** Total START spans — red (matched-away) middle range. */
    sourceSpans: PreviewSpan[];
    /** Total END spans — green (inserted) middle range. */
    targetSpans: PreviewSpan[];
    changed: boolean;
}

/**
 * Replays ONE site group against its preview url and previews EVERY authored
 * rule (engine parity — same replay semantics as `applyRules`, scoped to the
 * single group: the gate evaluates once against the input url, rules apply
 * sequentially). Rules that do NOT change the url (no match, gate miss,
 * unchanged output) still render as SKIPPED steps — engine truth without
 * holes; a dead group (invalid gate / gate miss) marks every step skipped.
 *
 * @param url  - The preview input url (one entry of the group's `previewEntries`).
 * @param site - The site group whose chain the preview shows.
 */
export function previewGroup(url: string, site: SiteRule): GroupPreview {
    // * Disabled groups stay previewable: the authoring view simulates the chain
    //   even though the engine skips the group (banner rendered by the GUI).
    return previewGroupCompiled(url, site, compileRules([site], { includeDisabled: true })[0]);
}

/**
 * Same as {@link previewGroup}, but reuses an ALREADY compiled group so a
 * multi-test-case preview compiles the chain once per recompute instead of once
 * per entry.
 *
 * @param url   - The group's preview input url.
 * @param site  - The authored group (drives step order + labels).
 * @param group - The compiled group, or undefined when the gate is unusable.
 */
export function previewGroupCompiled(url: string, site: SiteRule, group: CompiledSiteRule | undefined): GroupPreview {
    const execution =
        group === undefined
            ? { gateMatched: false, steps: [] as RuleStepOutcome[], finalUrl: url, aborted: false }
            : executeCompiledGroup(group, url, url);

    // * Authored index maps: compile-skipped rules have no outcome, and rules
    //   after an aborting checkpoint have a compiled rule but no outcome.
    const compiledByIndex = new Map(group?.rules.map((rule) => [rule.ruleIndex, rule] as const) ?? []);
    const outcomeByIndex = new Map(execution.steps.map((step) => [step.ruleIndex, step] as const));

    let current = url;
    const steps: GroupStepPreview[] = [];

    for (let ruleIndex = 0; ruleIndex < site.rules.length; ruleIndex++) {
        const source = site.rules[ruleIndex];
        const outcome = outcomeByIndex.get(ruleIndex);

        let result: PreviewResult;
        if (group === undefined) {
            result = plainResult(current, "invalid-regex"); // unusable site gate
        } else if (!execution.gateMatched) {
            result = plainResult(current, "site-no-match");
        } else if (outcome === undefined) {
            result = plainResult(current, compiledByIndex.has(ruleIndex) ? "checkpoint-stopped" : "invalid-regex");
        } else if (outcome.rule.kind === "checkpoint") {
            result = plainResult(outcome.oldUrl, outcome.reason);
        } else if (outcome.rule.kind === "replace") {
            result = previewReplace(outcome.oldUrl, outcome.rule, outcome);
        } else {
            result = previewAppendQuery(outcome.oldUrl, outcome);
        }

        steps.push({
            ruleIndex,
            kind: source.kind,
            label: ruleLabel(source),
            status: result.changed ? "applied" : "skipped",
            reason: result.reason,
            oldUrl: result.beforeUrl,
            newUrl: result.afterUrl,
            oldSpans: result.beforeSpans,
            newSpans: result.afterSpans,
        });
        if (result.changed) current = result.afterUrl;
    }

    return {
        gateMatched: execution.gateMatched,
        steps,
        finalUrl: current,
        ...diffSpans(url, current),
        changed: current !== url,
    };
}

// ─── Test-case summary — group-scoped pass/fail counts ───────────────────────

/** One preview entry's test verdict — `none` = preview-only (no expected output). */
export type TestStatus = "success" | "failed" | "none";

/** Aggregated test state of one site group. */
export interface GroupTestSummary {
    passed: number;
    failed: number;
    /** Real tests only — entries with a non-empty expected output. */
    total: number;
    /** `partial` = some pass and some fail (the amber dot). */
    status: "success" | "partial" | "failed" | "none";
}

/**
 * Classifies one preview entry against the chain's final URL — the SAME trim
 * comparison the preview rows use.
 *
 * @param finalUrl       - The chain's final URL.
 * @param expectedOutput - The entry's expected output (`""` = preview only).
 */
export function testStatus(finalUrl: string, expectedOutput: string): TestStatus {
    const expected = expectedOutput.trim();
    if (expected === "") return "none";
    return finalUrl.trim() === expected ? "success" : "failed";
}

/**
 * Summarizes a group's test cases: compiles the chain ONCE and replays every
 * preview entry. Preview-only entries (empty expected output) are ignored.
 *
 * @param site - The group whose `previewEntries` are tested.
 */
export function summarizeGroupTests(site: SiteRule): GroupTestSummary {
    const entries = site.previewEntries ?? [];
    if (entries.length === 0) {
        return { passed: 0, failed: 0, total: 0, status: "none" };
    }
    // * Disabled groups stay testable: the indicator mirrors the authoring preview.
    const group = compileRules([site], { includeDisabled: true })[0];
    let passed = 0;
    let failed = 0;
    for (const entry of entries) {
        const status = testStatus(previewGroupCompiled(entry.url, site, group).finalUrl, entry.testOutputUri);
        if (status === "success") passed += 1;
        else if (status === "failed") failed += 1;
    }
    const total = passed + failed;
    const status = total === 0 ? "none" : failed === 0 ? "success" : passed === 0 ? "failed" : "partial";
    return { passed, failed, total, status };
}

/**
 * Two-sided diff spans: common prefix/suffix stay plain, the differing middle
 * is red on the before side and green on the after side.
 *
 * @param before - The start URL.
 * @param after  - The end URL.
 * @returns Source spans (red `match`) and target spans (green `insertion`).
 */
export function diffSpans(before: string, after: string): { sourceSpans: PreviewSpan[]; targetSpans: PreviewSpan[] } {
    if (before === after) {
        return { sourceSpans: plainSpans(before), targetSpans: plainSpans(after) };
    }
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
    let endBefore = before.length;
    let endAfter = after.length;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
        endBefore -= 1;
        endAfter -= 1;
    }
    return {
        sourceSpans: buildSpans(before, endBefore > start ? [{ start, end: endBefore, diff: "match" }] : []),
        targetSpans: buildSpans(after, endAfter > start ? [{ start, end: endAfter, diff: "insertion" }] : []),
    };
}

/** Replace-rule preview: exec the authored regex, expand the substitution, color. */
function previewReplace(
    current: string,
    rule: CompiledRule & { kind: "replace" },
    outcome: RuleStepOutcome,
): PreviewResult {
    const re = rule.replaceRe;
    // * Local clone — iterating MUST NOT mutate the compiled rule's lastIndex.
    const iter = new RegExp(re.source, re.flags);

    const matches: RegExpExecArray[] = [];
    let m: RegExpExecArray | null;
    while ((m = iter.exec(current)) !== null) {
        matches.push(m);
        if (m[0] === "") {
            // * Zero-length match — advance one char (native replace parity).
            iter.lastIndex = m.index + 1;
            if (m.index >= current.length) break;
        }
        if (!re.global) break; // * Non-global replace: first match only (engine truth).
    }

    if (matches.length === 0) return plainResult(current, outcome.reason);

    let after = "";
    let cursor = 0;
    const beforeRanges: DiffRange[] = [];
    const afterRanges: DiffRange[] = [];

    for (const match of matches) {
        const captures = match.slice(1) as Array<string | undefined>;
        const named = match.groups as Record<string, string | undefined> | undefined;
        const expansion = expandSubstitution(rule.source.substitution, match[0], match.index, current, captures, named);

        after += current.slice(cursor, match.index);
        if (expansion !== "")
            afterRanges.push({ start: after.length, end: after.length + expansion.length, diff: "insertion" });
        after += expansion;
        if (match[0] !== "")
            beforeRanges.push({ start: match.index, end: match.index + match[0].length, diff: "match" });
        cursor = match.index + match[0].length;
    }
    after += current.slice(cursor);

    return {
        beforeUrl: current,
        afterUrl: after,
        beforeSpans: buildSpans(current, beforeRanges),
        afterSpans: buildSpans(after, afterRanges),
        changed: outcome.changed,
        reason: outcome.reason,
    };
}

/** appendQuery-rule preview: shared outcome + prefix/suffix diff coloring. */
function previewAppendQuery(current: string, outcome: RuleStepOutcome): PreviewResult {
    if (!outcome.changed) return plainResult(current, outcome.reason);
    const after = outcome.newUrl;

    // * Common prefix/suffix — the differing middle is the colored region.
    let start = 0;
    while (start < current.length && start < after.length && current[start] === after[start]) start += 1;
    let endBefore = current.length;
    let endAfter = after.length;
    while (endBefore > start && endAfter > start && current[endBefore - 1] === after[endAfter - 1]) {
        endBefore -= 1;
        endAfter -= 1;
    }

    const beforeRanges: DiffRange[] = endBefore > start ? [{ start, end: endBefore, diff: "match" }] : [];
    const afterRanges: DiffRange[] = endAfter > start ? [{ start, end: endAfter, diff: "insertion" }] : [];

    return {
        beforeUrl: current,
        afterUrl: after,
        beforeSpans: buildSpans(current, beforeRanges),
        afterSpans: buildSpans(after, afterRanges),
        changed: true,
        reason: "applied",
    };
}
