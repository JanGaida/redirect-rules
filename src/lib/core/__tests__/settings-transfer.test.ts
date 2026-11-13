import { describe, expect, it } from "vitest";
import { EXAMPLE_RULES, type Settings, type SiteRule, type UrlRule } from "../settings";
import {
    applyMerge,
    applyReplace,
    buildExportEnvelope,
    defaultMergeSelection,
    diffTransfer,
    isFullAndValid,
    matchGroups,
    parseSettingsTransfer,
    ruleProblem,
    SETTINGS_FIELDS,
    TRANSFER_FORMAT,
    TRANSFER_VERSION,
    type ParsedTransfer,
    type TransferSelection,
} from "../settings-transfer";

function cloneRules(): SiteRule[] {
    return JSON.parse(JSON.stringify(EXAMPLE_RULES)) as SiteRule[];
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
    return {
        locale: "en",
        logLevel: "info",
        performanceMode: false,
        theme: "auto",
        motion: "normal",
        hideSkipped: false,
        dashboardHost: "fixed",
        autosaveDelayMs: 2000,
        rules: cloneRules(),
        ...overrides,
    };
}

function fullSelection(settings: Settings): TransferSelection {
    return {
        fields: [...SETTINGS_FIELDS],
        groups: settings.rules.map((site, groupIndex) => ({
            groupIndex,
            meta: true,
            rules: site.rules.map((_, ruleIndex) => ruleIndex),
        })),
    };
}

function envelope(partial: boolean, settings: unknown, siteGroups: unknown): string {
    return JSON.stringify({
        format: TRANSFER_FORMAT,
        version: TRANSFER_VERSION,
        exportedAt: "2026-11-03T22:00:00.000Z",
        appVersion: "9.9.9",
        partial,
        settings,
        siteGroups,
    });
}

function mustParse(text: string): ParsedTransfer {
    const result = parseSettingsTransfer(text);
    if (!result.ok) throw new Error(`parse failed: ${result.error.code}`);
    return result.parsed;
}

function mergeSelection(fields: TransferSelection["fields"], groups: TransferSelection["groups"]): TransferSelection {
    return { fields, groups };
}

