// ─────────────────────────────────────────────────────────────────────────────
// MARK: Settings transfer view — testable row/label/selection derivations
// ─────────────────────────────────────────────────────────────────────────────
// * Pure GUI-side mapping (no Svelte): labels/values, merge-vs-current rows,
//   parent tri-state, filtering, and selection helpers for the dialog.
// * The translation function is injected so tests can run without the i18n
//   store; the component passes `t` from i18n.svelte.

import { isValidRegex, regexToReadableLiteral } from "../core/parse-regex";
import type { PreviewEntry, Settings, SiteRule, UrlRule } from "../core/settings";
import {
    ruleProblem,
    SETTINGS_FIELDS,
    type GroupDiff,
    type RuleDiff,
    type SettingsField,
    type TransferDiff,
    type TransferProblem,
    type TransferSelection,
} from "../core/settings-transfer";
import { siteCaption } from "./site-caption";

/** Translation function injected by the component. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

// ─── Row shapes ───────────────────────────────────────────────────────────────

export interface FieldRow {
    field: SettingsField;
    label: string;
    current: string;
    imported?: string;
    present: boolean;
    equal: boolean;
    valid: boolean;
    problem?: TransferProblem;
}

export interface MetaRow {
    present: boolean;
    valid: boolean;
    problem?: TransferProblem;
    equal: boolean;
    currentDescription: string;
    importedDescription?: string;
    currentDisabled: boolean;
    importedDisabled?: boolean;
    currentTests: number;
    importedTests?: number;
}

export interface RuleRow {
    ruleIndex: number;
    indexLabel: string;
    kindLabel: string;
    current?: string;
    imported?: string;
    isNew: boolean;
    equal: boolean;
    valid: boolean;
    problem?: TransferProblem;
    /** Current-only row ("stays") — never selectable. */
    currentOnly: boolean;
}

export interface GroupRow {
    groupIndex: number;
    key: string;
    siteRegex: string;
    caption: string;
    matchIndex: number | null;
    isNew: boolean;
    gateValid: boolean;
    valid: boolean;
    problem?: TransferProblem;
    meta?: MetaRow;
    rules: RuleRow[];
    currentOnlyRules: RuleRow[];
}

export interface CurrentOnlyGroupRow {
    currentGroupIndex: number;
    siteRegex: string;
    caption: string;
    ruleCount: number;
    testCount: number;
}

export interface TransferRows {
    fields: FieldRow[];
    groups: GroupRow[];
    currentOnlyGroups: CurrentOnlyGroupRow[];
}

export type CheckState = "checked" | "indeterminate" | "unchecked";

// ─── Labels / values ──────────────────────────────────────────────────────────

/** Field label key (reuses the existing Settings-tab labels). */
export function fieldLabel(field: SettingsField, t: Translate): string {
    if (field === "locale") return t("system.locale");
    if (field === "autosaveDelayMs") return t("autosave.speed");
    if (field === "theme") return t("system.theme");
    if (field === "motion") return t("system.motion");
    if (field === "logLevel") return t("system.logLevel");
    if (field === "performanceMode") return t("system.performanceMode");
    return t("system.dashboardHost");
}

/** Human-read value for one settings field. */
export function formatFieldValue(field: SettingsField, value: unknown, t: Translate): string {
    if (value === undefined) return "—";
    if (field === "locale") return value === "de" ? "Deutsch" : value === "en" ? "English" : "Auto";
    if (field === "logLevel") return t(`system.logLevel.${String(value)}`);
    if (field === "performanceMode")
        return t(value === true ? "system.performanceMode.on" : "system.performanceMode.off");
    if (field === "theme") return t(`theme.${String(value)}`);
    if (field === "motion") return t(`motion.${String(value)}`);
    if (field === "dashboardHost") return t(`system.dashboardHost.${String(value)}`);
    if (field === "autosaveDelayMs") {
        const ms = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(ms)) return "—";
        return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
    }
    return String(value);
}

