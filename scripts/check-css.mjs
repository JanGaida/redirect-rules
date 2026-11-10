// ─────────────────────────────────────────────────────────────────────────────
// MARK: check-css — declared-but-unreferenced styles
// ─────────────────────────────────────────────────────────────────────────────
// * Coverage: classes, @keyframes and --rr-* declarations in src/**/*.css,
// *   referenced from src/** (without __tests__) and e2e/**.
// * Out of scope: index.html inline CSS, attribute selectors, runtime-only rules.
// * Dynamic names: prefix match; the suffix must occur as a code token.
// * Exceptions: IGNORED = static, silent exclusions; everything else is an error.
// * Exit code stays 0 unless --strict is passed.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const STRICT = process.argv.includes("--strict");
const CSS_DIRS = ["src"];
const USAGE_DIRS = ["src", "e2e"];
const USAGE_EXTENSIONS = new Set([".ts", ".svelte"]);
const NESTED_AT_RULES = new Set(["@media", "@supports", "@starting-style", "@layer", "@container", "@scope"]);
const CLASS_PATTERN = /^-?[_a-zA-Z][\w-]*$/;
const CLASS_TOKEN_IN_TEXT = /(?:^|\s)(?:rr-|rh-|is-|has-)[\w-]+/;
const GLOB_ANY = "**";

// * Static exclusions — silent; any other unreferenced declaration is an error.
const IGNORED = {
    classes: [],
    props: [],
    keyframes: [],
};

function collect(dir, predicate) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) out.push(...collect(path, predicate));
        else if (predicate(path)) out.push(path);
    }
    return out;
}

function lineLookup(text) {
    const starts = [0];
    for (let index = 0; index < text.length; index += 1) {
        if (text[index] === "\n") starts.push(index + 1);
    }
    return (index) => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (starts[middle] <= index) low = middle;
            else high = middle - 1;
        }
        return low + 1;
    };
}

function matchBrace(text, open) {
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
        if (text[index] === "{") depth += 1;
        else if (text[index] === "}") {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    return text.length - 1;
}

function stripCodeComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/(^|[^:\w])\/\/[^\n]*/g, "$1 ");
}

