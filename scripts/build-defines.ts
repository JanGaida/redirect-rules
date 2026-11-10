// * Compile-time data shared by the Vite build and the Vitest config.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const readText = (relativePath: string): string =>
    readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf-8");

/** Partial include marker: `{{include:name}}` expands once to `src/lib/data/name.txt`. */
const INCLUDE_PATTERN = /\{\{include:([a-z0-9.-]+)\}\}/g;

const expandIncludes = (text: string): string =>
    text.replace(INCLUDE_PATTERN, (_marker, name: string) => readText(`src/lib/data/${name}.txt`).trimEnd());

/** Vite define values are chunked to keep generated lines bounded. */
const chunks = (text: string): string[] => text.match(/.{1,200}/g) ?? [];

const base64Chunks = (relativePath: string, normalizeNewlines = false): string[] => {
    const text = readText(relativePath);
    const expanded = expandIncludes(normalizeNewlines ? text.replace(/\r\n/g, "\n") : text);
    return chunks(Buffer.from(expanded, "utf-8").toString("base64"));
};

/** Files baked into defines at config-load time (dev server restarts on edits). */
export const COMPILE_TIME_DATA_FILES = [
    "src/lib/data/i18n.json",
    "src/lib/data/chat-contract.de.txt",
    "src/lib/data/chat-contract.en.txt",
    "src/lib/data/chat-template.de.txt",
    "src/lib/data/chat-template.en.txt",
    "src/lib/data/chat-error-template.de.txt",
    "src/lib/data/chat-error-template.en.txt",
    "CHANGELOG.md",
];

/** Build metadata injected into the userscript bundle. */
export interface CompileTimeMeta {
    dev: boolean;
    buildSha: string;
    buildDate: string;
}

/** Returns all `__*__` defines as JSON-stringified values. */
export function compileTimeDefines(meta: CompileTimeMeta): Record<string, string> {
    return {
        __DEV__: JSON.stringify(meta.dev),
        __CHANGELOG_B64__: JSON.stringify(base64Chunks("CHANGELOG.md", true)),
        __I18N_B64__: JSON.stringify(base64Chunks("src/lib/data/i18n.json")),
        __CHAT_TEMPLATE_DE_B64__: JSON.stringify(base64Chunks("src/lib/data/chat-template.de.txt")),
        __CHAT_TEMPLATE_EN_B64__: JSON.stringify(base64Chunks("src/lib/data/chat-template.en.txt")),
        __CHAT_ERROR_TEMPLATE_DE_B64__: JSON.stringify(base64Chunks("src/lib/data/chat-error-template.de.txt")),
        __CHAT_ERROR_TEMPLATE_EN_B64__: JSON.stringify(base64Chunks("src/lib/data/chat-error-template.en.txt")),
        __BUILD_SHA__: JSON.stringify(meta.buildSha),
        __BUILD_DATE__: JSON.stringify(meta.buildDate),
    };
}