/** One-line rule summary (monospace-friendly). */
export function formatRule(rule: UrlRule): string {
    if (rule.kind === "replace") return `${rule.regex || "—"} → ${rule.substitution || "—"}`;
    if (rule.kind === "appendQuery") return `${rule.params || "—"}${rule.regex ? ` @ ${rule.regex}` : ""}`;
    if (rule.kind === "removeQuery") return `${rule.keys || "—"}${rule.regex ? ` @ ${rule.regex}` : ""}`;
    if (rule.kind === "unwrap") return rule.regex || "—";
    return `${rule.regex || "—"} (${rule.mode})`;
}

function rawRuleSummary(raw: unknown): string | undefined {
    if (typeof raw !== "object" || raw === null) return undefined;
    const record = raw as Record<string, unknown>;
    const parts = [record.regex, record.substitution, record.params, record.keys, record.mode].filter(
        (part): part is string => typeof part === "string" && part !== "",
    );
    return parts.length > 0 ? parts.join(" ") : undefined;
}

function ruleKindLabel(rule: UrlRule | undefined, raw: unknown, t: Translate): string {
    const kind =
        rule?.kind ?? (typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).kind : undefined);
    if (
        kind === "replace" ||
        kind === "appendQuery" ||
        kind === "removeQuery" ||
        kind === "checkpoint" ||
        kind === "unwrap"
    ) {
        return t(`rules.kindShort.${kind}`);
    }
    return "—";
}

function metaRowFromDiff(group: GroupDiff): MetaRow | undefined {
    if (group.meta === undefined) return undefined;
    return {
        present: group.meta.present,
        valid: group.meta.valid,
        ...(group.meta.problem !== undefined ? { problem: group.meta.problem } : {}),
        equal: group.meta.equal,
        currentDescription: group.meta.description?.current ?? "",
        ...(group.meta.description !== undefined ? { importedDescription: group.meta.description.imported } : {}),
        currentDisabled: group.meta.disabled?.current ?? false,
        ...(group.meta.disabled !== undefined ? { importedDisabled: group.meta.disabled.imported } : {}),
        currentTests: group.meta.previewEntries?.current.length ?? 0,
        ...(group.meta.previewEntries !== undefined
            ? { importedTests: group.meta.previewEntries.imported.length }
            : {}),
    };
}

function buildRuleRows(group: GroupDiff, t: Translate): RuleRow[] {
    return group.rules.map((rule) => toRuleRow(rule, t));
}

function toRuleRow(rule: RuleDiff, t: Translate): RuleRow {
    return {
        ruleIndex: rule.ruleIndex,
        indexLabel: `#${rule.ruleIndex + 1}`,
        kindLabel: ruleKindLabel(rule.imported, rule.raw, t),
        ...(rule.current !== undefined ? { current: formatRule(rule.current) } : {}),
        ...(rule.imported !== undefined
            ? { imported: formatRule(rule.imported) }
            : rule.raw !== undefined
              ? { imported: rawRuleSummary(rule.raw) }
              : {}),
        isNew: rule.isNew,
        equal: rule.equal,
        valid: rule.valid,
        ...(rule.problem !== undefined ? { problem: rule.problem } : {}),
        currentOnly: false,
    };
}

function currentOnlyRuleRows(group: GroupDiff): RuleRow[] {
    return group.currentOnlyRules.map(({ rule, ruleIndex }) => ({
        ruleIndex,
        indexLabel: `#${ruleIndex + 1}`,
        kindLabel: "",
        current: formatRule(rule),
        isNew: false,
        equal: true,
        valid: true,
        currentOnly: true,
    }));
}

function groupCaptionFor(site: SiteRule | undefined, group: GroupDiff): string {
    if (site !== undefined) return siteCaption(site);
    const description = group.meta?.description?.imported.trim() ?? "";
    return description !== "" ? description : regexToReadableLiteral(group.siteRegex) || "—";
}

/**
 * Builds merge rows (current left, imported right) from the diff.
 * Current-only groups/rules are marked non-selectable "stays" rows.
 */
