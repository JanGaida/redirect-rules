import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import en from "../../data/i18n.json";

const dict = en as { en: Record<string, string>; de: Record<string, string> };
const KEYS = Object.keys(dict.en).sort();

const SRC_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SELF = fileURLToPath(import.meta.url);

/** Non-source artifacts that carry key lists rather than call sites. */
const SKIP_FILES = new Set(["i18n.keys.ts", "i18n.json"]);

/**
 * Keys that are dynamic in a form the static scanner cannot see. Keep this
 * narrow — a permissive scanner stops catching future dead keys.
 */
const ALLOWLIST = new Set<string>();

/** Collects every `.ts` / `.svelte` source under `src/`, minus key-list artifacts. */
function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            sourceFiles(full, out);
            continue;
        }
        if (full === SELF || SKIP_FILES.has(entry.name)) continue;
        if (!/\.(ts|svelte)$/.test(entry.name)) continue;
        out.push(full);
    }
    return out;
}

const SOURCES = sourceFiles(SRC_ROOT).map((file) => readFileSync(file, "utf8"));

/** Exact quoted-literal match — avoids `preview.chain` matching `preview.chainStat`. */
function isQuotedLiteral(source: string, key: string): boolean {
    return source.includes(`"${key}"`) || source.includes(`'${key}'`) || source.includes(`\`${key}\``);
}

/** Template literals whose static text runs into an interpolation (`theme.${x}`). */
const TEMPLATE_PREFIX = /`([^`$]*?)\$\{/g;

/** Plural base keys with both `<base>.one` and `<base>.other` present. */
const PLURAL_BASES = KEYS.filter(
    (key) => key.endsWith(".one") && KEYS.includes(`${key.slice(0, -".one".length)}.other`),
).map((key) => key.slice(0, -".one".length));

function collectUsed(): Set<string> {
    const used = new Set<string>(ALLOWLIST);
    for (const source of SOURCES) {
        for (const key of KEYS) {
            if (isQuotedLiteral(source, key)) used.add(key);
        }
        for (const match of source.matchAll(TEMPLATE_PREFIX)) {
            const prefix = match[1];
            // * Short prefixes come from `tPlural`'s `${key}.…` template and would
            //   mark the whole dictionary; plurals are handled by the base set.
            if (prefix.length < 3) continue;
            for (const key of KEYS) {
                if (key.startsWith(prefix)) used.add(key);
            }
        }
    }
    for (const base of PLURAL_BASES) {
        if (SOURCES.some((source) => isQuotedLiteral(source, base))) {
            used.add(`${base}.one`);
            used.add(`${base}.other`);
        }
    }
    return used;
}

describe("i18n usage", () => {
    it("has no dead dictionary keys", () => {
        const used = collectUsed();
        const unused = KEYS.filter((key) => !used.has(key));
        expect(unused, "unused i18n keys — delete both locales or extend ALLOWLIST").toEqual([]);
    });
});
