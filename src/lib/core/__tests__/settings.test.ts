import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    defaultSettings,
    EXAMPLE_RULES,
    loadSettings,
    loadSettingsResult,
    normalizeMotion,
    normalizeSettings,
    saveSettings,
} from "../settings";
import { STORAGE_KEY } from "../storage";
import { effectiveLogLevel, LOG_LEVEL_LABELS } from "../log";
import { installGmStubs, uninstallGmStubs } from "./gm-stubs";

beforeEach(() => {
    installGmStubs();
});

afterEach(() => {
    uninstallGmStubs();
});

describe("defaultSettings", () => {
    it("starts with the example rule list and a resolved locale", () => {
        const defaults = defaultSettings();
        // * ADR 0003 amendment: first boot SHIPS the five real-world
        // rule groups — no longer an empty list.
        expect(defaults.rules).toEqual(EXAMPLE_RULES);
        // * detectLocale is environment-dependent (this dev machine's node reports
        // "de", a CI box may report "en") — only the supported set is asserted
        // here; the detection itself is pinned in locale.test.ts via stubs.
        expect(["auto", "de", "en"]).toContain(defaults.locale);
    });

    it("copies the example rules DEEP per call (module constant never leaks)", () => {
        const a = defaultSettings();
        const b = defaultSettings();
        expect(a.rules).not.toBe(b.rules);
        expect(a.rules[0]).not.toBe(b.rules[0]);
        // * Mutating one call's result must not touch the next call's defaults.
        a.rules[0].siteRegex = "/mutated/";
        expect(defaultSettings().rules).toEqual(EXAMPLE_RULES);
    });
});

