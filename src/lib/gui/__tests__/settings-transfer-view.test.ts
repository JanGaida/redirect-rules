import { describe, expect, it } from "vitest";
import type { Settings, SiteRule } from "../../core/settings";
import { diffTransfer, parseSettingsTransfer, TRANSFER_FORMAT, TRANSFER_VERSION } from "../../core/settings-transfer";
import {
    buildExportRows,
    buildFieldSections,
    buildMergeRows,
    checkState,
    filterFieldRows,
    filterGroupRows,
    fullExportSelection,
    groupCheckState,
    groupParentDisabled,
    isApplyDisabled,
    isRuleSelected,
    ruleCheckboxDisabled,
    sectionCheckState,
    selectedUnitCount,
    selectionHasInvalid,
    toggleField,
    toggleFieldSection,
    toggleGroup,
    toggleGroupRule,
    type Translate,
} from "../settings-transfer-view";

const t: Translate = (key) => key;

function makeSettings(rules: SiteRule[]): Settings {
    return {
        locale: "en",
        logLevel: "info",
        performanceMode: false,
        theme: "auto",
        motion: "normal",
        hideSkipped: false,
        dashboardHost: "fixed",
        autosaveDelayMs: 2000,
        rules,
    };
}

const RULE_A = { kind: "replace", regex: "/a/", substitution: "b" } as const;
const RULE_B = { kind: "replace", regex: "/b/", substitution: "c" } as const;

function envelope(settings: unknown, siteGroups: unknown, partial = true): string {
    return JSON.stringify({
        format: TRANSFER_FORMAT,
        version: TRANSFER_VERSION,
        exportedAt: "2026-11-03T22:00:00.000Z",
        appVersion: "1",
        partial,
        settings,
        siteGroups,
    });
}

function parsed(text: string) {
    const result = parseSettingsTransfer(text);
    if (!result.ok) throw new Error(result.error.code);
    return result.parsed;
}

describe("field rows / sections", () => {
    it("splits fields into the three settings sections", () => {
        const rows = buildExportRows(makeSettings([]), t).fields;
        const sections = buildFieldSections(rows, t);
        expect(sections.map((section) => section.id)).toEqual(["general", "appearance", "advanced"]);
        expect(sections[0].fields.map((row) => row.field)).toEqual(["locale", "autosaveDelayMs"]);
        expect(sections[1].fields.map((row) => row.field)).toEqual(["theme", "motion"]);
        expect(sections[2].fields.map((row) => row.field)).toEqual(["logLevel", "performanceMode", "dashboardHost"]);
    });

    it("formats enum and delay values", () => {
        const rows = buildExportRows(makeSettings([]), t).fields;
        expect(rows.find((row) => row.field === "locale")?.current).toBe("English");
        expect(rows.find((row) => row.field === "autosaveDelayMs")?.current).toBe("2 s");
        expect(rows.find((row) => row.field === "theme")?.current).toBe("theme.auto");
    });

    it("formats the performance-mode boolean as Enabled/Disabled", () => {
        const off = buildExportRows(makeSettings([]), t).fields;
        expect(off.find((row) => row.field === "performanceMode")?.current).toBe("system.performanceMode.off");
        const on = buildExportRows({ ...makeSettings([]), performanceMode: true }, t).fields;
        expect(on.find((row) => row.field === "performanceMode")?.current).toBe("system.performanceMode.on");
    });

    it("computes section tri-state", () => {
        const rows = buildExportRows(makeSettings([]), t).fields;
        const section = buildFieldSections(rows, t)[0].fields;
        const empty = { fields: [], groups: [] };
        expect(sectionCheckState(section, empty)).toBe("unchecked");
        expect(sectionCheckState(section, { fields: ["locale"], groups: [] })).toBe("indeterminate");
        expect(sectionCheckState(section, { fields: ["locale", "autosaveDelayMs"], groups: [] })).toBe("checked");
        // * Visible-only parent: hidden equal rows must not keep it indeterminate.
        const visible = section.filter((row) => row.field === "locale");
        expect(sectionCheckState(visible, { fields: ["locale"], groups: [] })).toBe("checked");

        const all = toggleFieldSection(empty, section, true);
        expect(all.fields).toEqual(expect.arrayContaining(["locale", "autosaveDelayMs"]));
        expect(toggleField(all, "locale", false).fields).toEqual(["autosaveDelayMs"]);
    });

    it("hides unchanged imported fields only in differences mode", () => {
        const current = makeSettings([]);
        const diff = diffTransfer(
            current,
            parsed(
                envelope(
                    {
                        locale: "en",
                        logLevel: "info",
                        theme: "dark",
                        motion: "normal",
                        dashboardHost: "fixed",
                        autosaveDelayMs: 2000,
                    },
                    [],
                ),
            ),
        );
        const rows = buildMergeRows(current, diff, t).fields;

        expect(filterFieldRows(rows, { fields: [], groups: [] }, false)).toHaveLength(rows.length);
        expect(filterFieldRows(rows, { fields: [], groups: [] }, true).map((row) => row.field)).toEqual([
            "performanceMode",
            "theme",
        ]);
    });

    it("keeps current-only fields visible and reveals touched equal fields", () => {
        const current = makeSettings([]);
        const diff = diffTransfer(current, parsed(envelope({ locale: "de", theme: "auto" }, [])));
        const rows = buildMergeRows(current, diff, t).fields;

        // * Missing values are "stays" information — never hidden.
        const visible = filterFieldRows(rows, { fields: [], groups: [] }, true);
        expect(visible).toHaveLength(rows.length - 1);
        expect(visible.some((row) => row.field === "theme")).toBe(false);
        expect(visible.some((row) => row.field === "motion" && !row.present)).toBe(true);
        // * An identical imported field the user touched stays visible when unchecked.
        const identical = rows.find((row) => row.field === "theme")!;
        expect(identical.equal).toBe(true);
        expect(filterFieldRows([identical], { fields: [], groups: [] }, true)).toHaveLength(0);
        expect(
            filterFieldRows([identical], { fields: [], groups: [] }, true, (key) => key === "field:theme"),
        ).toHaveLength(1);
    });
});