describe("export envelope", () => {
    it("writes every selected field/group/rule for a full backup", () => {
        const settings = makeSettings();
        const exported = buildExportEnvelope(settings, fullSelection(settings), {
            appVersion: "1.2.3",
            exportedAt: "2026-11-03T22:00:00.000Z",
        });

        expect(exported.format).toBe(TRANSFER_FORMAT);
        expect(exported.version).toBe(1);
        expect(exported.appVersion).toBe("1.2.3");
        expect(exported.partial).toBe(false);
        expect(exported.settings).toEqual({
            locale: "en",
            logLevel: "info",
            performanceMode: false,
            theme: "auto",
            motion: "normal",
            dashboardHost: "fixed",
            autosaveDelayMs: 2000,
        });
        expect(exported.siteGroups).toHaveLength(EXAMPLE_RULES.length);
        expect(exported.siteGroups[0].description).toBe(EXAMPLE_RULES[0].description);
        expect(exported.siteGroups[0].previewEntries).toEqual(EXAMPLE_RULES[0].previewEntries);
        expect(exported.siteGroups[0].rules.map((entry) => entry.ruleIndex)).toEqual(
            EXAMPLE_RULES[0].rules.map((_, index) => index),
        );
        expect("lastSelection" in exported).toBe(false);
    });

    it("omits metadata when only rules are selected and flags the file partial", () => {
        const settings = makeSettings({ lastSelection: { siteIndex: 0, ruleIndex: 0 } });
        const exported = buildExportEnvelope(
            settings,
            mergeSelection(["locale"], [{ groupIndex: 0, meta: false, rules: [0] }]),
            { appVersion: "1", exportedAt: "2026-11-03T22:00:00.000Z" },
        );

        expect(exported.partial).toBe(true);
        expect(exported.settings).toEqual({ locale: "en" });
        expect(exported.siteGroups).toHaveLength(1);
        expect(exported.siteGroups[0].siteRegex).toBe(EXAMPLE_RULES[0].siteRegex);
        expect(exported.siteGroups[0].description).toBeUndefined();
        expect(exported.siteGroups[0].previewEntries).toBeUndefined();
        expect(exported.siteGroups[0].rules).toHaveLength(1);
        expect(exported.siteGroups[0].rules[0].ruleIndex).toBe(0);
    });

    it("exports invalid live units raw (no silent data loss)", () => {
        const settings = makeSettings({
            rules: [
                {
                    siteRegex: "/raw/",
                    rules: [
                        { kind: "replace", regex: "/(unclosed/", substitution: "x" },
                        { kind: "replace", regex: "", substitution: "" },
                    ],
                },
            ],
        });
        const exported = buildExportEnvelope(settings, fullSelection(settings), {
            appVersion: "1",
            exportedAt: "2026-11-03T22:00:00.000Z",
        });
        expect(exported.siteGroups[0].rules).toHaveLength(2);
        expect(exported.siteGroups[0].rules[0].rule).toEqual({
            kind: "replace",
            regex: "/(unclosed/",
            substitution: "x",
        });
    });

    it("canonicalizes an appendQuery rule without a regex so strict import accepts it", () => {
        const settings = makeSettings({
            rules: [
                {
                    siteRegex: "/canonical\\.test/",
                    rules: [{ kind: "appendQuery", params: "k=v" }],
                },
            ],
        });
        const exported = buildExportEnvelope(settings, fullSelection(settings), {
            appVersion: "1",
            exportedAt: "2026-11-03T22:00:00.000Z",
        });

        expect(exported.siteGroups[0].rules[0].rule).toEqual({ kind: "appendQuery", regex: "", params: "k=v" });

        const result = parseSettingsTransfer(JSON.stringify(exported));
        expect(result.ok).toBe(true);
        if (result.ok) {
            const entry = result.parsed.siteGroups[0].rules[0];
            expect(entry.valid).toBe(true);
            expect(entry.rule).toEqual({ kind: "appendQuery", regex: "", params: "k=v" });
        }
    });

    it("canonicalizes a removeQuery rule without a regex so strict import accepts it", () => {
        const settings = makeSettings({
            rules: [
                {
                    siteRegex: "/canonical\\.test/",
                    rules: [{ kind: "removeQuery", keys: "utm_*" }],
                },
            ],
        });
        const exported = buildExportEnvelope(settings, fullSelection(settings), {
            appVersion: "1",
            exportedAt: "2026-11-03T22:00:00.000Z",
        });

        expect(exported.siteGroups[0].rules[0].rule).toEqual({ kind: "removeQuery", regex: "", keys: "utm_*" });

        const result = parseSettingsTransfer(JSON.stringify(exported));
        expect(result.ok).toBe(true);
        if (result.ok) {
            const entry = result.parsed.siteGroups[0].rules[0];
            expect(entry.valid).toBe(true);
            expect(entry.rule).toEqual({ kind: "removeQuery", regex: "", keys: "utm_*" });
        }
    });

    it("canonicalizes an unwrap rule and keeps its required regex", () => {
        const settings = makeSettings({
            rules: [
                {
                    siteRegex: "/canonical\\.test/",
                    rules: [{ kind: "unwrap", regex: "/u=([^&]+)/" }],
                },
            ],
        });
        const exported = buildExportEnvelope(settings, fullSelection(settings), {
            appVersion: "1",
            exportedAt: "2026-11-03T22:00:00.000Z",
        });

        expect(exported.siteGroups[0].rules[0].rule).toEqual({ kind: "unwrap", regex: "/u=([^&]+)/" });

        const result = parseSettingsTransfer(JSON.stringify(exported));
        expect(result.ok).toBe(true);
        if (result.ok) {
            const entry = result.parsed.siteGroups[0].rules[0];
            expect(entry.valid).toBe(true);
            expect(entry.rule).toEqual({ kind: "unwrap", regex: "/u=([^&]+)/" });
        }
    });
});

