// ─────────────────────────────────────────────────────────────────────────────
// MARK: Settings transfer — export envelope, strict import, diff, merge
// ─────────────────────────────────────────────────────────────────────────────
// * Pure core (no DOM/store/GM): the dialog and the store consume the result.
// * Export is RAW (incomplete/invalid live units included); import is STRICT
//   per unit — missing values mean "keep current", never defaults.
// * One matching source: `matchGroups` feeds both `diffTransfer` and
//   `applyMerge`, so "new" in the UI is exactly what merge creates.
// * `normalizeSettings` is intentionally NOT used here (it fills defaults and
//   silently drops malformed rules); `applyReplace` must build the full object.

import { isLocaleSetting } from "./locale";
import { isSettingsLogLevel } from "./log";
import { isValidRegex } from "./parse-regex";
import { ruleProblem as rulePolicyProblem, type RuleProblem } from "./rule-policy";
import {
    isDashboardHostSetting,
    isThemeSetting,
    normalizeMotionStrict,
    normalizeRule,
    type PreviewEntry,
    type Settings,
    type SiteRule,
    type UrlRule,
} from "./settings";

// ─── Public types ─────────────────────────────────────────────────────────────

/** Every persisted settings field except the rule list and UI-only state. */
export const SETTINGS_FIELDS = [
    "locale",
    "logLevel",
    "performanceMode",
    "theme",
    "motion",
    "dashboardHost",
    "autosaveDelayMs",
] as const;
export type SettingsField = (typeof SETTINGS_FIELDS)[number];

/** Compile-time proof that a new Settings field cannot be forgotten here. */
type MissingSettingsField = Exclude<keyof Omit<Settings, "rules" | "lastSelection" | "hideSkipped">, SettingsField>;
export type _SettingsFieldCoverage = MissingSettingsField extends never ? true : ["missing", MissingSettingsField];

/** Per-unit problem code — mapped to i18n keys by the dialog. */
export type TransferProblem = "structure" | "regex" | "empty" | "index" | "meta" | "noRules";

/** Envelope format identity (version 1). */
export const TRANSFER_FORMAT = "redirect-rules-export";
export const TRANSFER_VERSION = 1;

/** One rule inside a transfer group — the original index is the identity. */
export interface TransferRuleEntry {
    ruleIndex: number;
    rule: UrlRule;
}

/** One site group inside the export envelope. */
export interface TransferGroup {
    siteRegex: string;
    description?: string;
    disabled?: boolean;
    previewEntries?: PreviewEntry[];
    rules: TransferRuleEntry[];
}

/** The exported JSON envelope. `rules` never appears under `settings`. */
export interface TransferEnvelope {
    format: typeof TRANSFER_FORMAT;
    version: typeof TRANSFER_VERSION;
    exportedAt: string;
    appVersion: string;
    partial: boolean;
    settings: Partial<Pick<Settings, SettingsField>>;
    siteGroups: TransferGroup[];
}

/** Selected units — group indexes refer to the parsed/current group list. */
export interface TransferSelection {
    fields: SettingsField[];
    groups: Array<{ groupIndex: number; meta: boolean; rules: number[] }>;
}

/** Strict parse diagnostics for one settings field. */
export interface ParsedField {
    value: unknown;
    valid: boolean;
    problem?: TransferProblem;
}

/** One parsed rule entry (the rule is kept even when invalid, for display). */
export interface ParsedRuleEntry {
    ruleIndex: number;
    raw?: unknown;
    rule?: UrlRule;
    valid: boolean;
    problem?: TransferProblem;
}

/** Optional group metadata (description + test entries + on/off state). */
export interface ParsedMeta {
    description?: string;
    disabled?: boolean;
    previewEntries?: PreviewEntry[];
    valid: boolean;
    problem?: TransferProblem;
}

/** Strictly parsed site group. */
export interface ParsedGroup {
    index: number;
    siteRegex: string;
    gateValid: boolean;
    problem?: TransferProblem;
    meta?: ParsedMeta;
    rules: ParsedRuleEntry[];
    /** Gate + rules usable; metadata validity is tracked separately. */
    valid: boolean;
}

/** Fully parsed import file. */
export interface ParsedTransfer {
    source: "v1" | "legacy";
    partial: boolean;
    exportedAt?: string;
    appVersion?: string;
    fields: Partial<Record<SettingsField, ParsedField>>;
    siteGroups: ParsedGroup[];
    allValid: boolean;
}

