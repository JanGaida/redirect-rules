// ─────────────────────────────────────────────────────────────────────────────
// MARK: Assistant proposal — tolerant LLM answer → strict parsed transfer
// ─────────────────────────────────────────────────────────────────────────────
// * Accepts the two documented answer shapes (one rule, one group) plus the
//   export-envelope shapes; validation is delegated to `settings-transfer.ts`.
// * `extractJsonValue` survives Markdown fences and prose around the JSON
//   (including brackets in prose before the value).
// * Target resolution is semantic: `/example\.de/` and `example.de` are the
//   same gate, so an existing group is reused instead of duplicated.
// * ! Rule identity is CONTENT (`ruleSignature`), never an LLM-supplied index —
//   an index from the chat would overwrite existing rules on merge.

import { isValidRegex, parseRegex } from "./parse-regex";
import type { PreviewEntry, SiteRule, UrlRule } from "./settings";
import { matchGroups, parseSettingsTransfer, ruleSignature, type ParsedTransfer } from "./settings-transfer";

/** Why a proposal could not be accepted. */
export type AssistantParseCode = "parse" | "structure" | "needsGate";

/** One resolved import target (existing group or a new one). */
export interface AssistantGroupTarget {
    /** Gate as authored by the LLM (before a semantic match rewrote it). */
    proposedGate: string;
    /** Final gate: the existing group's exact string, else the proposal. */
    siteRegex: string;
    /** Current group index when the gate matched, else null (new group). */
    matchIndex: number | null;
    isNew: boolean;
    /** Valid rules that are not already present (import candidates). */
    rules: UrlRule[];
    /** Valid rules already present in the target (or repeated in the answer). */
    duplicates: UrlRule[];
    /** Verification test entries that are not already present in the target. */
    previewEntries: PreviewEntry[];
}

/** Resolved proposal — ready for the preview and the append-only commit. */
export interface AssistantProposal {
    /** All rules already existed; nothing would be imported. */
    noNewRules: boolean;
    groups: AssistantGroupTarget[];
}

/** Discriminated parse result — never throws. */
export type AssistantParseResult =
    { ok: true; parsed: ParsedTransfer } | { ok: false; code: AssistantParseCode; message: string };

// ─── JSON extraction ──────────────────────────────────────────────────────────

/**
 * Finds the balancing close index for the bracket opened at `start`.
 *
 * * Tracks `{}` and `[]` with an explicit stack, so nested arrays/objects and
 *   braces inside string literals never confuse the counter.
 *
 * @param text - Source text.
 * @param start - Index of the opening `{` or `[`.
 * @returns The index of the matching close, or -1 when unbalanced/mismatched.
 */
function balancedEnd(text: string, start: number): number {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
        const char = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === "{" || char === "[") {
            stack.push(char);
            continue;
        }
        if (char === "}" || char === "]") {
            const expected = char === "}" ? "{" : "[";
            if (stack.pop() !== expected) return -1;
            if (stack.length === 0) return index;
        }
    }
    return -1;
}

/**
 * Extracts the first balanced JSON VALUE (object OR array) from an LLM answer.
 *
 * * Markdown fences are stripped; prose before/after the value is ignored.
 * * Every candidate start is tried in order — a prose bracket such as
 *   `[note]` fails `JSON.parse` and the scan moves on to the real value.
 * * String literals and escapes are tracked so braces inside strings never
 *   affect balancing.
 *
 * @param text - Raw chat answer.
 * @returns The JSON value text, or null when no balanced slice parses.
 */