describe("normalizeSettings — fail-soft shapes", () => {
    it("passes a valid settings object through", () => {
        const input = {
            locale: "de",
            logLevel: "debug",
            performanceMode: true,
            theme: "dark",
            motion: "normal",
            hideSkipped: true,
            dashboardHost: "fixed",
            autosaveDelayMs: 2000,
            rules: [
                {
                    siteRegex: "/a\\.test/",
                    previewEntries: [{ url: "https://a.test/x", testOutputUri: "", description: "" }],
                    rules: [{ kind: "replace", regex: "/b/", substitution: "c" }],
                },
            ],
        };
        expect(normalizeSettings(input)).toEqual(input);
    });

    it("keeps a trimmed site description and drops empty/null/non-string values", () => {
        const rule = { kind: "replace", regex: "/b/", substitution: "c" };
        const normalize = (description: unknown) =>
            normalizeSettings({
                locale: "en",
                rules: [{ siteRegex: "/a/", description, rules: [rule] }],
            }).rules[0];

        expect(normalize("  Example site  ").description).toBe("Example site");
        expect(normalize(null).description).toBeUndefined();
        expect(normalize("").description).toBeUndefined();
        expect(normalize("   ").description).toBeUndefined();
        expect(normalize(42).description).toBeUndefined();
        // * Absent stays absent — the canonical empty state needs no field.
        expect("description" in normalize(undefined)).toBe(false);
    });

    it("maps every legacy motion value to a canonical preset (ADR 0034)", () => {
        for (const value of ["sofort", "sehrSchnell", "schnell"]) {
            expect(normalizeMotion(value)).toBe("schnell");
        }
        for (const value of ["normal", "moderat"]) {
            expect(normalizeMotion(value)).toBe("normal");
        }
        for (const value of ["langsam", "sehrLangsam"]) {
            expect(normalizeMotion(value)).toBe("langsam");
        }
        expect(normalizeMotion("aus")).toBe("aus");
    });

    it("keeps canonical motion values and silently defaults missing ones", () => {
        for (const value of ["aus", "schnell", "normal", "langsam"] as const) {
            expect(normalizeMotion(value)).toBe(value);
        }
        expect(normalizeMotion(undefined)).toBe("normal");
    });

    it("defaults an unknown motion value to normal (fail-soft)", () => {
        expect(normalizeMotion("turbo")).toBe("normal");
        expect(normalizeMotion(null)).toBe("normal");
    });

    it("keeps a persisted dashboardHost", () => {
        expect(normalizeSettings({ locale: "en", dashboardHost: "aboutblank", rules: [] }).dashboardHost).toBe(
            "aboutblank",
        );
        expect(normalizeSettings({ locale: "en", dashboardHost: "nope", rules: [] }).dashboardHost).toBe("fixed");
    });

    it("keeps a boolean hideSkipped and defaults missing/junk values to false (ADR 0040)", () => {
        expect(normalizeSettings({ locale: "en", hideSkipped: true, rules: [] }).hideSkipped).toBe(true);
        expect(normalizeSettings({ locale: "en", hideSkipped: false, rules: [] }).hideSkipped).toBe(false);
        expect(normalizeSettings({ locale: "en", rules: [] }).hideSkipped).toBe(false);
        expect(normalizeSettings({ locale: "en", hideSkipped: "true", rules: [] }).hideSkipped).toBe(false);
        expect(defaultSettings().hideSkipped).toBe(false);
    });

    it("keeps a boolean performanceMode and defaults missing/junk values to false (ADR 0041)", () => {
        expect(normalizeSettings({ locale: "en", performanceMode: true, rules: [] }).performanceMode).toBe(true);
        expect(normalizeSettings({ locale: "en", performanceMode: false, rules: [] }).performanceMode).toBe(false);
        expect(normalizeSettings({ locale: "en", rules: [] }).performanceMode).toBe(false);
        expect(normalizeSettings({ locale: "en", performanceMode: "true", rules: [] }).performanceMode).toBe(false);
        expect(defaultSettings().performanceMode).toBe(false);
    });

    it("keeps disabled:true and drops false/absent/non-boolean flags (sparse shape)", () => {
        const rule = { kind: "replace", regex: "/a/", substitution: "b" };
        const normalize = (disabled: unknown) =>
            normalizeSettings({ locale: "en", rules: [{ siteRegex: "/s/", disabled, rules: [rule] }] }).rules[0];

        expect(normalize(true).disabled).toBe(true);
        expect("disabled" in normalize(false)).toBe(false);
        expect("disabled" in normalize(undefined)).toBe(false);
        expect("disabled" in normalize("true")).toBe(false);
    });

    it("keeps a valid logLevel", () => {
        for (const level of ["debug", "info", "warn", "error", "silent"]) {
            expect(normalizeSettings({ locale: "en", logLevel: level, rules: [] }).logLevel).toBe(level);
        }
    });

    it("defaults an unknown logLevel to info (fail-soft)", () => {
        const out = normalizeSettings({ locale: "en", logLevel: "chatty", rules: [] });
        expect(out.logLevel).toBe("info");
    });

    it("defaults a missing logLevel to info (pre-normalization settings)", () => {
        const out = normalizeSettings({ locale: "en", rules: [] });
        expect(out.logLevel).toBe("info");
    });

    it("keeps a valid theme (ADR 0013)", () => {
        for (const theme of ["auto", "dark", "light"] as const) {
            expect(normalizeSettings({ locale: "en", theme, rules: [] }).theme).toBe(theme);
        }
    });

    it("keeps a persisted group test url (group binding)", () => {
        const out = normalizeSettings({
            locale: "en",
            rules: [
                {
                    siteRegex: "/a/",
                    previewEntries: [{ url: "https://a.test/x", testOutputUri: "", description: "" }],
                    rules: [
                        { kind: "replace", regex: "/x/", substitution: "y" },
                        { kind: "appendQuery", params: "p=1" },
                    ],
                },
            ],
        });
        expect(out.rules[0].previewEntries).toEqual([{ url: "https://a.test/x", testOutputUri: "", description: "" }]);
        // * Rules never carry a testUrl — the preview url belongs to the GROUP.
        expect(out.rules[0].rules[0]).toEqual({ kind: "replace", regex: "/x/", substitution: "y" });
        expect(out.rules[0].rules[1]).toEqual({ kind: "appendQuery", regex: "", params: "p=1" });
    });

    it("keeps group preview urls when provided", () => {
        const out = normalizeSettings({
            locale: "en",
            rules: [
                {
                    siteRegex: "/a/",
                    previewEntries: [{ url: "https://a.test/x", testOutputUri: "", description: "" }],
                    rules: [
                        { kind: "replace", regex: "/x/", substitution: "y" },
                        { kind: "appendQuery", params: "p=1" },
                    ],
                },
            ],
        });
        expect(out.rules[0].previewEntries).toEqual([{ url: "https://a.test/x", testOutputUri: "", description: "" }]);
        expect(out.rules[0].rules[0]).toEqual({ kind: "replace", regex: "/x/", substitution: "y" });
        expect(out.rules[0].rules[1]).toEqual({ kind: "appendQuery", regex: "", params: "p=1" });
    });

    it("defaults the group test url to the uniform empty string (fail-soft)", () => {
        const out = normalizeSettings({
            locale: "en",
            rules: [{ siteRegex: "/a/", rules: [{ kind: "replace", regex: "/x/", substitution: "y" }] }],
        });
        expect(out.rules[0].previewEntries).toEqual([]);
    });

    it("drops non-string group test urls to the uniform empty string (fail-soft)", () => {
        const out = normalizeSettings({
            locale: "en",
            rules: [
                { siteRegex: "/a/", previewUrls: 42, rules: [{ kind: "replace", regex: "/x/", substitution: "y" }] },
            ],
        });
        expect(out.rules[0].previewEntries).toEqual([]);
    });

    it("defaults an unknown theme to auto (fail-soft, ADR 0013)", () => {
        const out = normalizeSettings({ locale: "en", theme: "midnight", rules: [] });
        expect(out.theme).toBe("auto");
    });

    it("defaults a missing theme to auto (pre-theme settings)", () => {
        const out = normalizeSettings({ locale: "en", rules: [] });
        expect(out.theme).toBe("auto");
    });

    it("normalizes the appendQuery gate to the uniform empty string (binding contract)", () => {
        const out = normalizeSettings({
            locale: "en",
            rules: [{ siteRegex: "/a/", rules: [{ kind: "appendQuery", regex: "", params: "x=1" }] }],
        });
        expect(out.rules[0].rules[0]).toEqual({ kind: "appendQuery", regex: "", params: "x=1" });
    });

    it("normalizes a removeQuery rule to the uniform empty gate string", () => {
        const out = normalizeSettings({
            locale: "en",
            rules: [{ siteRegex: "/a/", rules: [{ kind: "removeQuery", keys: "utm_*" }] }],
        });
        expect(out.rules[0].rules[0]).toEqual({ kind: "removeQuery", regex: "", keys: "utm_*" });
    });

    it("drops a removeQuery rule without a keys string", () => {
        const out = normalizeSettings({
            locale: "en",
            rules: [{ siteRegex: "/a/", rules: [{ kind: "removeQuery", regex: "" }] }],
        });
        expect(out.rules[0].rules).toEqual([]);
    });

    it("falls back to defaults for non-object storage", () => {
        const out = normalizeSettings("garbage");
        expect(out.rules).toEqual(EXAMPLE_RULES);
        expect(out.locale).toBe(defaultSettings().locale);
    });

    it("keeps the detected locale on an unknown stored locale", () => {
        const out = normalizeSettings({ locale: "fr-FR", rules: [] });
        expect(out.locale).toBe(defaultSettings().locale);
    });

    it("stored rules REPLACE the example list (never append to it)", () => {
        const out = normalizeSettings({
            locale: "en",
            rules: [{ siteRegex: "/own\\.test/", rules: [{ kind: "replace", regex: "/a/", substitution: "b" }] }],
        });
        expect(out.rules).toHaveLength(1);
        expect(out.rules[0].siteRegex).toBe("/own\\.test/");
    });

    it("keeps the example list when rules is missing or not an array (fail-soft)", () => {
        expect(normalizeSettings({ locale: "en" }).rules).toEqual(EXAMPLE_RULES);
        expect(normalizeSettings({ locale: "en", rules: 42 }).rules).toEqual(EXAMPLE_RULES);
    });

    it("drops malformed site rules and url rules individually", () => {
        const out = normalizeSettings({
            locale: "en",
            rules: [
                "not-a-site-rule",
                { siteRegex: "/ok\\.test/", rules: "not-an-array" },
                {
                    siteRegex: "/ok\\.test/",
                    rules: [{ kind: "replace", regex: 42, substitution: "x" }, { kind: "mystery" }],
                },
                { siteRegex: "/ok\\.test/", rules: [{ kind: "appendQuery", params: "a=1" }] },
            ],
        });
        // * Structurally-valid site groups survive even when ALL their rules were
        // dropped (they render as empty groups in the GUI; save() prunes them).
        expect(out.rules).toEqual([
            { siteRegex: "/ok\\.test/", rules: [], previewEntries: [] },
            {
                siteRegex: "/ok\\.test/",
                rules: [{ kind: "appendQuery", regex: "", params: "a=1" }],
                previewEntries: [],
            },
        ]);
    });

    it("ignores the legacy settings shape (urlRules) — blank restart keeps the example list", () => {
        const out = normalizeSettings({ locale: "de", urlRules: [{ regexSite: "/x/", regexRules: [] }] });
        expect(out.rules).toEqual(EXAMPLE_RULES);
    });
});