/** File-level rejections (never per-unit). */
export type TransferErrorCode = "parse" | "structure" | "unsupportedVersion";

export interface TransferParseError {
    code: TransferErrorCode;
    message?: string;
}

export type ParseResult = { ok: true; parsed: ParsedTransfer } | { ok: false; error: TransferParseError };

/** Field comparison row. */
export interface FieldDiff {
    field: SettingsField;
    current: unknown;
    imported?: unknown;
    present: boolean;
    equal: boolean;
    valid: boolean;
    problem?: TransferProblem;
}

/** Metadata comparison for one group. */
export interface MetaDiff {
    present: boolean;
    description?: { current: string; imported: string; equal: boolean };
    disabled?: { current: boolean; imported: boolean; equal: boolean };
    previewEntries?: { current: PreviewEntry[]; imported: PreviewEntry[]; equal: boolean };
    equal: boolean;
    valid: boolean;
    problem?: TransferProblem;
}

/** Rule comparison row. */
export interface RuleDiff {
    ruleIndex: number;
    current?: UrlRule;
    imported?: UrlRule;
    raw?: unknown;
    isNew: boolean;
    equal: boolean;
    valid: boolean;
    problem?: TransferProblem;
}

/** Group comparison row. */
export interface GroupDiff {
    groupIndex: number;
    siteRegex: string;
    matchIndex: number | null;
    isNew: boolean;
    gateValid: boolean;
    /** Gate + at least one valid rule (metadata tracked separately). */
    valid: boolean;
    problem?: TransferProblem;
    meta?: MetaDiff;
    rules: RuleDiff[];
    currentOnlyRules: Array<{ ruleIndex: number; rule: UrlRule }>;
    equal: boolean;
}

/** Whole-file comparison used by the dialog. */
export interface TransferDiff {
    fields: FieldDiff[];
    groups: GroupDiff[];
    currentOnlyGroups: Array<{ groupIndex: number; site: SiteRule }>;
}

// ─── Guards / helpers ─────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
    return Object.hasOwn(record, key);
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Lossless JSON clone — safe for Svelte `$state` proxies (never structuredClone). */
function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** The single rule-validity policy shared by parse, diff, and export marking. */
export function ruleProblem(rule: UrlRule): RuleProblem | null {
    return rulePolicyProblem(rule);
}

function canonicalRule(rule: UrlRule): UrlRule {
    if (rule.kind === "replace") {
        return { kind: "replace", regex: rule.regex, substitution: rule.substitution };
    }
    if (rule.kind === "appendQuery") {
        return { kind: "appendQuery", regex: rule.regex ?? "", params: rule.params };
    }
    if (rule.kind === "removeQuery") {
        return { kind: "removeQuery", regex: rule.regex ?? "", keys: rule.keys };
    }
    if (rule.kind === "unwrap") {
        return { kind: "unwrap", regex: rule.regex };
    }
    return { kind: "checkpoint", regex: rule.regex, mode: rule.mode };
}

/** Canonical, order-stable rule signature — diff identity and assistant dedupe. */
export function ruleSignature(rule: UrlRule): string {
    return JSON.stringify(canonicalRule(rule));
}

function sameRule(a: UrlRule, b: UrlRule): boolean {
    return ruleSignature(a) === ruleSignature(b);
}

function canonicalPreviewEntries(entries: PreviewEntry[] | undefined): PreviewEntry[] {
    return (entries ?? []).map((entry) => ({
        url: entry.url,
        testOutputUri: entry.testOutputUri,
        description: entry.description ?? "",
    }));
}

function samePreviewEntries(a: PreviewEntry[] | undefined, b: PreviewEntry[] | undefined): boolean {
    return JSON.stringify(canonicalPreviewEntries(a)) === JSON.stringify(canonicalPreviewEntries(b));
}

// ─── Field parsing ────────────────────────────────────────────────────────────

function parseField(field: SettingsField, value: unknown): ParsedField {
    if (field === "locale") {
        return isLocaleSetting(value) ? { value, valid: true } : { value, valid: false, problem: "structure" };
    }
    if (field === "logLevel") {
        return isSettingsLogLevel(value) ? { value, valid: true } : { value, valid: false, problem: "structure" };
    }
    if (field === "performanceMode") {
        return typeof value === "boolean" ? { value, valid: true } : { value, valid: false, problem: "structure" };
    }
    if (field === "theme") {
        return isThemeSetting(value) ? { value, valid: true } : { value, valid: false, problem: "structure" };
    }
    if (field === "dashboardHost") {
        return isDashboardHostSetting(value) ? { value, valid: true } : { value, valid: false, problem: "structure" };
    }
    if (field === "autosaveDelayMs") {
        const valid = typeof value === "number" && Number.isFinite(value) && value >= 250 && value <= 30000;
        return valid ? { value, valid: true } : { value, valid: false, problem: "structure" };
    }
    // * motion: canonical or a known legacy key; junk is invalid (no default).
    const motion = normalizeMotionStrict(value);
    return motion !== null ? { value: motion, valid: true } : { value, valid: false, problem: "structure" };
}