export function buildMergeRows(current: Settings, diff: TransferDiff, t: Translate): TransferRows {
    const fields: FieldRow[] = diff.fields.map((field) => ({
        field: field.field,
        label: fieldLabel(field.field, t),
        current: formatFieldValue(field.field, field.current, t),
        ...(field.present ? { imported: formatFieldValue(field.field, field.imported, t) } : {}),
        present: field.present,
        equal: field.equal,
        valid: field.valid,
        ...(field.problem !== undefined ? { problem: field.problem } : {}),
    }));

    const groups: GroupRow[] = diff.groups.map((group) => {
        const currentSite = group.matchIndex === null ? undefined : current.rules[group.matchIndex];
        return {
            groupIndex: group.groupIndex,
            key: `imported-${group.groupIndex}`,
            siteRegex: group.siteRegex,
            caption: groupCaptionFor(currentSite, group),
            matchIndex: group.matchIndex,
            isNew: group.isNew,
            gateValid: group.gateValid,
            valid: group.valid,
            ...(group.problem !== undefined ? { problem: group.problem } : {}),
            ...(group.meta !== undefined ? { meta: metaRowFromDiff(group) } : {}),
            rules: buildRuleRows(group, t),
            currentOnlyRules: currentOnlyRuleRows(group),
        };
    });

    const currentOnlyGroups: CurrentOnlyGroupRow[] = diff.currentOnlyGroups.map(({ groupIndex, site }) => ({
        currentGroupIndex: groupIndex,
        siteRegex: site.siteRegex,
        caption: siteCaption(site),
        ruleCount: site.rules.length,
        testCount: site.previewEntries?.length ?? 0,
    }));

    return { fields, groups, currentOnlyGroups };
}

function liveRuleProblem(rule: UrlRule): TransferProblem | null {
    return ruleProblem(rule);
}

/** Builds export rows (one current column) from the live settings. */
export function buildExportRows(settings: Settings, t: Translate): TransferRows {
    const fields: FieldRow[] = SETTINGS_FIELDS.map((field) => ({
        field,
        label: fieldLabel(field, t),
        current: formatFieldValue(field, settings[field], t),
        present: true,
        equal: true,
        valid: true,
    }));

    const groups: GroupRow[] = settings.rules.map((site, groupIndex) => {
        const gateValid = site.siteRegex !== "" && isValidRegex(site.siteRegex);
        const gateProblem: TransferProblem | undefined =
            site.siteRegex === "" ? "empty" : !gateValid ? "regex" : undefined;
        const rules: RuleRow[] = site.rules.map((rule, ruleIndex) => {
            const problem = liveRuleProblem(rule);
            return {
                ruleIndex,
                indexLabel: `#${ruleIndex + 1}`,
                kindLabel: t(`rules.kindShort.${rule.kind}`),
                current: formatRule(rule),
                isNew: false,
                equal: true,
                valid: problem === null,
                ...(problem !== null ? { problem } : {}),
                currentOnly: false,
            };
        });
        return {
            groupIndex,
            key: `current-${groupIndex}`,
            siteRegex: site.siteRegex,
            caption: siteCaption(site),
            matchIndex: groupIndex,
            isNew: false,
            gateValid,
            valid: gateValid && rules.length > 0,
            ...(gateProblem !== undefined ? { problem: gateProblem } : {}),
            meta: {
                present: true,
                valid: true,
                equal: true,
                currentDescription: site.description?.trim() ?? "",
                currentDisabled: site.disabled === true,
                currentTests: site.previewEntries?.length ?? 0,
            },
            rules,
            currentOnlyRules: [],
        };
    });

    return { fields, groups, currentOnlyGroups: [] };
}

// ─── Field sections ───────────────────────────────────────────────────────────

export interface FieldSection {
    id: "general" | "appearance" | "advanced";
    label: string;
    fields: FieldRow[];
}

/** Splits field rows into the three Settings-tab sections. */
export function buildFieldSections(rows: FieldRow[], t: Translate): FieldSection[] {
    const byField = new Map(rows.map((row) => [row.field, row] as const));
    const pick = (fields: SettingsField[]): FieldRow[] =>
        fields.map((field) => byField.get(field)).filter((row): row is FieldRow => row !== undefined);

    return [
        { id: "general", label: t("system.group.settings"), fields: pick(["locale", "autosaveDelayMs"]) },
        { id: "appearance", label: t("system.group.appearance"), fields: pick(["theme", "motion"]) },
        {
            id: "advanced",
            label: t("system.group.advanced"),
            fields: pick(["logLevel", "performanceMode", "dashboardHost"]),
        },
    ];
}