describe("effectiveLogLevel (ADR 0041)", () => {
    it("returns the stored level while performance mode is off", () => {
        for (const logLevel of LOG_LEVEL_LABELS) {
            expect(effectiveLogLevel({ logLevel, performanceMode: false })).toBe(logLevel);
        }
    });

    it("forces silent while performance mode is on, regardless of the stored level", () => {
        for (const logLevel of LOG_LEVEL_LABELS) {
            expect(effectiveLogLevel({ logLevel, performanceMode: true })).toBe("silent");
        }
    });
});

describe("loadSettings", () => {
    it("writes defaults on first boot (key absent)", () => {
        const store = installGmStubs();
        const settings = loadSettings();
        expect(settings.rules).toEqual(EXAMPLE_RULES);
        expect(store.get(STORAGE_KEY)).toEqual(settings);
    });

    it("loads + normalizes stored settings without rewriting them", () => {
        const stored = { locale: "de", rules: [{ siteRegex: "/a\\.test/", rules: [] }] };
        const store = installGmStubs({ [STORAGE_KEY]: stored });
        const settings = loadSettings();
        expect(settings.locale).toBe("de");
        expect(settings.rules).toEqual([{ siteRegex: "/a\\.test/", rules: [], previewEntries: [] }]);
        // * The stored object must NOT have been re-written on load (legacy side effect removed).
        expect(store.get(STORAGE_KEY)).toBe(stored);
    });

    it("degrades corrupt storage to defaults", () => {
        installGmStubs({ [STORAGE_KEY]: "corrupt-not-an-object" });
        const settings = loadSettings();
        expect(settings.rules).toEqual(EXAMPLE_RULES);
        expect(settings.locale).toBe(defaultSettings().locale);
    });

    it("returns defaults WITHOUT writing when the GM read fails (no data loss)", () => {
        const setValue = vi.fn();
        (globalThis as Record<string, unknown>).GM_getValue = (): never => {
            throw new Error("get failed");
        };
        (globalThis as Record<string, unknown>).GM_setValue = setValue;

        const settings = loadSettings();

        expect(settings.rules).toEqual(EXAMPLE_RULES);
        expect(settings.locale).toBe(defaultSettings().locale);
        expect(setValue).not.toHaveBeenCalled();
    });

    it("loadSettingsResult flags a failed read (ok:false) and never writes", () => {
        const setValue = vi.fn();
        (globalThis as Record<string, unknown>).GM_getValue = (): never => {
            throw new Error("get failed");
        };
        (globalThis as Record<string, unknown>).GM_setValue = setValue;

        const result = loadSettingsResult();

        expect(result.ok).toBe(false);
        expect(result.settings.rules).toEqual(EXAMPLE_RULES);
        expect(result.settings.locale).toBe(defaultSettings().locale);
        expect(setValue).not.toHaveBeenCalled();
    });

    it("loadSettingsResult writes defaults once on a successful absent-key read (ok:true)", () => {
        const store = installGmStubs();
        const original = (globalThis as Record<string, unknown>).GM_setValue as (key: string, value: unknown) => void;
        let writes = 0;
        (globalThis as Record<string, unknown>).GM_setValue = (key: string, value: unknown): void => {
            writes += 1;
            original(key, value);
        };

        const result = loadSettingsResult();

        expect(result.ok).toBe(true);
        expect(writes).toBe(1);
        expect(store.get(STORAGE_KEY)).toEqual(result.settings);
    });
});