// ─── Rule parsing ─────────────────────────────────────────────────────────────

function parseRuleShape(raw: unknown, strict: boolean): { rule?: UrlRule; problem?: TransferProblem } {
    const record = asRecord(raw);
    if (!record) return { problem: "structure" };

    if (record.kind === "replace") {
        if (typeof record.regex !== "string" || typeof record.substitution !== "string") {
            return { problem: "structure" };
        }
        return { rule: { kind: "replace", regex: record.regex, substitution: record.substitution } };
    }

    if (record.kind === "appendQuery") {
        if (typeof record.params !== "string") return { problem: "structure" };
        if (strict && typeof record.regex !== "string") return { problem: "structure" };
        return {
            rule: {
                kind: "appendQuery",
                regex: typeof record.regex === "string" ? record.regex : "",
                params: record.params,
            },
        };
    }

    if (record.kind === "removeQuery") {
        if (typeof record.keys !== "string") return { problem: "structure" };
        if (strict && typeof record.regex !== "string") return { problem: "structure" };
        return {
            rule: {
                kind: "removeQuery",
                regex: typeof record.regex === "string" ? record.regex : "",
                keys: record.keys,
            },
        };
    }

    if (record.kind === "unwrap") {
        if (typeof record.regex !== "string") return { problem: "structure" };
        return { rule: { kind: "unwrap", regex: record.regex } };
    }

    if (record.kind === "checkpoint") {
        if (typeof record.regex !== "string") return { problem: "structure" };
        if (strict) {
            if (record.mode !== "continue" && record.mode !== "stop") return { problem: "structure" };
            return { rule: { kind: "checkpoint", regex: record.regex, mode: record.mode } };
        }
        // * Legacy tolerance: an absent/invalid mode means "continue".
        const mode = record.mode === "stop" ? "stop" : "continue";
        return { rule: { kind: "checkpoint", regex: record.regex, mode } };
    }

    return { problem: "structure" };
}

function parseRuleEntry(raw: unknown, ruleIndex: number, strict: boolean): ParsedRuleEntry {
    const shape = parseRuleShape(raw, strict);
    if (shape.rule === undefined) {
        return { ruleIndex, raw, valid: false, problem: shape.problem ?? "structure" };
    }
    const problem = ruleProblem(shape.rule);
    return {
        ruleIndex,
        raw,
        rule: shape.rule,
        valid: problem === null,
        ...(problem !== null ? { problem } : {}),
    };
}

// ─── Preview / metadata parsing ───────────────────────────────────────────────

function parsePreviewEntry(raw: unknown, legacy: boolean): PreviewEntry | null {
    if (legacy && typeof raw === "string") return { url: raw, testOutputUri: "" };
    const record = asRecord(raw);
    if (!record) return null;

    let url: string;
    if (typeof record.url === "string") url = record.url;
    else if (legacy && typeof record.testUrl === "string") url = record.testUrl;
    else return null;

    let testOutputUri: string;
    if (record.testOutputUri === undefined) {
        if (!legacy) return null;
        testOutputUri = "";
    } else if (typeof record.testOutputUri === "string") {
        testOutputUri = record.testOutputUri;
    } else {
        return null;
    }

    let description = "";
    if (record.description !== undefined) {
        if (typeof record.description !== "string") return null;
        description = record.description;
    }

    return { url, testOutputUri, description };
}

function parsePreviewEntries(raw: unknown, legacy: boolean): PreviewEntry[] | null {
    if (!Array.isArray(raw)) return null;
    const entries: PreviewEntry[] = [];
    for (const item of raw) {
        const entry = parsePreviewEntry(item, legacy);
        if (entry === null) return null;
        entries.push(entry);
    }
    return entries;
}

