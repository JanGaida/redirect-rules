// ─────────────────────────────────────────────────────────────────────────────
// MARK: check-comments — language, length, tags, wording
// ─────────────────────────────────────────────────────────────────────────────
// * Coverage: line/block comments in TS/JS/Svelte/CSS/HTML, HTML <script>/<style>
// *   blocks, and first-argument it/test/describe titles in *.test.ts / *.spec.ts.
// * Out of scope: YAML/JSON configs, `.each([...])` table titles, interpolated titles.
// * Every standalone block head needs a Better-Comments tag; trailing comments,
// *   continuation lines, JSDoc, and tool pragmas are exempt.
// * Exit code stays 0 unless --strict is passed; soft wording findings never fail.

import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIRS = ["src", "e2e", "scripts"];
const EXTRA_FILES = [
    "index.html",
    "dashboard.html",
    "dashboard-host.html",
    "vite.config.ts",
    "vitest.config.ts",
    "playwright.config.ts",
    "svelte.config.js",
];
const EXTENSIONS = new Set([".ts", ".svelte", ".css", ".mjs", ".js", ".html"]);
const STRICT = process.argv.includes("--strict");
const MAX_BLOCK = 8;
const MAX_LINE = 120;
const GLOB_ANY = "**";

// * Rule table — detection name, overview bucket, report title, and fix hint.
const RULES = {
    language: {
        category: "language",
        reason: "non-English comment",
        action: "rewrite the comment in English",
    },
    shorthand: {
        category: "shorthand",
        reason: "internal iteration shorthand",
        action: "drop planning ids and dates; describe the behavior",
    },
    shorthandTitle: {
        category: "titles",
        reason: "internal iteration shorthand in test title",
        action: "describe the behavior, not the iteration",
    },
    marketing: {
        category: "wording",
        reason: "marketing phrase",
        action: "replace it with the concrete engineering fact",
    },
    softWording: {
        category: "wording",
        reason: "review wording",
        action: "confirm the claim is specific, or reword it",
        soft: true,
    },
    lineLength: {
        category: "length",
        reason: `comment line > ${MAX_LINE} chars`,
        action: `wrap the comment under ${MAX_LINE} chars`,
    },
    blankLine: {
        category: "format",
        reason: "blank paragraph line in comment",
        action: "remove the empty marker line",
    },
    tag: {
        category: "tags",
        reason: "comment block head has no Better-Comments tag",
        action: "add a Better-Comments tag at the block head",
    },
    blockLength: {
        category: "length",
        reason: `comment block > ${MAX_BLOCK} lines`,
        action: `split or trim the block to ${MAX_BLOCK} lines`,
    },
};

// ! `die`, `der`, `den`, `des` are English words too — only strong German markers count.
const GERMAN =
    /\b(das|und|ist|wird|werden|nicht|nur|bei|für|von|mit|ein|eine|einen|einem|dem|auf|als|sich|kann|muss|sollen|durch|vor|nach|über|unter|zwischen|wenn|dann|aber|oder|auch|noch|schon|bleibt|gilt|Kopie|Regel|Regeln|Gruppe|Breite|Höhe|ziehen|Sperren|Entsperren|Selektion|Vorschau|Wert|Feld)\b|[äöüßÄÖÜ]/;

// * Planning ids, design batches, ledger refs, phase numbers, and dates.
const INTERNAL_SHORTHAND =
    /\bplan\s*:|\bplan\s+(?:phase\s+)?(?:[A-Z]\d+|\d+(?:\.\d+)*)\b|\b[DBKMWRS]\d+\b|\b\d{2}\.\d{2}\./;

// * German markers that are unambiguous in English prose (case-insensitive).
const GERMAN_EXTRA = /\b(?:immer|gewinnt)\b/i;