describe("saveSettings", () => {
    it("persists the whole object under the single GM key", () => {
        const store = installGmStubs();
        const settings = defaultSettings();
        settings.rules.push({ siteRegex: "/a\\.test/", rules: [{ kind: "replace", regex: "/b/", substitution: "c" }] });
        saveSettings(settings);
        expect(store.get(STORAGE_KEY)).toEqual(settings);
    });

    it("round-trips through loadSettings", () => {
        installGmStubs();
        const settings = defaultSettings();
        settings.locale = "de";
        settings.rules.push({
            siteRegex: "/a\\.test/",
            previewEntries: [{ url: "https://a.test/x", testOutputUri: "", description: "" }],
            rules: [{ kind: "appendQuery", regex: "", params: "x=1" }],
        });
        saveSettings(settings);
        expect(loadSettings()).toEqual(settings);
    });
});

describe("normalizeSettings — checkpoint rules", () => {
    it("keeps a valid checkpoint rule", () => {
        const out = normalizeSettings({
            locale: "en",
            rules: [{ siteRegex: "/a/", rules: [{ kind: "checkpoint", regex: "/x/", mode: "stop" }] }],
        });
        expect(out.rules[0].rules[0]).toEqual({ kind: "checkpoint", regex: "/x/", mode: "stop" });
    });

    it("defaults missing or invalid mode to continue", () => {
        const a = normalizeSettings({
            locale: "en",
            rules: [{ siteRegex: "/a/", rules: [{ kind: "checkpoint", regex: "/x/" }] }],
        });
        expect((a.rules[0].rules[0] as any).mode).toBe("continue");
        const b = normalizeSettings({
            locale: "en",
            rules: [{ siteRegex: "/a/", rules: [{ kind: "checkpoint", regex: "/x/", mode: "bogus" }] }],
        });
        expect((b.rules[0].rules[0] as any).mode).toBe("continue");
    });

    it("drops checkpoint rules without a string regex", () => {
        const out = normalizeSettings({
            locale: "en",
            rules: [{ siteRegex: "/a/", rules: [{ kind: "checkpoint", mode: "stop" }] }],
        });
        expect(out.rules[0].rules).toHaveLength(0);
    });
});