describe("parseSettingsTransfer", () => {
    it("round-trips a full v1 export", () => {
        const settings = makeSettings();
        const text = JSON.stringify(
            buildExportEnvelope(settings, fullSelection(settings), {
                appVersion: "1",
                exportedAt: "2026-11-03T22:00:00.000Z",
            }),
        );
        const parsed = mustParse(text);
        expect(parsed.source).toBe("v1");
        expect(parsed.partial).toBe(false);
        expect(parsed.allValid).toBe(true);
        expect(isFullAndValid(parsed)).toBe(true);
        expect(Object.keys(parsed.fields).sort()).toEqual([...SETTINGS_FIELDS].sort());
        expect(parsed.siteGroups).toHaveLength(EXAMPLE_RULES.length);
    });

    it("accepts the legacy { settings } wrapper as a partial file", () => {
        const parsed = mustParse(
            JSON.stringify({
                settings: {
                    locale: "de",
                    rules: [
                        {
                            siteRegex: "/legacy\\.test/",
                            rules: [{ kind: "replace", regex: "/a/", substitution: "b" }],
                        },
                    ],
                },
            }),
        );
        expect(parsed.source).toBe("legacy");
        expect(parsed.partial).toBe(true);
        expect(parsed.fields.locale?.value).toBe("de");
        expect(parsed.siteGroups).toHaveLength(1);
        expect(parsed.siteGroups[0].rules[0].ruleIndex).toBe(0);
        expect(parsed.siteGroups[0].meta).toBeUndefined();
    });

    it("accepts a raw settings object as a full legacy file", () => {
        const settings = makeSettings();
        const parsed = mustParse(JSON.stringify(settings));
        expect(parsed.source).toBe("legacy");
        expect(parsed.partial).toBe(false);
        expect(parsed.allValid).toBe(true);
        expect(parsed.siteGroups).toHaveLength(EXAMPLE_RULES.length);
    });

    it("rejects unknown formats and versions", () => {
        expect(parseSettingsTransfer(JSON.stringify({ format: "other", version: 1 }))).toEqual({
            ok: false,
            error: { code: "unsupportedVersion" },
        });
        expect(
            parseSettingsTransfer(
                JSON.stringify({ format: TRANSFER_FORMAT, version: 2, settings: {}, siteGroups: [] }),
            ),
        ).toEqual({ ok: false, error: { code: "unsupportedVersion" } });
    });

    it("never throws on broken JSON and rejects an unusable structure", () => {
        expect(parseSettingsTransfer("{nope")).toMatchObject({ ok: false, error: { code: "parse" } });
        expect(parseSettingsTransfer(JSON.stringify({ hello: "world" }))).toMatchObject({
            ok: false,
            error: { code: "structure" },
        });
    });

    it("does not believe partial:false (defense in depth)", () => {
        const parsed = mustParse(envelope(false, { locale: "de" }, []));
        expect(parsed.partial).toBe(true);
        expect(isFullAndValid(parsed)).toBe(false);
    });

    it("maps legacy motion values but rejects junk", () => {
        const legacy = mustParse(envelope(true, { motion: "sehrSchnell" }, []));
        expect(legacy.fields.motion).toEqual({ value: "schnell", valid: true });

        const junk = mustParse(envelope(true, { motion: "turbo" }, []));
        expect(junk.fields.motion?.valid).toBe(false);
        expect(isFullAndValid(junk)).toBe(false);
    });

    it("validates rule units independently (neighbors stay selectable)", () => {
        const parsed = mustParse(
            envelope(true, {}, [
                {
                    siteRegex: "/g/",
                    rules: [
                        { ruleIndex: 0, rule: { kind: "replace", regex: "/(bad/", substitution: "x" } },
                        { ruleIndex: 1, rule: { kind: "replace", regex: "", substitution: "" } },
                        { ruleIndex: 2, rule: { kind: "replace", regex: "/ok/", substitution: "x" } },
                        { ruleIndex: -1, rule: { kind: "replace", regex: "/ok/", substitution: "x" } },
                    ],
                },
            ]),
        );
        const rules = parsed.siteGroups[0].rules;
        expect(rules[0]).toMatchObject({ valid: false, problem: "regex" });
        expect(rules[1]).toMatchObject({ valid: false, problem: "empty" });
        expect(rules[2]).toMatchObject({ valid: true });
        expect(rules[3]).toMatchObject({ valid: false, problem: "index" });
        expect(parsed.allValid).toBe(false);
    });

    it("requires both meta fields together in the v1 envelope", () => {
        const parsed = mustParse(
            envelope(true, {}, [
                {
                    siteRegex: "/g/",
                    description: "only description",
                    rules: [{ ruleIndex: 0, rule: { kind: "replace", regex: "/a/", substitution: "b" } }],
                },
            ]),
        );
        expect(parsed.siteGroups[0].meta).toMatchObject({ valid: false, problem: "meta" });
        expect(parsed.siteGroups[0].rules[0].valid).toBe(true);
    });

    it("rejects a group without a valid rule", () => {
        const parsed = mustParse(
            envelope(true, {}, [{ siteRegex: "/g/", description: "", previewEntries: [], rules: [] }]),
        );
        expect(parsed.siteGroups[0]).toMatchObject({ valid: false, problem: "noRules" });
    });
});