// ─── Selection helpers ────────────────────────────────────────────────────────

/** Parent tri-state from selected/total child count. */
export function checkState(selected: number, total: number): CheckState {
    if (total <= 0 || selected <= 0) return "unchecked";
    if (selected >= total) return "checked";
    return "indeterminate";
}

export function isFieldSelected(selection: TransferSelection, field: SettingsField): boolean {
    return selection.fields.includes(field);
}

function groupSelection(selection: TransferSelection, groupIndex: number): TransferSelection["groups"][number] {
    const existing = selection.groups.find((entry) => entry.groupIndex === groupIndex);
    return existing ?? { groupIndex, meta: false, rules: [] };
}

function replaceGroupSelection(
    selection: TransferSelection,
    groupIndex: number,
    next: TransferSelection["groups"][number],
): TransferSelection {
    const groups = selection.groups.filter((entry) => entry.groupIndex !== groupIndex);
    if (next.meta || next.rules.length > 0) groups.push(next);
    return { fields: [...selection.fields], groups };
}

export function isRuleSelected(selection: TransferSelection, groupIndex: number, ruleIndex: number): boolean {
    return groupSelection(selection, groupIndex).rules.includes(ruleIndex);
}

export function isMetaSelected(selection: TransferSelection, groupIndex: number): boolean {
    return groupSelection(selection, groupIndex).meta;
}

/** Selectable rules: valid and backed by an imported unit (not current-only). */
export function selectableRules(group: GroupRow): RuleRow[] {
    return group.rules.filter((rule) => rule.valid && !rule.currentOnly);
}

/** Whether the group metadata can be selected (present + valid). */
export function metaSelectable(group: GroupRow): boolean {
    return group.meta !== undefined && group.meta.present && group.meta.valid;
}

/** Whether the whole-group parent control is disabled. */
export function groupParentDisabled(group: GroupRow): boolean {
    // * No usable rule = group not importable (metadata alone is not a group).
    if (!group.valid) return true;
    if (group.meta !== undefined && !group.meta.valid) return true;
    return false;
}

/** Whether one rule checkbox is locked (new group not yet enabled). */
export function ruleCheckboxDisabled(group: GroupRow, selection: TransferSelection, rule: RuleRow): boolean {
    if (!rule.valid || rule.currentOnly) return true;
    if (!group.gateValid) return true;
    // * An invalid meta unit blocks creating a NEW group (the parent owns it).
    if (group.isNew && group.meta !== undefined && !group.meta.valid) return true;
    // * A new group has no target until its parent is enabled once.
    if (group.isNew && groupCheckState(group, selection) === "unchecked") return true;
    return false;
}

/** Parent tri-state counts, optionally restricted to the visible children. */
export interface GroupUnitCounts {
    selected: number;
    total: number;
}

/** Counts over one group, optional visible subset included. */
export function groupUnitCounts(
    group: GroupRow,
    selection: TransferSelection,
    visibleRules?: RuleRow[],
    metaVisible = true,
): GroupUnitCounts {
    const visible = visibleRules === undefined ? null : new Set(visibleRules.map((rule) => rule.ruleIndex));
    const rules = selectableRules(group).filter((rule) => visible === null || visible.has(rule.ruleIndex));
    // * Meta has no checkbox of its own; count it only when it is the sole unit.
    const metaCounts = metaSelectable(group) && metaVisible && rules.length === 0;
    const entry = groupSelection(selection, group.groupIndex);
    const selectedRules = rules.filter((rule) => entry.rules.includes(rule.ruleIndex)).length;
    return {
        selected: selectedRules + (metaCounts && entry.meta ? 1 : 0),
        total: rules.length + (metaCounts ? 1 : 0),
    };
}

/** Parent state of one group (meta counts as one unit when selectable). */
export function groupCheckState(
    group: GroupRow,
    selection: TransferSelection,
    visibleRules?: RuleRow[],
    metaVisible = true,
): CheckState {
    const counts = groupUnitCounts(group, selection, visibleRules, metaVisible);
    return checkState(counts.selected, counts.total);
}