describe("merge rows", () => {
    it("marks matched, changed, invalid, and current-only rules", () => {
        const current = makeSettings([
            {
                siteRegex: "/g/",
                rules: [RULE_A, RULE_B],
            },
        ]);
        const transfer = parsed(
            envelope({}, [
                {
                    siteRegex: "/g/",
                    rules: [
                        { ruleIndex: 0, rule: { kind: "replace", regex: "/a/", substitution: "changed" } },
                        { ruleIndex: 1, rule: { kind: "replace", regex: "/(bad/", substitution: "x" } },
                    ],
                },
            ]),
        );
        const rows = buildMergeRows(current, diffTransfer(current, transfer), t);
        const group = rows.groups[0];

        expect(group.matchIndex).toBe(0);
        expect(group.isNew).toBe(false);
        expect(group.rules[0]).toMatchObject({ equal: false, valid: true, current: "/a/ → b" });
        expect(group.rules[1]).toMatchObject({ equal: false, valid: false, problem: "regex" });
        expect(group.currentOnlyRules).toEqual([]);
    });

    it("shows current-only groups as non-selectable stays rows", () => {
        const current = makeSettings([{ siteRegex: "/local/", rules: [RULE_A] }]);
        const transfer = parsed(envelope({}, [{ siteRegex: "/new/", rules: [{ ruleIndex: 0, rule: RULE_A }] }]));
        const rows = buildMergeRows(current, diffTransfer(current, transfer), t);
        expect(rows.currentOnlyGroups).toEqual([
            { currentGroupIndex: 0, siteRegex: "/local/", caption: expect.any(String), ruleCount: 1, testCount: 0 },
        ]);
        // * Current-only groups never appear as selectable imported groups.
        expect(rows.groups.map((group) => group.groupIndex)).toEqual([0]);
    });

    it("keeps current-only rows visible in differences mode", () => {
        const current = makeSettings([{ siteRegex: "/g/", rules: [RULE_A, RULE_B] }]);
        const transfer = parsed(envelope({}, [{ siteRegex: "/g/", rules: [{ ruleIndex: 0, rule: RULE_A }] }]));
        const rows = buildMergeRows(current, diffTransfer(current, transfer), t);
        const all = filterGroupRows(rows.groups, { fields: [], groups: [] }, false);
        const onlyDiff = filterGroupRows(rows.groups, { fields: [], groups: [] }, true);

        expect(all[0].rules).toHaveLength(1);
        expect(all[0].group.currentOnlyRules.map((rule) => rule.indexLabel)).toEqual(["#2"]);
        // * Equal imported rule hides; the current-only "stays" row remains.
        expect(onlyDiff[0].rules).toEqual([]);
        expect(onlyDiff[0].group.currentOnlyRules.map((rule) => rule.indexLabel)).toEqual(["#2"]);
    });

    it("keeps a touched, unchecked rule visible", () => {
        const current = makeSettings([{ siteRegex: "/g/", rules: [RULE_A] }]);
        const transfer = parsed(envelope({}, [{ siteRegex: "/g/", rules: [{ ruleIndex: 0, rule: RULE_A }] }]));
        const rows = buildMergeRows(current, diffTransfer(current, transfer), t);
        const empty = { fields: [], groups: [] };

        expect(filterGroupRows(rows.groups, empty, true)).toEqual([]);
        const touched = filterGroupRows(rows.groups, empty, true, (key) => key === "group:0:rule:0");
        expect(touched).toHaveLength(1);
        expect(touched[0].rules).toHaveLength(1);
    });

    it("surfaces the group enable/disable state in the meta row", () => {
        const current = makeSettings([{ siteRegex: "/g/", rules: [RULE_A] }]);
        const transfer = parsed(
            envelope({}, [
                {
                    siteRegex: "/g/",
                    description: "",
                    disabled: true,
                    previewEntries: [],
                    rules: [{ ruleIndex: 0, rule: RULE_A }],
                },
            ]),
        );
        const rows = buildMergeRows(current, diffTransfer(current, transfer), t);
        expect(rows.groups[0].meta).toMatchObject({
            currentDisabled: false,
            importedDisabled: true,
            equal: false,
        });
    });
});