describe("diff + selection", () => {
    function parsedPartial(settings: unknown, siteGroups: unknown): ParsedTransfer {
        return mustParse(envelope(true, settings, siteGroups));
    }

    it("matches groups by exact gate and reuses duplicate gates in order", () => {
        const current = makeSettings({
            rules: [
                { siteRegex: "/same/", rules: [{ kind: "replace", regex: "/a/", substitution: "1" }] },
                { siteRegex: "/same/", rules: [{ kind: "replace", regex: "/a/", substitution: "2" }] },
            ],
        });
        const parsed = parsedPartial({}, [
            {
                siteRegex: "/same/",
                rules: [{ ruleIndex: 0, rule: { kind: "replace", regex: "/a/", substitution: "x" } }],
            },
            {
                siteRegex: "/same/",
                rules: [{ ruleIndex: 0, rule: { kind: "replace", regex: "/a/", substitution: "y" } }],
            },
        ]);
        expect(matchGroups(current.rules, parsed.siteGroups)).toEqual([0, 1]);

        const diff = diffTransfer(current, parsed);
        expect(diff.groups.map((group) => group.matchIndex)).toEqual([0, 1]);
        expect(diff.groups[0].rules[0].equal).toBe(false);
    });

    it("defaults to differing/new valid units only", () => {
        const current = makeSettings({
            rules: [{ siteRegex: "/g/", rules: [{ kind: "replace", regex: "/a/", substitution: "same" }] }],
        });
        const parsed = parsedPartial({ locale: "en", theme: "dark" }, [
            {
                siteRegex: "/g/",
                rules: [
                    { ruleIndex: 0, rule: { kind: "replace", regex: "/a/", substitution: "same" } },
                    { ruleIndex: 1, rule: { kind: "replace", regex: "/(bad/", substitution: "x" } },
                    { ruleIndex: 2, rule: { kind: "replace", regex: "/new/", substitution: "y" } },
                ],
            },
            {
                siteRegex: "/new-group/",
                rules: [{ ruleIndex: 0, rule: { kind: "appendQuery", regex: "", params: "a=1" } }],
            },
        ]);

        const selection = defaultMergeSelection(diffTransfer(current, parsed));
        expect(selection.fields).toEqual(["theme"]);
        expect(selection.groups).toEqual([
            { groupIndex: 0, meta: false, rules: [2] },
            { groupIndex: 1, meta: false, rules: [0] },
        ]);
    });
});