function parseMeta(record: Record<string, unknown>, legacy: boolean): ParsedMeta | undefined {
    const hasDescription = hasOwn(record, "description");
    const hasEntries = hasOwn(record, "previewEntries") || (legacy && hasOwn(record, "previewUrls"));
    const hasDisabled = hasOwn(record, "disabled");

    if (!hasDescription && !hasEntries && !hasDisabled) return undefined;

    const meta: ParsedMeta = { valid: true };

    if (hasDescription) {
        if (typeof record.description === "string") meta.description = record.description.trim();
        else {
            meta.valid = false;
            meta.problem = "meta";
        }
    }

    if (hasDisabled) {
        if (typeof record.disabled === "boolean") meta.disabled = record.disabled;
        else {
            meta.valid = false;
            meta.problem = "meta";
        }
    }

    if (hasEntries) {
        const source = hasOwn(record, "previewEntries") ? record.previewEntries : record.previewUrls;
        const entries = parsePreviewEntries(source, legacy);
        if (entries === null) {
            meta.valid = false;
            meta.problem = "meta";
        } else {
            meta.previewEntries = entries;
        }
    }

    // * v1 requires BOTH meta fields together; legacy files may carry only one.
    if (!legacy && hasDescription !== hasEntries) {
        meta.valid = false;
        meta.problem = "meta";
    }

    return meta;
}

// ─── Group parsing ────────────────────────────────────────────────────────────

function parseGroup(raw: unknown, index: number, legacy: boolean): ParsedGroup {
    const record = asRecord(raw);
    if (!record) {
        return { index, siteRegex: "", gateValid: false, problem: "structure", rules: [], valid: false };
    }

    const siteRegex = typeof record.siteRegex === "string" ? record.siteRegex : "";
    const rawRules = Array.isArray(record.rules) ? record.rules : [];
    const rulesShapeValid = Array.isArray(record.rules);
    const rules = rawRules.map((entry, position) => {
        if (legacy) {
            const normalized = normalizeRule(entry);
            if (normalized === null)
                return { ruleIndex: position, raw: entry, valid: false, problem: "structure" } as ParsedRuleEntry;
            const problem = ruleProblem(normalized);
            return {
                ruleIndex: position,
                raw: entry,
                rule: normalized,
                valid: problem === null,
                ...(problem !== null ? { problem } : {}),
            } as ParsedRuleEntry;
        }
        const ruleRecord = asRecord(entry);
        if (!ruleRecord) return { ruleIndex: -1, raw: entry, valid: false, problem: "structure" } as ParsedRuleEntry;
        if (!isNonNegativeInteger(ruleRecord.ruleIndex)) {
            return { ruleIndex: -1, raw: entry, valid: false, problem: "index" } as ParsedRuleEntry;
        }
        return parseRuleEntry(ruleRecord.rule, ruleRecord.ruleIndex, true);
    });

    let problem: TransferProblem | undefined;
    let gateValid = false;
    if (typeof record.siteRegex !== "string") problem = "structure";
    else if (siteRegex === "") problem = "empty";
    else if (!isValidRegex(siteRegex)) problem = "regex";
    else gateValid = true;

    if (problem === undefined && !rulesShapeValid) problem = "structure";
    if (problem === undefined && !rules.some((rule) => rule.valid)) problem = "noRules";

    const meta = parseMeta(record, legacy);

    return {
        index,
        siteRegex,
        gateValid,
        ...(problem !== undefined ? { problem } : {}),
        ...(meta !== undefined ? { meta } : {}),
        rules,
        valid: problem === undefined,
    };
}

// ─── File parsing ─────────────────────────────────────────────────────────────

function isSettingsField(key: string): key is SettingsField {
    return (SETTINGS_FIELDS as readonly string[]).includes(key);
}

function parseFields(candidate: Record<string, unknown>): Partial<Record<SettingsField, ParsedField>> {
    const fields: Partial<Record<SettingsField, ParsedField>> = {};
    for (const key of Object.keys(candidate)) {
        if (!isSettingsField(key)) continue;
        fields[key] = parseField(key, candidate[key]);
    }
    return fields;
}