// * First-argument test/describe titles only; `.each([...])` tables stay out of scope.
const TEST_TITLE = /\b(?:it|test|describe)(?:\.\w+)?\s*\(\s*(["'`])([^"'`\n]*?)\1/g;

// * Better Comments tags accepted at a block head; `:` counts as a separator.
const TAG_HEAD =
    /^(?:!!|!(?=[\s:]|$)|\?\?(?=[\s:]|$)|\?(?=[\s:]|$)|TODO(?:\[[^\]]+\])?(?=[\s:]|$)|FIXME(?=[\s:]|$)|bug(?=[\s:]|$)|~(?=[\s:]|$)|note(?=[\s:]|$)|warn(?:ing)?(?=[\s:]|$)|sec(?=[\s:]|$)|\*(?=[\s:]|$))/;

// * Structural heads carry no prose and never need a tag.
const STRUCTURE_HEAD = /^(?:MARK:|─{2,}|-{3,})/;

// * Tool pragmas stay exempt from the tag rule.
const PRAGMA_HEAD =
    /^(?:allow-[\w-]+|svelte-ignore\b|@ts-[\w-]+|@vitest-[\w-]+|eslint-[\w-]+|prettier-ignore\b|istanbul\b|c8\b|v8\b|@__PURE__|\/\s*<reference\b)/;

// ! Product-copy phrases hide the engineering rationale; fail the strict gate.
const MARKETING_HARD = new RegExp(
    `\\b(${[
        "seamless(?:ly)?",
        "effortless(?:ly)?",
        "blazing(?:ly)?",
        "cutting-edge",
        "world-class",
        "unleash(?:es|ed|ing)?",
        "game-chang(?:er|ers|ing)",
        "supercharg(?:e|es|ed|ing)",
        "next-level",
        "best-in-class",
        "state-of-the-art",
        "revolution(?:ary|aries|ize|izes|ized|izing)?",
    ].join("|")})\\b`,
    "i",
);

// ? Context-dependent terms: surface them for review, never fail the gate.
const MARKETING_SOFT = new RegExp(
    `\\b(${[
        "powerful(?:ly)?",
        "robust(?:ly|ness)?",
        "elegant(?:ly)?",
        "delight(?:ful|fully|s|ed|ing)?",
        "leverag(?:e|es|ed|ing)",
        "simply",
        "just works",
        "obviously",
        "of course",
    ].join("|")})\\b`,
    "i",
);

/** Recursively collects scannable files. */
function collect(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === "dist") continue;
            out.push(...collect(path));
        } else if (EXTENSIONS.has(extname(entry.name))) {
            out.push(path);
        }
    }
    return out;
}

const isRegexStart = (previous) => previous === "" || "=(:,[!&|?{};>".includes(previous);

/** True when code precedes the comment marker on its line. */
const isInline = (text, index) => text.slice(text.lastIndexOf("\n", index - 1) + 1, index).trim().length > 0;

/** Extracts line comments and block comments from JS/TS source. */
function scanJs(text, startLine = 1) {
    const comments = [];
    let i = 0;
    let line = startLine;
    let mode = null;
    let previous = "";
    while (i < text.length) {
        const ch = text[i];
        const next = text[i + 1];
        if (mode !== null) {
            if (ch === "\\") {
                i += 2;
                continue;
            }
            if (ch === "\n") line += 1;
            if (ch === mode) mode = null;
            i += 1;
            continue;
        }
        if (ch === "\n") {
            line += 1;
            i += 1;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === "`") {
            mode = ch;
            i += 1;
            continue;
        }
        if (ch === "/" && next === "/") {
            const commentLine = line;
            let end = i + 2;
            while (end < text.length && text[end] !== "\n") end += 1;
            comments.push({ line: commentLine, text: text.slice(i, end).trim(), inline: isInline(text, i) });
            i = end;
            continue;
        }
        if (ch === "/" && next === "*") {
            const commentLine = line;
            let end = i + 2;
            while (end < text.length && !(text[end] === "*" && text[end + 1] === "/")) {
                if (text[end] === "\n") line += 1;
                end += 1;
            }
            const commentEnd = Math.min(text.length, end + 2);
            comments.push({ line: commentLine, text: text.slice(i, commentEnd).trim(), inline: isInline(text, i) });
            i = commentEnd;
            continue;
        }
        if (ch === "/" && isRegexStart(previous)) {
            // * Skip regex literals so `//` and `/*` inside them are not comments.
            let end = i + 1;
            let inClass = false;
            let closed = false;
            while (end < text.length && text[end] !== "\n") {
                if (text[end] === "\\") {
                    end += 2;
                    continue;
                }
                if (text[end] === "[") inClass = true;
                else if (text[end] === "]") inClass = false;
                else if (text[end] === "/" && !inClass) {
                    closed = true;
                    end += 1;
                    break;
                }
                end += 1;
            }
            if (closed) {
                i = end;
                continue;
            }
        }
        if (!/\s/.test(ch)) previous = ch;
        i += 1;
    }
    return comments;
}

/** Extracts block comments from CSS text. */
function scanCss(text, startLine = 1) {
    const comments = [];
    const regex = /\/\*[\s\S]*?\*\//g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const line = startLine + text.slice(0, match.index).split("\n").length - 1;
        comments.push({ line, text: match[0].trim(), inline: isInline(text, match.index) });
    }
    return comments;
}

/** Extracts first-argument titles from it/test/describe calls. */
function extractTestTitles(source) {
    TEST_TITLE.lastIndex = 0;
    const titles = [];
    let match;
    while ((match = TEST_TITLE.exec(source)) !== null) {
        const line = source.slice(0, match.index).split("\n").length;
        titles.push({ line, text: match[2] });
    }
    return titles;
}