/** Parent state of one settings section. */
export function sectionCheckState(rows: FieldRow[], selection: TransferSelection): CheckState {
    const selectable = rows.filter((row) => row.present && row.valid);
    const selected = selectable.filter((row) => isFieldSelected(selection, row.field)).length;
    return checkState(selected, selectable.length);
}

export function toggleField(selection: TransferSelection, field: SettingsField, checked: boolean): TransferSelection {
    const fields = new Set(selection.fields);
    if (checked) fields.add(field);
    else fields.delete(field);
    return { fields: SETTINGS_FIELDS.filter((candidate) => fields.has(candidate)), groups: [...selection.groups] };
}

export function toggleFieldSection(
    selection: TransferSelection,
    rows: FieldRow[],
    checked: boolean,
): TransferSelection {
    const selectable = rows.filter((row) => row.present && row.valid);
    const fields = new Set(selection.fields);
    for (const row of selectable) {
        if (checked) fields.add(row.field);
        else fields.delete(row.field);
    }
    return { fields: SETTINGS_FIELDS.filter((candidate) => fields.has(candidate)), groups: [...selection.groups] };
}

/** Parent toggle: checked selects all selectable rules + valid meta. */
export function toggleGroup(selection: TransferSelection, group: GroupRow, checked: boolean): TransferSelection {
    if (!checked) {
        return replaceGroupSelection(selection, group.groupIndex, {
            groupIndex: group.groupIndex,
            meta: false,
            rules: [],
        });
    }
    const rules = selectableRules(group).map((rule) => rule.ruleIndex);
    const meta = metaSelectable(group);
    return replaceGroupSelection(selection, group.groupIndex, {
        groupIndex: group.groupIndex,
        meta,
        rules,
    });
}

/**
 * Rule toggle. Unchecking any rule from a fully checked parent drops `meta`
 * (partial selection = rules only, metadata untouched).
 */
export function toggleGroupRule(
    selection: TransferSelection,
    group: GroupRow,
    ruleIndex: number,
    checked: boolean,
): TransferSelection {
    const entry = groupSelection(selection, group.groupIndex);
    const rules = new Set(entry.rules);
    if (checked) rules.add(ruleIndex);
    else rules.delete(ruleIndex);

    const allSelectable = selectableRules(group);
    const allChecked = allSelectable.length > 0 && allSelectable.every((rule) => rules.has(rule.ruleIndex));
    const meta = allChecked && entry.meta && metaSelectable(group);

    return replaceGroupSelection(selection, group.groupIndex, {
        groupIndex: group.groupIndex,
        meta,
        rules: [...rules].sort((a, b) => a - b),
    });
}

/** Selected unit count shown on the Apply button (meta counts once). */
export function selectedUnitCount(rows: TransferRows, selection: TransferSelection): number {
    const fields = new Set(selection.fields);
    let count = rows.fields.filter((row) => fields.has(row.field)).length;
    count += selection.groups.reduce((sum, entry) => sum + entry.rules.length + (entry.meta ? 1 : 0), 0);
    return count;
}

/** Inputs for the dialog's Apply gating. */
export interface ApplyState {
    mode: "export" | "import";
    importMode: "merge" | "replace";
    hasError: boolean;
    parsed: boolean;
    replaceAllowed: boolean;
    selectedUnits: number;
}

/**
 * Whether the dialog's Apply action stays disabled.
 *
 * * Replace ignores the row selection (its checkboxes are hidden), so an empty
 *   selection must not block it; a partial/invalid file still must.
 */
export function isApplyDisabled(state: ApplyState): boolean {
    if (state.hasError) return true;
    if (state.mode === "import") {
        if (!state.parsed) return true;
        if (state.importMode === "replace") return !state.replaceAllowed;
    }
    return state.selectedUnits === 0;
}

/** Whether the selection contains an invalid (export-marked) unit. */
export function selectionHasInvalid(rows: TransferRows, selection: TransferSelection): boolean {
    const fields = new Set(selection.fields);
    if (rows.fields.some((row) => fields.has(row.field) && !row.valid)) return true;
    for (const entry of selection.groups) {
        const group = rows.groups.find((candidate) => candidate.groupIndex === entry.groupIndex);
        if (group === undefined) continue;
        if ((entry.meta || entry.rules.length > 0) && !group.valid) return true;
        if (group.rules.some((rule) => entry.rules.includes(rule.ruleIndex) && !rule.valid)) return true;
        if (entry.meta && group.meta !== undefined && !group.meta.valid) return true;
    }
    return false;
}