describe("applyMerge", () => {
    it("keeps missing fields and replaces/appends selected rules by index", () => {
        const current = makeSettings({
            locale: "en",
            rules: [
                {
                    siteRegex: "/g/",
                    rules: [
                        { kind: "replace", regex: "/a/", substitution: "old" },
                        { kind: "replace", regex: "/b/", substitution: "keep" },
                    ],
                },
            ],
        });
        const parsed = mustParse(
            envelope(true, { locale: "de" }, [
                {
                    siteRegex: "/g/",
                    rules: [
                        { ruleIndex: 0, rule: { kind: "replace", regex: "/a/", substitution: "new" } },
                        { ruleIndex: 4, rule: { kind: "replace", regex: "/c/", substitution: "appended" } },
                    ],
                },
            ]),
        );

        const next = applyMerge(
            current,
            parsed,
            mergeSelection(["locale"], [{ groupIndex: 0, meta: false, rules: [4, 0] }]),
        );

        expect(next.locale).toBe("de");
        expect(next.theme).toBe(current.theme);
        expect(next.rules[0].rules).toEqual([
            { kind: "replace", regex: "/a/", substitution: "new" },
            { kind: "replace", regex: "/b/", substitution: "keep" },
            { kind: "replace", regex: "/c/", substitution: "appended" },
        ]);
    });

    it("replaces metadata only when selected and appends new groups", () => {
        const current = makeSettings({
            rules: [
                {
                    siteRegex: "/g/",
                    description: "before",
                    previewEntries: [{ url: "https://old.test", testOutputUri: "" }],
                    rules: [{ kind: "replace", regex: "/a/", substitution: "old" }],
                },
            ],
        });
        const parsed = mustParse(
            envelope(true, {}, [
                {
                    siteRegex: "/g/",
                    description: "after",
                    previewEntries: [{ url: "https://new.test", testOutputUri: "", description: "" }],
                    rules: [],
                },
                {
                    siteRegex: "/new/",
                    rules: [{ ruleIndex: 0, rule: { kind: "replace", regex: "/x/", substitution: "y" } }],
                },
            ]),
        );

        const next = applyMerge(
            current,
            parsed,
            mergeSelection(
                [],
                [
                    { groupIndex: 0, meta: true, rules: [] },
                    { groupIndex: 1, meta: false, rules: [0] },
                ],
            ),
        );

        expect(next.rules[0].description).toBe("after");
        expect(next.rules[0].rules).toEqual([{ kind: "replace", regex: "/a/", substitution: "old" }]);
        expect(next.rules[1]).toEqual({
            siteRegex: "/new/",
            rules: [{ kind: "replace", regex: "/x/", substitution: "y" }],
        });
    });

    it("preserves lastSelection and never prunes incomplete current rows", () => {
        const current = makeSettings({
            lastSelection: { siteIndex: 0, ruleIndex: 1 },
            rules: [
                {
                    siteRegex: "/g/",
                    rules: [
                        { kind: "replace", regex: "", substitution: "" },
                        { kind: "replace", regex: "/keep/", substitution: "me" },
                    ],
                },
            ],
        });
        const parsed = mustParse(
            envelope(true, {}, [
                {
                    siteRegex: "/g/",
                    rules: [{ ruleIndex: 1, rule: { kind: "replace", regex: "/changed/", substitution: "x" } }],
                },
            ]),
        );

        const next = applyMerge(current, parsed, mergeSelection([], [{ groupIndex: 0, meta: false, rules: [1] }]));
        expect(next.lastSelection).toEqual({ siteIndex: 0, ruleIndex: 1 });
        expect(next.rules[0].rules).toHaveLength(2);
        expect(next.rules[0].rules[0]).toEqual({ kind: "replace", regex: "", substitution: "" });
    });

    it("ignores invalid selected units (defense in depth)", () => {
        const current = makeSettings();
        const parsed = mustParse(
            envelope(true, {}, [
                {
                    siteRegex: "/g/",
                    rules: [{ ruleIndex: 0, rule: { kind: "replace", regex: "/(bad/", substitution: "x" } }],
                },
            ]),
        );
        const next = applyMerge(current, parsed, mergeSelection([], [{ groupIndex: 0, meta: false, rules: [0] }]));
        expect(next.rules).toEqual(current.rules);
    });
});

describe("applyReplace", () => {
    it("builds a complete settings object and always sets rules explicitly", () => {
        const parsed = mustParse(
            envelope(
                false,
                {
                    locale: "de",
                    logLevel: "warn",
                    performanceMode: true,
                    theme: "dark",
                    motion: "schnell",
                    dashboardHost: "aboutblank",
                    autosaveDelayMs: 5000,
                },
                [
                    {
                        siteRegex: "/g/",
                        description: "",
                        previewEntries: [],
                        rules: [
                            { ruleIndex: 1, rule: { kind: "appendQuery", regex: "", params: "a=1" } },
                            { ruleIndex: 0, rule: { kind: "replace", regex: "/a/", substitution: "b" } },
                        ],
                    },
                ],
            ),
        );
        expect(isFullAndValid(parsed)).toBe(true);
        const next = applyReplace(parsed);
        expect(next).not.toBeNull();
        expect(next).toMatchObject({
            locale: "de",
            logLevel: "warn",
            performanceMode: true,
            theme: "dark",
            motion: "schnell",
            dashboardHost: "aboutblank",
            autosaveDelayMs: 5000,
        });
        expect(next?.rules[0].rules.map((rule) => rule.kind)).toEqual(["replace", "appendQuery"]);
        expect("lastSelection" in (next as object)).toBe(false);
    });

    it("sets an empty rules array for a full file with no groups", () => {
        const parsed = mustParse(
            envelope(
                false,
                {
                    locale: "en",
                    logLevel: "info",
                    performanceMode: false,
                    theme: "auto",
                    motion: "normal",
                    dashboardHost: "fixed",
                    autosaveDelayMs: 2000,
                },
                [],
            ),
        );
        const next = applyReplace(parsed);
        expect(next?.rules).toEqual([]);
    });

    it("refuses partial or invalid files", () => {
        const partial = mustParse(envelope(true, { locale: "de" }, []));
        expect(applyReplace(partial)).toBeNull();

        const invalid = mustParse(
            envelope(
                false,
                {
                    locale: "de",
                    logLevel: "warn",
                    performanceMode: false,
                    theme: "dark",
                    motion: "schnell",
                    dashboardHost: "fixed",
                    autosaveDelayMs: 2000,
                },
                [
                    {
                        siteRegex: "/g/",
                        description: "",
                        previewEntries: [],
                        rules: [{ ruleIndex: 0, rule: { kind: "replace", regex: "/(bad/", substitution: "x" } }],
                    },
                ],
            ),
        );
        expect(isFullAndValid(invalid)).toBe(false);
        expect(applyReplace(invalid)).toBeNull();
    });
});

