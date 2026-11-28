import { describe, expect, it } from "vitest";

import dict from "../../data/i18n.json";
import { TOKREF_APPEND, TOKREF_SUBST, type TokenRefEntry } from "../token-reference-data";

const translations = dict as { en: Record<string, string>; de: Record<string, string> };

/** Entries the token popover renders as chrome, not as data rows. */
const SURROUNDING_KEYS = new Set(["title", "titleParams", "leadSubst", "leadParams", "button", "button.hint"]);

const lists: Array<[string, TokenRefEntry[]]> = [
    ["substitution", TOKREF_SUBST],
    ["params", TOKREF_APPEND],
];

describe("token reference data", () => {
    it("uses non-empty, unique codes and keys per list", () => {
        for (const [, entries] of lists) {
            expect(entries.length).toBeGreaterThan(0);
            expect(new Set(entries.map((entry) => entry.code)).size).toBe(entries.length);
            expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
            for (const entry of entries) {
                expect(entry.code.length).toBeGreaterThan(0);
                expect(entry.key.length).toBeGreaterThan(0);
            }
        }
    });

    it("resolves every entry in both locales", () => {
        for (const [, entries] of lists) {
            for (const entry of entries) {
                const key = `tokref.${entry.key}`;
                expect(translations.en[key]).toBeTruthy();
                expect(translations.de[key]).toBeTruthy();
            }
        }
    });

    it("accounts for every tokref translation key", () => {
        const dataKeys = new Set(lists.flatMap(([, entries]) => entries.map((entry) => entry.key)));
        const translated = Object.keys(translations.en)
            .filter((key) => key.startsWith("tokref."))
            .map((key) => key.slice("tokref.".length));

        for (const key of translated) {
            expect(dataKeys.has(key) || SURROUNDING_KEYS.has(key)).toBe(true);
        }
    });
});