/** Full export selection: every field, every group meta + every rule. */
export function fullExportSelection(settings: Settings): TransferSelection {
    return {
        fields: [...SETTINGS_FIELDS],
        groups: settings.rules.map((site, groupIndex) => ({
            groupIndex,
            meta: true,
            rules: site.rules.map((_, ruleIndex) => ruleIndex),
        })),
    };
}

/** Import "All": every selectable unit (invalid units stay excluded). */
export function allSelectableSelection(rows: TransferRows): TransferSelection {
    const fields = rows.fields.filter((row) => row.present && row.valid).map((row) => row.field);
    const groups: TransferSelection["groups"] = [];
    for (const group of rows.groups) {
        if (groupParentDisabled(group)) continue;
        const rules = selectableRules(group).map((rule) => rule.ruleIndex);
        const meta = metaSelectable(group);
        if (meta || rules.length > 0) groups.push({ groupIndex: group.groupIndex, meta, rules });
    }
    return { fields, groups };
}

/** Empty selection (the "None" button). */
export function emptySelection(): TransferSelection {
    return { fields: [], groups: [] };
}

// ─── Filtering ────────────────────────────────────────────────────────────────

/** Selection key helpers — the dialog tracks "touched" units for the filter. */
export function fieldKey(field: SettingsField): string {
    return `field:${field}`;
}

export function metaKey(groupIndex: number): string {
    return `group:${groupIndex}:meta`;
}

export function ruleKey(groupIndex: number, ruleIndex: number): string {
    return `group:${groupIndex}:rule:${ruleIndex}`;
}

/** "Only differences": identical, unselected rows are hidden (invalid stays). */
export function filterFieldRows(
    rows: FieldRow[],
    selection: TransferSelection,
    onlyDifferences: boolean,
    isTouched: (key: string) => boolean = () => false,
): FieldRow[] {
    if (!onlyDifferences) return rows;
    // * Current-only fields stay visible: an unchecked "stays" row is still
    //   information the user asked to see. Only identical imported rows hide.
    return rows.filter(
        (row) =>
            !row.present ||
            !row.equal ||
            !row.valid ||
            isFieldSelected(selection, row.field) ||
            isTouched(fieldKey(row.field)),
    );
}

export interface FilteredGroup {
    group: GroupRow;
    rules: RuleRow[];
    metaVisible: boolean;
}

/** Filtered group view — touched rows stay visible even after unchecking. */
export function filterGroupRows(
    rows: GroupRow[],
    selection: TransferSelection,
    onlyDifferences: boolean,
    isTouched: (key: string) => boolean = () => false,
): FilteredGroup[] {
    const result: FilteredGroup[] = [];
    for (const group of rows) {
        const rules = onlyDifferences
            ? group.rules.filter(
                  (rule) =>
                      group.isNew ||
                      !rule.equal ||
                      !rule.valid ||
                      isRuleSelected(selection, group.groupIndex, rule.ruleIndex) ||
                      isTouched(ruleKey(group.groupIndex, rule.ruleIndex)),
              )
            : group.rules;
        // * "stays" rows are never hidden by the differences filter anymore.
        const currentOnlyRules = group.currentOnlyRules;
        const metaVisible =
            group.meta !== undefined &&
            (!onlyDifferences ||
                group.isNew ||
                !group.meta.equal ||
                isMetaSelected(selection, group.groupIndex) ||
                !group.meta.valid ||
                isTouched(metaKey(group.groupIndex)));

        const visible = group.isNew || rules.length > 0 || currentOnlyRules.length > 0 || metaVisible;
        if (!visible) continue;
        result.push({ group, rules, metaVisible });
    }
    return result;
}

/** Whether preview entries carry any entry (export/meta summary). */
export function hasTests(entries: PreviewEntry[] | undefined): boolean {
    return (entries?.length ?? 0) > 0;
}