function buildParsed(
    source: ParsedTransfer["source"],
    candidate: Record<string, unknown>,
    rawGroups: unknown[] | null,
    declaredPartial: boolean,
    exportedAt?: string,
    appVersion?: string,
): ParsedTransfer {
    const fields = parseFields(candidate);
    const legacy = source === "legacy";
    const siteGroups = (rawGroups ?? []).map((group, index) => parseGroup(group, index, legacy));

    const allFieldsPresent = SETTINGS_FIELDS.every((field) => fields[field] !== undefined);
    const allFieldsValid = Object.values(fields).every((field) => field.valid);
    const allRulesValid = siteGroups.every((group) => group.rules.every((rule) => rule.valid));
    const allMetaValid = siteGroups.every((group) => group.meta === undefined || group.meta.valid);
    const allGroupsValid = siteGroups.every((group) => group.valid);
    const metaComplete = source === "v1" ? siteGroups.every((group) => group.meta !== undefined) : true;
    const allValid = allFieldsValid && allGroupsValid && allRulesValid && allMetaValid;

    // * v1: every group carries meta. Legacy: `rules` present is the full-file
    //   signal; a missing rules array is a partial field-only file.
    const rulesComplete = source === "v1" ? true : rawGroups !== null;
    const derivedFull = allFieldsPresent && rulesComplete && metaComplete && allValid;
    const partial = source === "v1" ? declaredPartial || !derivedFull : !derivedFull;

    return {
        source,
        partial,
        ...(exportedAt !== undefined ? { exportedAt } : {}),
        ...(appVersion !== undefined ? { appVersion } : {}),
        fields,
        siteGroups,
        allValid,
    };
}

/**
 * Parses a backup file in the supported formats:
 * v1 envelope → legacy `{ settings }` wrapper → raw settings object.
 *
 * @param text - Raw file text.
 * @returns A discriminant result — never throws.
 */
export function parseSettingsTransfer(text: string): ParseResult {
    let raw: unknown;
    try {
        raw = JSON.parse(text) as unknown;
    } catch (error) {
        return { ok: false, error: { code: "parse", message: String(error) } };
    }

    const record = asRecord(raw);
    if (record === null) return { ok: false, error: { code: "structure" } };

    // * v1 envelope — an unknown format/version is rejected, never best-effort.
    if (hasOwn(record, "format")) {
        if (record.format !== TRANSFER_FORMAT) {
            return { ok: false, error: { code: "unsupportedVersion" } };
        }
        if (record.version !== TRANSFER_VERSION) {
            return { ok: false, error: { code: "unsupportedVersion" } };
        }
        const settingsRecord = asRecord(record.settings);
        if (settingsRecord === null || !Array.isArray(record.siteGroups)) {
            return { ok: false, error: { code: "structure" } };
        }
        const exportedAt = typeof record.exportedAt === "string" ? record.exportedAt : undefined;
        const appVersion = typeof record.appVersion === "string" ? record.appVersion : undefined;
        return {
            ok: true,
            parsed: buildParsed(
                "v1",
                settingsRecord,
                record.siteGroups,
                record.partial === true,
                exportedAt,
                appVersion,
            ),
        };
    }

    // * Legacy wrapper `{ settings: {...} }` (the previous export shape).
    if (hasOwn(record, "settings")) {
        const settingsRecord = asRecord(record.settings);
        if (settingsRecord === null) return { ok: false, error: { code: "structure" } };
        const rawRules = settingsRecord.rules;
        if (rawRules !== undefined && !Array.isArray(rawRules)) {
            return { ok: false, error: { code: "structure" } };
        }
        return {
            ok: true,
            parsed: buildParsed("legacy", settingsRecord, Array.isArray(rawRules) ? rawRules : null, true),
        };
    }

    // * Raw settings object (no wrapper).
    const rawRules = record.rules;
    if (rawRules !== undefined && !Array.isArray(rawRules)) {
        return { ok: false, error: { code: "structure" } };
    }
    const looksLikeSettings = Array.isArray(rawRules) || SETTINGS_FIELDS.some((field) => hasOwn(record, field));
    if (!looksLikeSettings) return { ok: false, error: { code: "structure" } };

    return {
        ok: true,
        parsed: buildParsed("legacy", record, Array.isArray(rawRules) ? rawRules : null, true),
    };
}

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Builds the v1 export envelope from the live settings and the chosen units.
 * The live data is written raw (incomplete/invalid units included on purpose).
 *
 * @param settings - Live settings (unsaved changes included).
 * @param selection - Selected fields/groups/rules.
 * @param meta - Version + timestamp supplied by the GUI (GM_info is GUI-only).
 */