/** Extracts comments from a source file, respecting the file type. */
function extract(path, source) {
    const extension = extname(path);
    if (extension === ".css") return scanCss(source);
    if (extension === ".html" || extension === ".svelte") {
        const comments = [];
        const htmlRegex = /<!--[\s\S]*?-->/g;
        let match;
        while ((match = htmlRegex.exec(source)) !== null) {
            const line = source.slice(0, match.index).split("\n").length;
            comments.push({ line, text: match[0].trim(), inline: isInline(source, match.index) });
        }
        const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
        while ((match = scriptRegex.exec(source)) !== null) {
            const line = source.slice(0, match.index + match[0].indexOf(">") + 1).split("\n").length;
            comments.push(...scanJs(match[1], line));
        }
        const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
        while ((match = styleRegex.exec(source)) !== null) {
            const line = source.slice(0, match.index + match[0].indexOf(">") + 1).split("\n").length;
            comments.push(...scanCss(match[1], line));
        }
        return comments;
    }
    return scanJs(source);
}

/** Returns the first non-empty head line of a comment body, markers removed. */
function headText(comment) {
    const raw = comment.text;
    let body;
    if (raw.startsWith("//")) body = raw.slice(2);
    else if (raw.startsWith("<!--")) body = raw.slice(4).replace(/-->$/, "");
    else if (raw.startsWith("/*")) body = raw.slice(2).replace(/\*\/$/, "");
    else body = raw;
    const lines = body.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
        let value = lines[index].trim();
        if (value === "") continue;
        // * A leading `*` on a continuation line is a block marker, not a tag.
        if (index > 0) value = value.replace(/^\*\s*/, "").trim();
        return value;
    }
    return "";
}

/** Returns human-readable findings for one file. */
function audit(path) {
    const source = readFileSync(path, "utf8");
    const allowLong = source.includes("allow-long-comment");
    const comments = extract(path, source)
        .filter((comment) => !comment.text.includes("svelte-ignore"))
        .sort((a, b) => a.line - b.line);
    const findings = [];
    if (/\.(?:test|spec)\.ts$/.test(path)) {
        for (const title of extractTestTitles(source)) {
            if (INTERNAL_SHORTHAND.test(title.text)) {
                findings.push({ line: title.line, rule: "shorthandTitle" });
            }
        }
    }
    let blockStart = null;
    let blockLength = 0;
    let previousLine = -2;
    let previousStandaloneLine = false;

    for (const comment of comments) {
        const singleLine = !comment.text.includes("\n");
        if ((GERMAN.test(comment.text) || GERMAN_EXTRA.test(comment.text)) && !comment.text.includes("allow-german")) {
            findings.push({ line: comment.line, rule: "language" });
        }
        if (INTERNAL_SHORTHAND.test(comment.text)) {
            findings.push({ line: comment.line, rule: "shorthand" });
        }
        if (MARKETING_HARD.test(comment.text)) {
            findings.push({ line: comment.line, rule: "marketing" });
        }
        if (MARKETING_SOFT.test(comment.text)) {
            findings.push({ line: comment.line, rule: "softWording" });
        }
        if (comment.text.split("\n").some((line) => line.length > MAX_LINE)) {
            findings.push({ line: comment.line, rule: "lineLength" });
        }
        const isBlankMarker = /^(\/\/|\*|\/\*|<!--)\s*(\*|\/\/|<!--)?\s*$/.test(comment.text);
        if (isBlankMarker && !allowLong) {
            findings.push({ line: comment.line, rule: "blankLine" });
        }
        // * MARK headers and separator rules carry no prose — exclude them.
        const isStructural = /^(\/\/\s*)?(─+|MARK:)/.test(comment.text);
        if (singleLine && comment.line === previousLine + 1) {
            if (!isStructural) blockLength += 1;
        } else {
            blockStart = comment.line;
            blockLength = isStructural ? 0 : 1;
        }
        // * Only the head of a standalone block needs a tag; continuation and
        // * trailing comments, JSDoc blocks, and pragmas stay exempt.
        const isLineComment = comment.text.startsWith("//");
        const standalone = !comment.inline;
        const continues = standalone && isLineComment && previousStandaloneLine && comment.line === previousLine + 1;
        if (!continues && standalone && !comment.text.startsWith("/**")) {
            const head = headText(comment);
            if (head !== "" && !TAG_HEAD.test(head) && !STRUCTURE_HEAD.test(head) && !PRAGMA_HEAD.test(head)) {
                findings.push({ line: comment.line, rule: "tag" });
            }
        }
        previousStandaloneLine = standalone && isLineComment;
        previousLine = comment.line;
        if (blockLength === MAX_BLOCK + 1 && !allowLong) {
            findings.push({ line: blockStart, rule: "blockLength" });
        }
    }
    return findings.sort((a, b) => a.line - b.line);
}