function parseCss(file) {
    const raw = readFileSync(file, "utf8");
    // * Keep newlines so reported line numbers match the source file.
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
    const lineAt = lineLookup(text);
    const result = {
        classes: new Map(),
        props: new Map(),
        keyframes: new Map(),
        vars: new Set(),
        animations: new Set(),
    };

    for (const match of text.matchAll(/var\(\s*(--[\w-]+)/g)) result.vars.add(match[1]);
    for (const match of text.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) {
        for (const token of match[1].matchAll(/[-_a-zA-Z][\w-]*/g)) result.animations.add(token[0]);
    }

    const parseRules = (from, to) => {
        let index = from;
        while (index < to) {
            const open = text.indexOf("{", index);
            if (open === -1 || open >= to) break;
            let prelude = text.slice(index, open);
            // * Drop at-rule statements (@import …;) that precede the selector.
            const statementEnd = prelude.lastIndexOf(";");
            if (statementEnd !== -1) prelude = prelude.slice(statementEnd + 1);
            prelude = prelude.trim();
            const close = matchBrace(text, open);
            if (prelude.startsWith("@")) {
                const atRule = prelude.slice(1).split(/[\s(]/, 1)[0].toLowerCase();
                if (atRule === "keyframes" || atRule.endsWith("-keyframes")) {
                    const name = prelude.split(/\s+/)[1];
                    if (name && !result.keyframes.has(name)) result.keyframes.set(name, lineAt(index));
                } else if (NESTED_AT_RULES.has(`@${atRule}`)) {
                    parseRules(open + 1, close);
                }
            } else if (prelude !== "") {
                for (const match of prelude.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
                    if (!result.classes.has(match[1])) result.classes.set(match[1], lineAt(index));
                }
                const body = text.slice(open + 1, close);
                for (const match of body.matchAll(/(--rr-[\w-]+)\s*:/g)) {
                    if (!result.props.has(match[1])) result.props.set(match[1], lineAt(open + 1 + match.index));
                }
            }
            index = close + 1;
        }
    };

    parseRules(0, text.length);
    return { file, ...result };
}

function readUsage(files) {
    const statics = new Set();
    const prefixes = new Set();
    const pool = new Set();
    const props = new Set();

    const addValue = (value) => {
        for (const part of value.split(/\s+/)) {
            if (part === "") continue;
            const brace = part.search(/\$\{|\{/);
            if (brace === -1) {
                if (CLASS_PATTERN.test(part)) statics.add(part);
                continue;
            }
            const head = part.slice(0, brace);
            if (head === "") continue;
            if (head.endsWith("-")) prefixes.add(head);
            else if (CLASS_PATTERN.test(head)) statics.add(head);
        }
    };

    for (const file of files) {
        const code = stripCodeComments(readFileSync(file, "utf8"));
        for (const match of code.matchAll(/[a-zA-Z][\w-]*/g)) pool.add(match[0].toLowerCase());
        for (const match of code.matchAll(/--rr-[\w-]+/g)) props.add(match[0]);
        for (const match of code.matchAll(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) addValue(match[1] ?? match[2]);
        for (const match of code.matchAll(/\bclass:(-?[_a-zA-Z][\w-]*)/g)) statics.add(match[1]);
        for (const match of code.matchAll(/\bclassList\.(?:add|remove|toggle|contains)\(\s*["']([^"']+)["']/g)) {
            addValue(match[1]);
        }
        for (const match of code.matchAll(/\bclassName\s*=\s*["']([^"']*)["']/g)) addValue(match[1]);
        // * Class lists held in plain string literals (e.g. the changelog paragraph builder).
        for (const match of code.matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
            if (CLASS_TOKEN_IN_TEXT.test(match[1])) addValue(match[1]);
        }
    }

    return { statics, prefixes, pool, props };
}

const cssFiles = CSS_DIRS.flatMap((dir) => collect(join(ROOT, dir), (file) => extname(file) === ".css"));
const usageFiles = USAGE_DIRS.flatMap((dir) =>
    collect(join(ROOT, dir), (file) => USAGE_EXTENSIONS.has(extname(file)) && !file.includes("__tests__")),
);
const usage = readUsage(usageFiles);

const classes = new Map();
const props = new Map();
const keyframes = new Map();
const vars = new Set();
const animations = new Set();
for (const parsed of cssFiles.map(parseCss)) {
    const file = relative(ROOT, parsed.file).replaceAll("\\", "/");
    const at = (line) => ({ file, line });
    for (const [name, line] of parsed.classes) if (!classes.has(name)) classes.set(name, at(line));
    for (const [name, line] of parsed.props) if (!props.has(name)) props.set(name, at(line));
    for (const [name, line] of parsed.keyframes) if (!keyframes.has(name)) keyframes.set(name, at(line));
    for (const name of parsed.vars) vars.add(name);
    for (const name of parsed.animations) animations.add(name);
}

const classUsed = (name) => {
    if (usage.statics.has(name)) return true;
    for (const prefix of usage.prefixes) {
        if (!name.startsWith(prefix) || name.length === prefix.length) continue;
        const suffix = name.slice(prefix.length).replace(/^-/, "").toLowerCase();
        if (usage.pool.has(suffix)) return true;
    }
    return false;
};

const findings = [];
const warnings = [];

const evaluate = (group, declared, used, ignored) => {
    const ignoredNames = new Set(ignored.map((entry) => entry.name));
    for (const [name, at] of declared) {
        if (used(name)) {
            if (ignoredNames.has(name)) {
                warnings.push({ group, ...at, name, text: "is referenced now — drop the IGNORED entry" });
            }
            continue;
        }
        if (!ignoredNames.has(name)) findings.push({ group, ...at, name });
    }
    for (const entry of ignored) {
        if (!declared.has(entry.name)) {
            findings.push({ group, file: "—", line: "—", name: entry.name, note: "stale IGNORED entry" });
        }
    }
};

evaluate("classes", classes, classUsed, IGNORED.classes);
evaluate("custom properties", props, (name) => vars.has(name) || usage.props.has(name), IGNORED.props);
evaluate("keyframes", keyframes, (name) => animations.has(name), IGNORED.keyframes);

const COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code, text) => (COLOR ? `\u001b[${code}m${text}\u001b[0m` : text);
const out = (line = "") => process.stdout.write(`${line}\n`);

const ignoredCount = IGNORED.classes.length + IGNORED.props.length + IGNORED.keyframes.length;
const errorCount = findings.length;
const clean = errorCount === 0 && warnings.length === 0;
const failed = errorCount > 0;
const exitCode = STRICT && failed ? 1 : 0;

const GROUP_ORDER = ["classes", "custom properties", "keyframes"];
const GROUP_TITLE = { classes: "classes", "custom properties": "custom properties", keyframes: "keyframes" };
const GROUP_REASON = {
    classes: "no static or dynamic reference in src/ or e2e/",
    "custom properties": "declared, never read via var() or JS",
    keyframes: "declared, never referenced by an animation",
};
const GROUP_REMOVE = {
    classes: "remove the rule",
    "custom properties": "remove the declaration",
    keyframes: "remove the @keyframes block",
};
const GROUP_IGNORE = {
    classes: "IGNORED.classes",
    "custom properties": "IGNORED.props",
    keyframes: "IGNORED.keyframes",
};
const OVERVIEW_LABEL = { "custom properties": "properties" };

const displayName = (item) => (item.group === "classes" ? `.${item.name}` : item.name);
const kv = (label, value) => out(`      ${paint("2", label.padEnd(6))}  ${value}`);
const countIn = (items, group) => items.filter((item) => item.group === group).length;
const declaredIn = (group) =>
    group === "classes" ? classes.size : group === "custom properties" ? props.size : keyframes.size;
const ignoredIn = (group) =>
    group === "classes"
        ? IGNORED.classes.length
        : group === "custom properties"
          ? IGNORED.props.length
          : IGNORED.keyframes.length;

const printFinding = (item) => {
    const missing = item.note === "stale IGNORED entry";
    out(`    ${paint("31", displayName(item))}`);
    kv("at", missing ? "—" : `${item.file}:${item.line}`);
    kv("why", missing ? "IGNORED entry is not declared in CSS" : GROUP_REASON[item.group]);
    kv("action", missing ? `remove the ${GROUP_IGNORE[item.group]} entry` : GROUP_REMOVE[item.group]);
    if (!missing) {
        out(`              ${paint("2", "or")}  ${GROUP_IGNORE[item.group]} { name: "${item.name}", reason: "<why>" }`);
    }
};

const printWarning = (item) => {
    out(`    ${paint("33", displayName(item))}`);
    kv("at", `${item.file}:${item.line}`);
    kv("why", item.text);
    kv("action", `remove the ${GROUP_IGNORE[item.group]} entry`);
};

const printOverview = () => {
    const rows = GROUP_ORDER.map((group) => [
        OVERVIEW_LABEL[group] ?? group,
        declaredIn(group),
        countIn(findings, group),
        ignoredIn(group),
        countIn(warnings, group),
    ]);
    const total = [0, 1, 2, 3].map((index) => rows.reduce((sum, row) => sum + row[index + 1], 0));
    const labelWidth = Math.max(...rows.map((row) => row[0].length), 5) + 4;
    const columnWidth = 10;
    const rowLine = (label, values) =>
        `    ${label.padEnd(labelWidth)}${values.map((value) => String(value).padStart(columnWidth)).join("")}`;
    out();
    out(`  ${paint("1", "OVERVIEW")}`);
    out(
        `    ${"".padEnd(labelWidth)}${["declared", "findings", "ignored", "warnings"].map((text) => text.padStart(columnWidth)).join("")}`,
    );
    for (const row of rows) out(rowLine(row[0], row.slice(1)));
    out(`    ${"─".repeat(labelWidth + columnWidth * 4)}`);
    out(rowLine("total", total));
    out();
    out(
        `    ${paint("2", "scope".padEnd(6))} ${cssFiles.length} stylesheet(s) · ${CSS_DIRS.map((dir) => `${dir}/${GLOB_ANY}/*.css`).join(", ")}`,
    );
    out(
        `    ${paint("2", "refs".padEnd(6))} ${USAGE_DIRS.map((dir) => `${dir}/${GLOB_ANY}`).join(" + ")} (without __tests__)`,
    );
    out(`    ${paint("2", "mode".padEnd(6))} ${STRICT ? "strict" : "report"}`);
};

out(
    `${paint("1", "css:check")} ${paint("2", "·")} ${cssFiles.length} stylesheet(s) ${paint("2", "·")} ${STRICT ? "strict" : "report"}`,
);
out(paint("2", "─".repeat(60)));

if (clean) {
    out();
    out(`  ${paint("32", "no findings")}`);
    out();
    out(`  ${paint("1", "OVERVIEW")}`);
    out(
        `    ${paint("2", "classes")} ${classes.size} · ${paint("2", "properties")} ${props.size} · ` +
            `${paint("2", "keyframes")} ${keyframes.size} · ${paint("2", "ignored")} ${ignoredCount} · ${paint("2", "warnings")} 0`,
    );
} else {
    out();
    out(`  ${paint("1;31", `${errorCount} error(s)`)} ${paint("2", "·")} ${warnings.length} warning(s)`);
    out();
    let firstItem = true;
    const printItem = (render) => {
        if (!firstItem) out();
        render();
        firstItem = false;
    };
    for (const group of GROUP_ORDER) {
        const items = findings.filter((item) => item.group === group);
        if (items.length === 0) continue;
        if (!firstItem) out();
        out(`  ${paint("1", GROUP_TITLE[group])} (${items.length})`);
        for (const item of items) printItem(() => printFinding(item));
    }
    if (warnings.length > 0) {
        if (!firstItem) out();
        out(`  ${paint("1", "warnings")} (${warnings.length})`);
        for (const item of warnings) printItem(() => printWarning(item));
    }
    printOverview();
}

out();
out(paint("2", "─".repeat(60)));
out(`    ${paint("1", "RESULT")}   ${failed ? paint("1;31", "FAILED") : paint("32", "OK")}`);
out(paint("2", "─".repeat(60)));

process.exitCode = exitCode;