export function buildExportEnvelope(
    settings: Settings,
    selection: TransferSelection,
    meta: { appVersion: string; exportedAt: string },
): TransferEnvelope {
    const selectedFields = new Set(selection.fields);

    const exportedSettings: Partial<Pick<Settings, SettingsField>> = {};
    for (const field of SETTINGS_FIELDS) {
        if (selectedFields.has(field)) {
            (exportedSettings as Record<string, unknown>)[field] = settings[field];
        }
    }

    const siteGroups: TransferGroup[] = [];
    for (const selected of selection.groups) {
        const site = settings.rules[selected.groupIndex];
        if (site === undefined) continue;
        const selectedRules = new Set(selected.rules);
        const rules = site.rules
            .map((rule, ruleIndex) => ({ rule, ruleIndex }))
            .filter(({ ruleIndex }) => selectedRules.has(ruleIndex))
            .map(({ rule, ruleIndex }) => ({ ruleIndex, rule: canonicalRule(rule) }))
            .sort((a, b) => a.ruleIndex - b.ruleIndex);

        if (!selected.meta && rules.length === 0) continue;

        const group: TransferGroup = { siteRegex: site.siteRegex, rules };
        if (selected.meta) {
            group.description = site.description ?? "";
            // * Always a boolean in the meta unit, so a backup restores BOTH states.
            group.disabled = site.disabled === true;
            group.previewEntries = canonicalPreviewEntries(site.previewEntries);
        }
        siteGroups.push(group);
    }

    const allFieldsSelected = SETTINGS_FIELDS.every((field) => selectedFields.has(field));
    const allGroupsComplete = settings.rules.every((site, groupIndex) => {
        const selected = selection.groups.find((entry) => entry.groupIndex === groupIndex);
        if (selected === undefined || !selected.meta) return false;
        return site.rules.every((_, ruleIndex) => selected.rules.includes(ruleIndex));
    });
    const partial = !(allFieldsSelected && allGroupsComplete);

    return {
        format: TRANSFER_FORMAT,
        version: TRANSFER_VERSION,
        exportedAt: meta.exportedAt,
        appVersion: meta.appVersion,
        partial,
        settings: exportedSettings,
        siteGroups,
    };
}

// ─── Matching ─────────────────────────────────────────────────────────────────

/**
 * Matches imported groups to current groups by exact gate — first unused
 * current group wins; duplicates use the next free group.
 *
 * * Single source for `diffTransfer` and `applyMerge` (no divergence).
 */
export function matchGroups(current: SiteRule[], imported: ParsedGroup[]): Array<number | null> {
    const used = new Set<number>();
    return imported.map((group) => {
        for (let index = 0; index < current.length; index++) {
            if (used.has(index)) continue;
            if (current[index].siteRegex === group.siteRegex) {
                used.add(index);
                return index;
            }
        }
        return null;
    });
}

// ─── Diff ─────────────────────────────────────────────────────────────────────

function diffField(field: SettingsField, current: Settings, parsed: ParsedTransfer): FieldDiff {
    const entry = parsed.fields[field];
    if (entry === undefined) {
        return {
            field,
            current: current[field],
            present: false,
            equal: false,
            valid: true,
        };
    }
    return {
        field,
        current: current[field],
        imported: entry.value,
        present: true,
        equal: current[field] === entry.value,
        valid: entry.valid,
        ...(entry.problem !== undefined ? { problem: entry.problem } : {}),
    };
}

function diffMeta(current: SiteRule | undefined, parsed: ParsedGroup): MetaDiff | undefined {
    const meta = parsed.meta;
    if (meta === undefined) return undefined;

    const currentDescription = current?.description?.trim() ?? "";
    const currentEntries = canonicalPreviewEntries(current?.previewEntries);

    const description =
        meta.description !== undefined
            ? {
                  current: currentDescription,
                  imported: meta.description,
                  equal: currentDescription === meta.description,
              }
            : undefined;
    const currentDisabled = current?.disabled === true;
    const disabled =
        meta.disabled !== undefined
            ? {
                  current: currentDisabled,
                  imported: meta.disabled,
                  equal: currentDisabled === meta.disabled,
              }
            : undefined;
    const previewEntries =
        meta.previewEntries !== undefined
            ? {
                  current: currentEntries,
                  imported: meta.previewEntries,
                  equal: samePreviewEntries(current?.previewEntries, meta.previewEntries),
              }
            : undefined;

    const equal =
        (description === undefined || description.equal) &&
        (disabled === undefined || disabled.equal) &&
        (previewEntries === undefined || previewEntries.equal);

    return {
        present: true,
        ...(description !== undefined ? { description } : {}),
        ...(disabled !== undefined ? { disabled } : {}),
        ...(previewEntries !== undefined ? { previewEntries } : {}),
        // * A unit that only exists in the imported file is never "equal".
        equal: current !== undefined && equal,
        valid: meta.valid,
        ...(meta.problem !== undefined ? { problem: meta.problem } : {}),
    };
}