describe("performanceMode transfer (ADR 0041)", () => {
    it("exports the live boolean", () => {
        const settings = makeSettings({ performanceMode: true });
        const exported = buildExportEnvelope(settings, fullSelection(settings), {
            appVersion: "1",
            exportedAt: "2026-11-05T00:00:00.000Z",
        });
        expect(exported.settings.performanceMode).toBe(true);
    });

    it("accepts only booleans (strict parse)", () => {
        expect(mustParse(envelope(true, { performanceMode: true }, [])).fields.performanceMode).toEqual({
            value: true,
            valid: true,
        });
        expect(mustParse(envelope(true, { performanceMode: false }, [])).fields.performanceMode).toEqual({
            value: false,
            valid: true,
        });
        for (const junk of ["true", 1, null]) {
            const parsed = mustParse(envelope(true, { performanceMode: junk }, []));
            expect(parsed.fields.performanceMode?.valid).toBe(false);
        }
    });

    it("merges a present value and keeps the current value when absent", () => {
        const current = makeSettings({ performanceMode: false });
        const present = mustParse(envelope(true, { performanceMode: true }, []));
        expect(applyMerge(current, present, mergeSelection(["performanceMode"], [])).performanceMode).toBe(true);

        const absent = mustParse(envelope(true, {}, []));
        expect(applyMerge(current, absent, mergeSelection(["performanceMode"], [])).performanceMode).toBe(false);
    });

    it("keeps pre-feature backups partial (no Replace)", () => {
        const parsed = mustParse(
            envelope(
                false,
                {
                    locale: "en",
                    logLevel: "info",
                    theme: "auto",
                    motion: "normal",
                    dashboardHost: "fixed",
                    autosaveDelayMs: 2000,
                },
                [],
            ),
        );
        expect(parsed.partial).toBe(true);
        expect(isFullAndValid(parsed)).toBe(false);
        expect(applyReplace(parsed)).toBeNull();
    });
});