describe("selection helpers", () => {
    it("implements parent tri-state and new-group locking", () => {
        const current = makeSettings([]);
        const transfer = parsed(
            envelope({}, [
                {
                    siteRegex: "/new/",
                    rules: [
                        { ruleIndex: 0, rule: RULE_A },
                        { ruleIndex: 1, rule: RULE_B },
                    ],
                },
            ]),
        );
        const group = buildMergeRows(current, diffTransfer(current, transfer), t).groups[0];
        const empty = { fields: [], groups: [] };

        expect(checkState(0, 2)).toBe("unchecked");
        expect(checkState(1, 2)).toBe("indeterminate");
        expect(checkState(2, 2)).toBe("checked");
        expect(groupCheckState(group, empty)).toBe("unchecked");
        expect(ruleCheckboxDisabled(group, empty, group.rules[0])).toBe(true);

        const enabled = toggleGroup(empty, group, true);
        expect(groupCheckState(group, enabled)).toBe("checked");
        expect(isRuleSelected(enabled, 0, 1)).toBe(true);
        expect(ruleCheckboxDisabled(group, enabled, group.rules[0])).toBe(false);

        const partial = toggleGroupRule(enabled, group, 1, false);
        expect(groupCheckState(group, partial)).toBe("indeterminate");
        expect(partial.groups[0]).toEqual({ groupIndex: 0, meta: false, rules: [0] });
        // * Visible-only parent: a hidden equal rule must not keep it indeterminate.
        expect(groupCheckState(group, partial, [group.rules[0]], false)).toBe("checked");
    });

    it("drops meta when a fully selected group becomes partial", () => {
        const current = makeSettings([{ siteRegex: "/g/", description: "old", previewEntries: [], rules: [RULE_A] }]);
        const transfer = parsed(
            envelope({}, [
                {
                    siteRegex: "/g/",
                    description: "new",
                    previewEntries: [],
                    rules: [{ ruleIndex: 0, rule: RULE_A }],
                },
            ]),
        );
        const group = buildMergeRows(current, diffTransfer(current, transfer), t).groups[0];
        const empty = { fields: [], groups: [] };
        const enabled = toggleGroup(empty, group, true);
        expect(enabled.groups[0].meta).toBe(true);

        const partial = toggleGroupRule(enabled, group, 0, false);
        expect(partial.groups).toEqual([]);
    });

    it("checks the parent when all visible rules are selected, meta aside", () => {
        const current = makeSettings([]);
        const transfer = parsed(
            envelope({}, [
                {
                    siteRegex: "/new/",
                    description: "new",
                    rules: [
                        { ruleIndex: 0, rule: RULE_A },
                        { ruleIndex: 1, rule: RULE_B },
                    ],
                },
            ]),
        );
        const group = buildMergeRows(current, diffTransfer(current, transfer), t).groups[0];
        const rulesOnly = { fields: [], groups: [{ groupIndex: 0, meta: false, rules: [0, 1] }] };

        // * Meta has no checkbox; all visible rule boxes checked => parent checked.
        expect(groupCheckState(group, rulesOnly, group.rules, true)).toBe("checked");
    });

    it("disables the parent for invalid meta but keeps matched-group rules selectable", () => {
        const current = makeSettings([{ siteRegex: "/g/", rules: [RULE_A] }]);
        const transfer = parsed(
            envelope({}, [
                {
                    siteRegex: "/g/",
                    description: "only one meta field",
                    rules: [{ ruleIndex: 0, rule: RULE_A }],
                },
            ]),
        );
        const group = buildMergeRows(current, diffTransfer(current, transfer), t).groups[0];
        expect(group.meta).toMatchObject({ valid: false, problem: "meta" });
        expect(groupParentDisabled(group)).toBe(true);
        expect(ruleCheckboxDisabled(group, { fields: [], groups: [] }, group.rules[0])).toBe(false);
    });

    it("counts selected units and detects invalid export selections", () => {
        const current = makeSettings([
            { siteRegex: "/g/", rules: [RULE_A, { kind: "replace", regex: "/(bad/", substitution: "x" }] },
        ]);
        const rows = buildExportRows(current, t);
        // * Export is raw: invalid units stay selectable (no disabled state here).
        expect(rows.groups[0].rules[1].valid).toBe(false);

        const selection = fullExportSelection(current);
        expect(selectedUnitCount(rows, selection)).toBe(7 + 2 + 1);
        expect(selectionHasInvalid(rows, selection)).toBe(true);
        expect(selectionHasInvalid(rows, { ...selection, groups: [{ groupIndex: 0, meta: true, rules: [0] }] })).toBe(
            false,
        );
    });

    it("marks an invalid gate as not selectable", () => {
        const current = makeSettings([{ siteRegex: "/(bad/", rules: [RULE_A] }]);
        const rows = buildExportRows(current, t);
        const group = rows.groups[0];
        expect(group.gateValid).toBe(false);
        expect(group.problem).toBe("regex");
        expect(groupParentDisabled(group)).toBe(true);
    });
});

describe("apply gating", () => {
    const base = { hasError: false, parsed: true, replaceAllowed: true, selectedUnits: 0 };

    it("ignores the selection for replace imports", () => {
        expect(isApplyDisabled({ ...base, mode: "import", importMode: "replace" })).toBe(false);
        expect(isApplyDisabled({ ...base, mode: "import", importMode: "replace", replaceAllowed: false })).toBe(true);
    });

    it("still requires a selection for export and merge", () => {
        expect(isApplyDisabled({ ...base, mode: "export", importMode: "merge" })).toBe(true);
        expect(isApplyDisabled({ ...base, mode: "import", importMode: "merge" })).toBe(true);
        expect(isApplyDisabled({ ...base, mode: "export", importMode: "merge", selectedUnits: 1 })).toBe(false);
    });

    it("keeps errors and unparsed imports blocking", () => {
        expect(
            isApplyDisabled({ ...base, mode: "export", importMode: "merge", selectedUnits: 1, hasError: true }),
        ).toBe(true);
        expect(isApplyDisabled({ ...base, mode: "import", importMode: "merge", parsed: false })).toBe(true);
    });
});