/**
 * Compares the current settings with a parsed file — per field, group, meta,
 * and rule. The group matching is shared with `applyMerge`.
 */
export function diffTransfer(current: Settings, parsed: ParsedTransfer): TransferDiff {
    const fields = SETTINGS_FIELDS.map((field) => diffField(field, current, parsed));
    const matches = matchGroups(current.rules, parsed.siteGroups);
    const matched = new Set<number>();

    const groups = parsed.siteGroups.map((group): GroupDiff => {
        const matchIndex = matches[group.index];
        const currentGroup = matchIndex === null ? undefined : current.rules[matchIndex];
        if (matchIndex !== null) matched.add(matchIndex);

        const usedRuleIndexes = new Set<number>();
        const rules = group.rules.map((entry): RuleDiff => {
            usedRuleIndexes.add(entry.ruleIndex);
            const currentRule =
                currentGroup !== undefined && entry.ruleIndex >= 0 ? currentGroup.rules[entry.ruleIndex] : undefined;
            return {
                ruleIndex: entry.ruleIndex,
                ...(currentRule !== undefined ? { current: currentRule } : {}),
                ...(entry.rule !== undefined ? { imported: entry.rule } : {}),
                ...(entry.raw !== undefined ? { raw: entry.raw } : {}),
                isNew: currentRule === undefined,
                equal: currentRule !== undefined && entry.rule !== undefined && sameRule(currentRule, entry.rule),
                valid: entry.valid,
                ...(entry.problem !== undefined ? { problem: entry.problem } : {}),
            };
        });

        const currentOnlyRules =
            currentGroup === undefined
                ? []
                : currentGroup.rules
                      .map((rule, ruleIndex) => ({ ruleIndex, rule }))
                      .filter(({ ruleIndex }) => !usedRuleIndexes.has(ruleIndex));

        const meta = diffMeta(currentGroup, group);
        const equal =
            currentGroup !== undefined &&
            group.problem === undefined &&
            (meta === undefined || meta.equal) &&
            rules.every((rule) => rule.equal) &&
            currentOnlyRules.length === 0;

        return {
            groupIndex: group.index,
            siteRegex: group.siteRegex,
            matchIndex,
            isNew: matchIndex === null,
            gateValid: group.gateValid,
            valid: group.valid,
            ...(group.problem !== undefined ? { problem: group.problem } : {}),
            ...(meta !== undefined ? { meta } : {}),
            rules,
            currentOnlyRules,
            equal,
        };
    });

    const currentOnlyGroups = current.rules
        .map((site, groupIndex) => ({ groupIndex, site }))
        .filter(({ groupIndex }) => !matched.has(groupIndex));

    return { fields, groups, currentOnlyGroups };
}

// ─── Default selection ────────────────────────────────────────────────────────

/**
 * Merge default: only differing/new VALID units.
 * * A new group with invalid metadata is skipped entirely (its parent cannot
 *   be checked — the parent represents the group).
 */
export function defaultMergeSelection(diff: TransferDiff): TransferSelection {
    const fields = diff.fields
        .filter((field) => field.present && field.valid && !field.equal)
        .map((field) => field.field);

    const groups: TransferSelection["groups"] = [];
    for (const group of diff.groups) {
        // * A group without a usable rule cannot be imported (the parent is
        //   disabled); do not preselect its metadata either.
        if (!group.valid) continue;
        const metaInvalid = group.meta !== undefined && !group.meta.valid;
        if (group.isNew && metaInvalid) continue;

        const rules = group.rules
            .filter((rule) => rule.valid && (group.isNew || !rule.equal))
            .map((rule) => rule.ruleIndex);
        const meta = group.meta !== undefined && group.meta.present && group.meta.valid && !group.meta.equal;

        if (meta || rules.length > 0) {
            groups.push({ groupIndex: group.groupIndex, meta, rules: [...new Set(rules)].sort((a, b) => a - b) });
        }
    }

    return { fields, groups };
}

// ─── Apply ────────────────────────────────────────────────────────────────────

/** Whether the file may replace everything (complete + every unit valid). */
export function isFullAndValid(parsed: ParsedTransfer): boolean {
    return !parsed.partial && parsed.allValid;
}