const files = [
    ...SCAN_DIRS.flatMap((dir) => collect(join(ROOT, dir))),
    ...EXTRA_FILES.map((file) => join(ROOT, file)),
].filter((file) => EXTENSIONS.has(extname(file)));

const entries = [];
for (const file of files) {
    const label = relative(ROOT, file).replaceAll("\\", "/");
    for (const finding of audit(file)) entries.push({ file: label, line: finding.line, ...RULES[finding.rule] });
}

const errors = entries.filter((entry) => !entry.soft);
const warnings = entries.filter((entry) => entry.soft);
const clean = errors.length === 0 && warnings.length === 0;
const failed = errors.length > 0;

const COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code, text) => (COLOR ? `\u001b[${code}m${text}\u001b[0m` : text);
const out = (line = "") => process.stdout.write(`${line}\n`);

const CATEGORY_ORDER = ["tags", "length", "language", "shorthand", "wording", "format", "titles"];
const columnCount = (items, category) => items.filter((item) => item.category === category).length;

// * Groups follow CATEGORY_ORDER; the reason is the group title, the action shared.
const groupByRule = (items) => {
    const groups = new Map();
    for (const category of CATEGORY_ORDER) {
        for (const item of items) {
            if (item.category !== category) continue;
            if (!groups.has(item.reason)) groups.set(item.reason, []);
            groups.get(item.reason).push(item);
        }
    }
    return groups;
};

const printGroup = (reason, items, indent, color) => {
    const pad = " ".repeat(indent);
    out(`${pad}${paint(color, `${reason} (${items.length})`)}`);
    const labelPad = " ".repeat(indent + 2);
    const kv = (label, value) => out(`${labelPad}${paint("2", label.padEnd(6))}  ${value}`);
    kv("action", items[0].action);
    kv("at", `${items[0].file}:${items[0].line}`);
    for (const item of items.slice(1)) out(`${labelPad}        ${item.file}:${item.line}`);
};

const printOverview = () => {
    const rows = CATEGORY_ORDER.map((category) => [
        category,
        columnCount(errors, category),
        columnCount(warnings, category),
    ]);
    const total = [0, 1].map((index) => rows.reduce((sum, row) => sum + row[index + 1], 0));
    const labelWidth = Math.max(...rows.map((row) => row[0].length), 6) + 4;
    const columnWidth = 10;
    const rowLine = (label, values) =>
        `    ${label.padEnd(labelWidth)}${values.map((value) => String(value).padStart(columnWidth)).join("")}`;
    out();
    out(`  ${paint("1", "OVERVIEW")}`);
    out(`    ${"".padEnd(labelWidth)}${["errors", "warnings"].map((text) => text.padStart(columnWidth)).join("")}`);
    for (const row of rows) out(rowLine(row[0], row.slice(1)));
    out(`    ${"─".repeat(labelWidth + columnWidth * 2)}`);
    out(rowLine("total", total));
    out();
    const scope = SCAN_DIRS.map((dir) => `${dir}/${GLOB_ANY}`).join(" + ");
    out(`    ${paint("2", "scope".padEnd(6))} ${files.length} files · ${scope} + ${EXTRA_FILES.length} root file(s)`);
    out(
        `    ${paint("2", "limits".padEnd(6))} block ≤ ${MAX_BLOCK} lines · line ≤ ${MAX_LINE} chars · English · tagged heads`,
    );
    out(`    ${paint("2", "mode".padEnd(6))} ${STRICT ? "strict" : "report"}`);
};

out(
    `${paint("1", "comments:check")} ${paint("2", "·")} ${files.length} files ${paint("2", "·")} ${STRICT ? "strict" : "report"}`,
);
out(paint("2", "─".repeat(60)));

if (clean) {
    out();
    out(`  ${paint("32", "no findings")}`);
    out();
    out(`  ${paint("1", "OVERVIEW")}`);
    out(`    ${paint("2", "files")} ${files.length} · ${paint("2", "errors")} 0 · ${paint("2", "warnings")} 0`);
} else {
    out();
    out(`  ${paint("1;31", `${errors.length} error(s)`)} ${paint("2", "·")} ${warnings.length} warning(s)`);
    out();
    let firstGroup = true;
    for (const [reason, items] of groupByRule(errors)) {
        if (!firstGroup) out();
        printGroup(reason, items, 2, "1");
        firstGroup = false;
    }
    if (warnings.length > 0) {
        if (!firstGroup) out();
        out(`  ${paint("1", "warnings")} (${warnings.length})`);
        for (const [reason, items] of groupByRule(warnings)) printGroup(reason, items, 4, "33");
    }
    printOverview();
}

out();
out(paint("2", "─".repeat(60)));
out(`    ${paint("1", "RESULT")}   ${failed ? paint("1;31", "FAILED") : paint("32", "OK")}`);
out(paint("2", "─".repeat(60)));

if (STRICT && failed) process.exitCode = 1;