describe("group enable/disable in backups (ADR 0038)", () => {
    const RULE: UrlRule = { kind: "replace", regex: "/a/", substitution: "b" };
    const FIELDS = {
        locale: "en",
        logLevel: "info",
        performanceMode: false,
        theme: "auto",
        motion: "normal",
        dashboardHost: "fixed",
        autosaveDelayMs: 2000,
    };

    function parsedWith(disabled: boolean | undefined): ParsedTransfer {
        const group: Record<string, unknown> = {
            siteRegex: "/x\\.test/",
            description: "",
            previewEntries: [],
            rules: [{ ruleIndex: 0, rule: RULE }],
        };
        if (disabled !== undefined) group.disabled = disabled;
        return mustParse(envelope(false, FIELDS, [group]));
    }

    function currentWith(disabled: boolean): Settings {
        return makeSettings({
            rules: [{ siteRegex: "/x\\.test/", ...(disabled ? { disabled: true } : {}), rules: [RULE] }],
        });
    }

    it("exports the state explicitly when meta is selected", () => {
        const enabled = buildExportEnvelope(
            currentWith(false),
            {
                fields: [],
                groups: [{ groupIndex: 0, meta: true, rules: [] }],
            },
            { appVersion: "1", exportedAt: "2026-11-04T00:00:00.000Z" },
        );
        expect(enabled.siteGroups[0].disabled).toBe(false);

        const disabled = buildExportEnvelope(
            currentWith(true),
            {
                fields: [],
                groups: [{ groupIndex: 0, meta: true, rules: [] }],
            },
            { appVersion: "1", exportedAt: "2026-11-04T00:00:00.000Z" },
        );
        expect(disabled.siteGroups[0].disabled).toBe(true);
    });

    it("diffs a state-only change as a changed meta unit", () => {
        const diff = diffTransfer(currentWith(false), parsedWith(true));
        expect(diff.groups[0].meta?.disabled).toEqual({ current: false, imported: true, equal: false });
        expect(diff.groups[0].meta?.equal).toBe(false);
    });

    it("merges true and false only when meta is selected", () => {
        const current = currentWith(false);
        const selected = mergeSelection([], [{ groupIndex: 0, meta: true, rules: [] }]);
        const withoutMeta = mergeSelection([], [{ groupIndex: 0, meta: false, rules: [] }]);

        expect(applyMerge(current, parsedWith(true), selected).rules[0].disabled).toBe(true);
        expect("disabled" in applyMerge(current, parsedWith(true), withoutMeta).rules[0]).toBe(false);

        const off = currentWith(true);
        expect("disabled" in applyMerge(off, parsedWith(false), selected).rules[0]).toBe(false);
    });

    it("replace restores the flag", () => {
        expect(applyReplace(parsedWith(true))?.rules[0].disabled).toBe(true);
        expect(applyReplace(parsedWith(false))?.rules[0].disabled).toBeUndefined();
    });

    it("rejects a non-boolean disabled value as invalid meta", () => {
        const parsed = parsedWith(undefined);
        const group = {
            siteRegex: "/x\\.test/",
            description: "",
            disabled: "yes",
            previewEntries: [],
            rules: [{ ruleIndex: 0, rule: RULE }],
        };
        const invalid = mustParse(envelope(false, FIELDS, [group]));
        expect(invalid.siteGroups[0].meta?.valid).toBe(false);
        expect(isFullAndValid(invalid)).toBe(false);
        expect(parsed.siteGroups[0].meta?.disabled).toBeUndefined();
    });
});

describe("ruleProblem", () => {
    it("flags empty rules and invalid regexes only", () => {
        expect(ruleProblem({ kind: "replace", regex: "", substitution: "" })).toBe("empty");
        expect(ruleProblem({ kind: "replace", regex: "/(bad/", substitution: "x" })).toBe("regex");
        expect(ruleProblem({ kind: "replace", regex: "/ok/", substitution: "x" })).toBeNull();
        expect(ruleProblem({ kind: "appendQuery", regex: "", params: "" })).toBe("empty");
        expect(ruleProblem({ kind: "appendQuery", regex: "/(bad/", params: "a=1" })).toBe("regex");
        expect(ruleProblem({ kind: "checkpoint", regex: "/ok/", mode: "continue" } satisfies UrlRule)).toBeNull();
    });

    it("flags substitution-only replace and gate-only appendQuery as empty", () => {
        expect(ruleProblem({ kind: "replace", regex: "", substitution: "x" })).toBe("empty");
        expect(ruleProblem({ kind: "appendQuery", regex: "/gate/", params: "" })).toBe("empty");
        expect(ruleProblem({ kind: "checkpoint", regex: "", mode: "continue" })).toBe("empty");
        expect(ruleProblem({ kind: "removeQuery", regex: "/gate/", keys: "" })).toBe("empty");
    });

    it("flags an invalid removeQuery gate and accepts a valid one", () => {
        expect(ruleProblem({ kind: "removeQuery", regex: "/(bad/", keys: "a" })).toBe("regex");
        expect(ruleProblem({ kind: "removeQuery", regex: "/ok/", keys: "a" })).toBeNull();
    });

    it("flags an empty or invalid unwrap regex", () => {
        expect(ruleProblem({ kind: "unwrap", regex: "" })).toBe("empty");
        expect(ruleProblem({ kind: "unwrap", regex: "/(bad/" })).toBe("regex");
        expect(ruleProblem({ kind: "unwrap", regex: "/u=([^&]+)/" })).toBeNull();
    });

    it("keeps a replace with a non-empty regex and empty substitution valid", () => {
        expect(ruleProblem({ kind: "replace", regex: "/delete-me/", substitution: "" })).toBeNull();
    });
});