function applyMeta(target: SiteRule, meta: ParsedMeta | undefined): void {
    if (meta === undefined || !meta.valid) return;
    if (meta.description !== undefined) target.description = meta.description;
    if (meta.disabled !== undefined) {
        if (meta.disabled) target.disabled = true;
        else delete target.disabled;
    }
    if (meta.previewEntries !== undefined) target.previewEntries = cloneJson(meta.previewEntries);
}

/**
 * Non-destructive merge: selected units replace their target; extra current
 * rules/groups are preserved. Missing fields always keep the current value.
 */
export function applyMerge(current: Settings, parsed: ParsedTransfer, selection: TransferSelection): Settings {
    const next = cloneJson(current);
    const selectedFields = new Set(selection.fields);

    for (const field of SETTINGS_FIELDS) {
        if (!selectedFields.has(field)) continue;
        const entry = parsed.fields[field];
        if (entry === undefined || !entry.valid) continue;
        // * Field values are primitives; the cast narrows the union per key.
        (next as unknown as Record<string, unknown>)[field] = entry.value;
    }

    const matches = matchGroups(current.rules, parsed.siteGroups);
    const byGroupIndex = new Map(selection.groups.map((entry) => [entry.groupIndex, entry] as const));

    for (const group of parsed.siteGroups) {
        const selected = byGroupIndex.get(group.index);
        if (selected === undefined) continue;
        if (!group.gateValid) continue;

        const selectedRules = [...new Set(selected.rules)]
            .filter((ruleIndex) => isNonNegativeInteger(ruleIndex))
            .sort((a, b) => a - b);
        const validRules = selectedRules
            .map((ruleIndex) => group.rules.find((entry) => entry.ruleIndex === ruleIndex))
            .filter(
                (entry): entry is ParsedRuleEntry => entry !== undefined && entry.valid && entry.rule !== undefined,
            );

        const matchIndex = matches[group.index];
        if (matchIndex === null) {
            // * New group: metadata only when explicitly selected + valid.
            if (validRules.length === 0 && !selected.meta) continue;
            const site: SiteRule = { siteRegex: group.siteRegex, rules: [] };
            for (const entry of validRules) site.rules.push(cloneJson(entry.rule as UrlRule));
            if (selected.meta) applyMeta(site, group.meta);
            next.rules.push(site);
            continue;
        }

        const target = next.rules[matchIndex];
        if (target === undefined) continue;

        if (selected.meta) applyMeta(target, group.meta);
        for (const entry of validRules) {
            const rule = entry.rule as UrlRule;
            if (entry.ruleIndex < target.rules.length) target.rules[entry.ruleIndex] = cloneJson(rule);
            else target.rules.push(cloneJson(rule));
        }
    }

    // * Selection indexes stay stable: merge only replaces/appends.
    if (current.lastSelection !== undefined) next.lastSelection = { ...current.lastSelection };
    return next;
}

/**
 * Full replacement — only for a complete, fully valid file.
 *
 * ! Always sets `rules` explicitly (even `[]`): a missing rules array makes
 *   `normalizeSettings` fall back to the example rule list.
 *
 * @returns The complete Settings object, or null when replace is not allowed.
 */
export function applyReplace(parsed: ParsedTransfer): Settings | null {
    if (!isFullAndValid(parsed)) return null;

    const values: Record<string, unknown> = {};
    for (const field of SETTINGS_FIELDS) {
        const entry = parsed.fields[field];
        if (entry === undefined || !entry.valid) return null;
        values[field] = entry.value;
    }

    const rules: SiteRule[] = parsed.siteGroups.map((group) => {
        const siteRules = [...group.rules]
            .sort((a, b) => a.ruleIndex - b.ruleIndex)
            .map((entry) => cloneJson(entry.rule as UrlRule));
        const site: SiteRule = { siteRegex: group.siteRegex, rules: siteRules };
        if (group.meta?.description !== undefined) site.description = group.meta.description;
        if (group.meta?.disabled === true) site.disabled = true;
        if (group.meta?.previewEntries !== undefined) site.previewEntries = cloneJson(group.meta.previewEntries);
        return site;
    });

    return {
        locale: values.locale as Settings["locale"],
        logLevel: values.logLevel as Settings["logLevel"],
        performanceMode: values.performanceMode as boolean,
        theme: values.theme as Settings["theme"],
        motion: values.motion as Settings["motion"],
        hideSkipped: false,
        dashboardHost: values.dashboardHost as Settings["dashboardHost"],
        autosaveDelayMs: values.autosaveDelayMs as number,
        rules,
    };
}