export function extractJsonValue(text: string): string | null {
    const stripped = text.replace(/^\s*```[^\n]*$/gm, "");
    let inString = false;
    let escaped = false;
    for (let start = 0; start < stripped.length; start++) {
        const char = stripped[start];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char !== "{" && char !== "[") continue;

        const end = balancedEnd(stripped, start);
        if (end < 0) continue;
        const slice = stripped.slice(start, end + 1);
        try {
            JSON.parse(slice);
            return slice;
        } catch {
            // * not JSON — keep scanning for the next candidate start
        }
    }
    return null;
}

// ─── Shape normalization ──────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function looksLikeRule(value: unknown): boolean {
    const record = asRecord(value);
    return record !== null && typeof record.kind === "string";
}

function looksLikeGroup(value: unknown): boolean {
    const record = asRecord(value);
    return record !== null && Array.isArray(record.rules);
}

/** Reads a group gate, falling back to the page-derived gate. */
function gateOf(record: Record<string, unknown>, fallbackGate: string): string {
    return typeof record.siteRegex === "string" && record.siteRegex !== "" ? record.siteRegex : fallbackGate;
}

/** Keeps the group-level verification entries on a rebuilt group wrapper. */
function withPreviewEntries(base: Record<string, unknown>, record: Record<string, unknown>): Record<string, unknown> {
    return record.previewEntries !== undefined ? { ...base, previewEntries: record.previewEntries } : base;
}

/**
 * Normalizes every accepted answer shape into the legacy `{ rules: [group] }`
 * wrapper consumed by `parseSettingsTransfer`.
 *
 * @returns The groups, or null when the JSON is not a rule/group shape.
 */
function normalizeGroups(raw: unknown, fallbackGate: string): unknown[] | null {
    if (Array.isArray(raw)) {
        if (raw.length === 0) return null;
        if (raw.every(looksLikeGroup)) return raw;
        if (raw.every(looksLikeRule)) return [{ siteRegex: fallbackGate, rules: raw }];
        return null;
    }

    const record = asRecord(raw);
    if (record === null) return null;

    if (Array.isArray(record.siteGroups)) return record.siteGroups;

    if (Array.isArray(record.rules)) {
        if (record.rules.length === 0) return null;
        if (record.rules.every(looksLikeGroup)) return record.rules;
        if (record.rules.every(looksLikeRule)) {
            return [withPreviewEntries({ siteRegex: gateOf(record, fallbackGate), rules: record.rules }, record)];
        }
        return null;
    }

    if (looksLikeRule(record)) {
        return [withPreviewEntries({ siteRegex: gateOf(record, fallbackGate), rules: [record] }, record)];
    }

    return null;
}

/** Delegates a v1 envelope / legacy wrapper straight to the transfer parser. */
function isTransferEnvelope(record: Record<string, unknown>): boolean {
    return typeof record.format === "string" || record.settings !== undefined;
}

/** Converts one parsed group's entries into valid rules (null = invalid entry). */
function groupRules(parsed: ParsedTransfer): UrlRule[][] | null {
    const groups: UrlRule[][] = [];
    for (const group of parsed.siteGroups) {
        const rules: UrlRule[] = [];
        for (const entry of group.rules) {
            if (!entry.valid || entry.rule === undefined) return null;
            rules.push(entry.rule);
        }
        if (rules.length === 0) return null;
        groups.push(rules);
    }
    return groups;
}

// ─── Gate matching ────────────────────────────────────────────────────────────

/** Compares two authored gates by compiled source + effective flags. */
function sameGate(a: string, b: string): boolean {
    if (a === b) return true;
    if (!isValidRegex(a) || !isValidRegex(b)) return false;
    try {
        const left = parseRegex(a);
        const right = parseRegex(b);
        const leftFlags = left.flags.replace(/[gy]/g, "");
        const rightFlags = right.flags.replace(/[gy]/g, "");
        return left.source === right.source && leftFlags === rightFlags;
    } catch {
        return false;
    }
}

/** First current group whose gate is semantically equal to `gate`. */
function findSemanticGate(current: SiteRule[], gate: string): number | null {
    for (let index = 0; index < current.length; index++) {
        if (sameGate(current[index].siteRegex, gate)) return index;
    }
    return null;
}

// ─── Parse + resolve ──────────────────────────────────────────────────────────

/**
 * Parses an LLM answer into a strict `ParsedTransfer`.
 *
 * @param text         - Raw chat answer (fences/prose tolerated).
 * @param fallbackGate - Gate used when the answer omits `siteRegex` (page host).
 */
export function parseAssistantProposal(text: string, fallbackGate: string): AssistantParseResult {
    const extracted = extractJsonValue(text);
    if (extracted === null) {
        return { ok: false, code: "parse", message: "No JSON value found in the answer." };
    }

    let raw: unknown;
    try {
        raw = JSON.parse(extracted) as unknown;
    } catch (error) {
        return {
            ok: false,
            code: "parse",
            message: error instanceof Error ? error.message : String(error),
        };
    }

    const record = asRecord(raw);
    let parseText: string;

    if (record !== null && isTransferEnvelope(record)) {
        parseText = extracted;
    } else {
        const groups = normalizeGroups(raw, fallbackGate);
        if (groups === null) {
            return { ok: false, code: "structure", message: "The JSON is neither a rule nor a group." };
        }
        const missingGate = groups.some((group) => {
            const groupRecord = asRecord(group);
            return groupRecord === null || gateOf(groupRecord, "") === "";
        });
        if (missingGate) {
            return { ok: false, code: "needsGate", message: "The answer has no site gate." };
        }
        parseText = JSON.stringify({ rules: groups });
    }

    const result = parseSettingsTransfer(parseText);
    if (!result.ok) {
        return {
            ok: false,
            code: result.error.code === "parse" ? "parse" : "structure",
            message: result.error.message ?? "The JSON does not match the proposal format.",
        };
    }

    for (const group of result.parsed.siteGroups) {
        if (!group.gateValid) {
            return { ok: false, code: "structure", message: "The site gate is not a valid regex." };
        }
        if (group.meta !== undefined && !group.meta.valid) {
            return { ok: false, code: "structure", message: "The group metadata is invalid." };
        }
    }
    if (groupRules(result.parsed) === null) {
        return { ok: false, code: "structure", message: "The answer contains an invalid rule." };
    }

    return { ok: true, parsed: result.parsed };
}

/** Content identity of a verification entry (url + expected output + caption). */
function previewEntrySignature(entry: PreviewEntry): string {
    return JSON.stringify([entry.url, entry.testOutputUri, entry.description ?? ""]);
}

/**
 * Resolves parsed groups against the live settings: semantic gate match,
 * existing-rule dedupe, and new/existing classification.
 *
 * @param current - Live site groups.
 * @param parsed  - Result from `parseAssistantProposal`.
 */
export function resolveProposal(current: SiteRule[], parsed: ParsedTransfer): AssistantProposal {
    // * Work on a clone: gate rewriting must not mutate the derived parse result.
    const work = JSON.parse(JSON.stringify(parsed)) as ParsedTransfer;
    const proposedGates = work.siteGroups.map((group) => group.siteRegex);

    // * Rewrite semantically equal gates to the existing string so the shared
    //   exact-match pass (matchGroups) and the preview agree.
    for (const group of work.siteGroups) {
        const match = findSemanticGate(current, group.siteRegex);
        if (match !== null) group.siteRegex = current[match].siteRegex;
    }

    const matches = matchGroups(current, work.siteGroups);
    const groups: AssistantGroupTarget[] = [];
    let newRuleCount = 0;

    for (const group of work.siteGroups) {
        const matchIndex = matches[group.index];
        const target = matchIndex === null ? undefined : current[matchIndex];
        const existing = new Set((target?.rules ?? []).map((rule) => ruleSignature(rule)));
        const seen = new Set<string>();
        const rules: UrlRule[] = [];
        const duplicates: UrlRule[] = [];

        for (const entry of group.rules) {
            const rule = entry.rule;
            if (!entry.valid || rule === undefined) continue;
            const signature = ruleSignature(rule);
            if (existing.has(signature) || seen.has(signature)) {
                duplicates.push(rule);
                continue;
            }
            seen.add(signature);
            rules.push(rule);
        }

        const existingEntries = new Set((target?.previewEntries ?? []).map((entry) => previewEntrySignature(entry)));
        const seenEntries = new Set<string>();
        const previewEntries: PreviewEntry[] = [];
        for (const entry of group.meta?.previewEntries ?? []) {
            const signature = previewEntrySignature(entry);
            if (existingEntries.has(signature) || seenEntries.has(signature)) continue;
            seenEntries.add(signature);
            previewEntries.push({ ...entry });
        }

        newRuleCount += rules.length;
        groups.push({
            proposedGate: proposedGates[group.index] ?? group.siteRegex,
            siteRegex: group.siteRegex,
            matchIndex,
            isNew: matchIndex === null,
            rules,
            duplicates,
            previewEntries,
        });
    }

    return { noNewRules: newRuleCount === 0, groups };
}
