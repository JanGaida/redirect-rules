import { afterEach, describe, it, expect } from "vitest";

import { t, tPlural, resolveLocale } from "../i18n.svelte";
import { store } from "../../stores/settings.svelte";
import en from "../../data/i18n.json";

const dict = en as { en: Record<string, string>; de: Record<string, string> };

describe("i18n parity (ADR 0014)", () => {
    it("has identical key sets in both locales", () => {
        expect(Object.keys(dict.en).sort()).toEqual(Object.keys(dict.de).sort());
    });

    it("resolves common translations", () => {
        expect(t("common.close")).toBeTruthy();
        expect(t("common.close")).not.toBe("common.close");
    });

    describe("tPlural", () => {
        afterEach(() => {
            store.settings.locale = "auto";
        });

        it("selects one/other per count (en)", () => {
            store.settings.locale = "en";
            expect(tPlural("rules.count.site", 0)).toBe("0 rules");
            expect(tPlural("rules.count.site", 1)).toBe("1 rule");
            expect(tPlural("rules.count.site", 2)).toBe("2 rules");
        });

        it("selects one/other per count (de)", () => {
            store.settings.locale = "de";
            expect(tPlural("rules.count.site", 0)).toBe("0 Regeln");
            expect(tPlural("rules.count.site", 1)).toBe("1 Regel");
            expect(tPlural("rules.count.site", 2)).toBe("2 Regeln");
        });
    });
});
