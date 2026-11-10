// ─────────────────────────────────────────────────────────────────────────────
// MARK: check-docs — docs-as-code gate for docs/architecture + docs/adr
// ─────────────────────────────────────────────────────────────────────────────
// ! Gate, not linter: fails on missing docs, broken reference paths, missing
// !   mandatory sections, a drifted ADR index, or an oversized Verified footer.
// * Scope: docs/architecture/*.md, docs/adr/*.md, docs/adr/archive/*.md.
// *   Exit 0 = docs trustworthy.
// * Source of truth: docs/architecture/_template.md; adapt ONLY the PROJECT HOOKs.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
    ADR_FILE_RE,
    ADR_INDEX_END,
    ADR_INDEX_START,
    normalizeAdrIndexBlock,
    readActiveAdrs,
    renderAdrIndexBlock,
} from "./lib/adr-index.mjs";

// ─── PROJECT HOOKS (the only project-specific lines) ──────────────────────────

// * Hook 1: registry file that registers the project's features/components.
//   The gate reads it to enforce doc coverage per registered entry.
//   No registry in this project? Set to null — section 1 is skipped.
const REGISTRY_FILE = null;
// * Hook 2: registration call pattern with one capture group for the variable name.
//   Unused while Hook 1 is null (section 1 is skipped) — kept for the next project
//   that does have a registry.
const REGISTRY_CALL = /registerFeature\((\w+Feature)\)/g;
// * Hook 3: deliberately gitignored path patterns. This project commits its
//   synthetic E2E fixture pages (no privacy concerns), so NOTHING is ignored
//   by design — the regex never matches.
const GLOBALLY_IGNORED_PATH_RE = /$^/;

// ─── End of hooks — everything below is generic ───────────────────────────────

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const archDir = join(root, "docs", "architecture");
const adrDir = join(root, "docs", "adr");
const archiveDir = join(adrDir, "archive");
const todoDir = join(root, "docs", "todo");
const today = new Date().toISOString().slice(0, 10);
const FOOTER_MAX_CHARS = 240;

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const read = (p) => readFileSync(p, "utf8");
const markdownFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith(".md")) : []);

/** Resolves repo-relative path references used in docs. */
const refExists = (ref) => {
    const p = join(root, ref.replace(/`/g, "").trim());
    return existsSync(p);
};

// * Extracts repo-relative path literals (backtick-quoted, no wildcards/spaces).
// * Matches any top-level directory that exists in the repo — projects differ in
// * layout (src/, e2e/, scripts/, docs/); the existence check filters noise.
function extractPaths(markdown) {
    const out = [];
    const re = /`([A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)+)`/g;
    let m;
    while ((m = re.exec(markdown))) {
        const p = m[1];
        if (/\.(md|ts|tsx|js|mjs|svelte|json|jsonc|py|yaml|yml|html|css)$/.test(p)) out.push(p);
    }
    return out;
}

/** Extracts relative Markdown link targets, dropping anchors and external URLs. */
function extractMarkdownLinks(markdown) {
    const out = [];
    for (const match of markdown.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = match[1];
        if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
        const path = target.split("#")[0].split("?")[0];
        if (path !== "") out.push(path);
    }
    return out;
}

/** Checks one doc's relative Markdown links against the filesystem. */
function checkMarkdownLinks(label, filePath, markdown) {
    for (const target of extractMarkdownLinks(markdown)) {
        let resolved;
        try {
            resolved = decodeURIComponent(target);
        } catch {
            resolved = target;
        }
        if (!existsSync(join(dirname(filePath), resolved))) {
            fail(`${label}: broken Markdown link: ${target}`);
        }
    }
}

/** Fails on real path references to the untracked analysis/prototype material. */
function checkLocalOnlyRefs(label, markdown) {
    const re = /(?:`|\]\()(?:\.\.\/|\.\/)?(?:docs\/)?(?:analysis|prototype)\//g;
    for (const match of markdown.matchAll(re)) {
        fail(`${label}: references local-only analysis/prototype path: ${match[0]}`);
    }
}

/** Fails on `docs/adr` / `../adr` references to missing ADR files (incl. archive/). */
function checkAdrReferences(label, markdown) {
    const re = /(?:docs\/adr\/|\.\.\/adr\/)(archive\/)?([0-9]{4}-[a-z0-9-]+\.md)/g;
    for (const match of markdown.matchAll(re)) {
        const dir = match[1] ? archiveDir : adrDir;
        if (!existsSync(join(dir, match[2]))) {
            fail(`${label}: referenced ADR does not exist: ${match[1] || ""}${match[2]}`);
        }
    }
}

// ─── 1. Feature coverage: every registered feature has an INDEX row + doc link ─

const indexSrc = read(join(archDir, "INDEX.md"));
const hasRegistry = REGISTRY_FILE !== null && existsSync(join(root, REGISTRY_FILE));

if (hasRegistry) {
    const regSrc = read(join(root, REGISTRY_FILE));
    const registered = [...regSrc.matchAll(REGISTRY_CALL)].map((m) => m[1]);

    // * Maps registry variable (e.g. gridStylingFeature) → feature id (e.g.
    // * "grid-styling") by scanning the features directory for `id: "..."` + the
    // * export that matches the registration variable.
    const registryDir = join(root, dirname(REGISTRY_FILE));
    const featureIdMap = new Map();
    for (const file of readdirSync(registryDir)) {
        if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;
        if (file === "index.ts" || file === "index.js") continue;
        const src = read(join(registryDir, file));
        const idMatch = src.match(/id:\s*"([^"]+)"/);
        for (const varMatch of src.matchAll(/export const (\w+)/g)) {
            if (idMatch) featureIdMap.set(varMatch[1], idMatch[1]);
        }
    }

    for (const regVar of registered) {
        const id = featureIdMap.get(regVar);
        if (!id) {
            fail(`could not resolve feature id for ${regVar} — check its "id" export`);
            continue;
        }
        if (!indexSrc.includes("`" + id + "`")) {
            fail(`registered feature "${id}" has no row in docs/architecture/INDEX.md (feature coverage gap)`);
        }
    }
}

// * INDEX rows with "documented" must link an existing doc.
for (const m of indexSrc.matchAll(/\|\s*`([\w-]+)`\s*\|\s*\[[^\]]+\]\(([^)]+)\)\s*\|\s*documented[^|]*\|/g)) {
    const doc = join(archDir, m[2].replace(/^\.?\//, ""));
    if (!existsSync(doc)) fail(`INDEX.md links missing doc: ${m[2]}`);
}

// ─── 2. Mandatory sections — feature docs vs cross-cutting docs ────────────────

// * Feature docs are the ones linked with "documented" status from the INDEX coverage
// * table. Cross-cutting docs (system-overview, testing, ...) only need References +
// * Verified. INDEX.md is the classification source of truth.
const featureDocs = new Set(
    [...indexSrc.matchAll(/\|\s*`([\w-]+)`\s*\|\s*\[[^\]]+\]\(([^)]+)\)\s*\|\s*documented[^|]*\|/g)].map((m) =>
        m[2].replace(/^\.?\//, ""),
    ),
);

const REQUIRED_ALL = [/## References/];
const REQUIRED_FEATURE = [/## Component Structure/, /## Scope Boundaries/];

for (const file of readdirSync(archDir)) {
    if (!file.endsWith(".md") || file === "INDEX.md" || file === "_template.md") continue;
    const src = read(join(archDir, file));
    const isFeatureDoc = featureDocs.has(file);

    for (const section of [...REQUIRED_ALL, ...(isFeatureDoc ? REQUIRED_FEATURE : [])]) {
        if (!section.test(src)) {
            const kind = isFeatureDoc ? "feature doc" : "doc";
            fail(`${file}: missing mandatory section for ${kind}: "${section.source.replace(/\\/g, "")}"`);
        }
    }

    // * Exactly one Verified footer; date + scope only, no changelog.
    const footers = [...src.matchAll(/^Verified:\s*(\d{4}-\d{2}-\d{2})/gm)];
    if (footers.length !== 1) {
        fail(`${file}: expected exactly one "Verified: YYYY-MM-DD" footer, found ${footers.length}`);
    } else {
        const date = footers[0][1];
        const parsed = new Date(`${date}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
            fail(`${file}: Verified footer has an invalid date: ${date}`);
        } else if (date > today) {
            fail(`${file}: Verified footer date is in the future: ${date}`);
        }
        const footerStart = src.search(/^Verified:/m);
        const footerBlock =
            footerStart === -1
                ? ""
                : src
                      .slice(footerStart)
                      .split(/\r?\n\s*\r?\n/)[0]
                      .trim();
        const footerLength = footerBlock.length;
        if (footerLength > FOOTER_MAX_CHARS) {
            fail(
                `${file}: Verified footer is ${footerLength} chars (max ${FOOTER_MAX_CHARS}) — ` +
                    `keep date + scope, move history to git`,
            );
        }
    }

    // * Architecture docs are diagrams + prose; only mermaid fences are allowed.
    const fenceLines = [...src.matchAll(/^```(.*)$/gm)];
    if (fenceLines.length % 2 !== 0) {
        fail(`${file}: unbalanced code fences`);
    }
    for (let i = 0; i < fenceLines.length; i += 2) {
        const language = fenceLines[i][1].trim();
        if (language !== "mermaid") {
            fail(`${file}: non-mermaid code block in an architecture doc (language: "${language || "none"}")`);
        }
    }

    // ─── 3. Reference paths must exist ────────────────────────────────────────

    for (const ref of extractPaths(src)) {
        if (!refExists(ref)) {
            // * Hook 3: gitignored-by-design references (fixtures) — warn, don't fail.
            if (GLOBALLY_IGNORED_PATH_RE.test(ref)) {
                warn(`${file}: referenced path is gitignored by design (fixtures absent on fresh clones): ${ref}`);
                continue;
            }
            fail(`${file}: referenced path does not exist: ${ref}`);
        }
    }

    // ─── 4. Mermaid sanity ─────────────────────────────────────────────────────

    const mermaidBlocks = [...src.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
    if (mermaidBlocks.length === 0) {
        warn(`${file}: no mermaid diagram found (component docs should have at least one)`);
    }
    for (const block of mermaidBlocks) {
        const firstLine = block.trim().split("\n")[0].trim();
        const known =
            /^(flowchart|sequenceDiagram|classDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie|mindmap|gitGraph)\b/;
        if (!known.test(firstLine)) {
            fail(`${file}: mermaid block starts with unknown diagram type: "${firstLine}"`);
        }
        if (block.includes("\\n")) {
            fail(`${file}: mermaid label contains literal \\n — use <br/> for portability`);
        }
        // * subgraph/end balancing applies to flowcharts only — sequenceDiagram uses "end"
        // * for alt/opt/loop blocks, which would false-positive.
        if (/^flowchart\b/.test(firstLine)) {
            const openSubs = (block.match(/subgraph /g) || []).length;
            const closeSubs = (block.match(/^\s*end\b/gm) || []).length;
            if (openSubs !== closeSubs) {
                fail(`${file}: mermaid subgraph/end mismatch (${openSubs} subgraph vs ${closeSubs} end)`);
            }
        }
    }
}

// ─── 5. ADR sanity — numbering, titles, status, sections, index drift ─────────

const adrFiles = markdownFiles(adrDir);
const archivedFiles = markdownFiles(archiveDir);
const allAdrFiles = [...adrFiles, ...archivedFiles];
const adrByNumber = new Map();

for (const file of allAdrFiles) {
    const src = read(join(adrFiles.includes(file) ? adrDir : archiveDir, file));
    const nameMatch = file.match(ADR_FILE_RE);
    if (!nameMatch) {
        fail(`${file}: ADR filename must match NNNN-slug.md`);
        continue;
    }
    const number = nameMatch[1];
    if (adrByNumber.has(number)) {
        fail(`${file}: duplicate ADR number ${number} (also ${adrByNumber.get(number)})`);
    } else {
        adrByNumber.set(number, file);
    }
    const title = src.match(/^#\s+ADR\s+(\d{4}):/m);
    if (!title) {
        fail(`${file}: missing "# ADR NNNN:" title`);
    } else if (title[1] !== number) {
        fail(`${file}: title ADR ${title[1]} does not match filename ${number}`);
    }
    const status = src.match(/^-\s*Status:\s*(.+)$/m);
    if (!status) {
        fail(`${file}: missing "- Status:" line`);
    } else if (/superseded/i.test(status[1])) {
        const target = status[1].match(/ADR\s+(\d{4})/);
        if (!target) fail(`${file}: superseded status must name "ADR NNNN"`);
        else if (!allAdrFiles.some((candidate) => candidate.startsWith(`${target[1]}-`))) {
            fail(`${file}: superseded target ADR ${target[1]} does not exist`);
        }
    }

    // * Archived records are frozen history: format only, no structure gate.
    if (!archivedFiles.includes(file)) {
        for (const section of [/## Context/, /## Decision/, /## Consequences/]) {
            if (!section.test(src)) {
                fail(`${file}: missing mandatory ADR section "${section.source.replace(/\\/g, "")}"`);
            }
        }
    }
}

// * The active ADR table is generated — drift means someone edited it by hand.
const indexStart = indexSrc.indexOf(ADR_INDEX_START);
const indexEnd = indexSrc.indexOf(ADR_INDEX_END);
if (indexStart === -1 || indexEnd === -1 || indexEnd < indexStart) {
    fail(`INDEX.md: missing ${ADR_INDEX_START} / ${ADR_INDEX_END} markers`);
} else {
    const actual = normalizeAdrIndexBlock(indexSrc.slice(indexStart, indexEnd + ADR_INDEX_END.length));
    const expected = normalizeAdrIndexBlock(renderAdrIndexBlock(readActiveAdrs(adrDir)));
    if (actual !== expected) {
        fail(`INDEX.md: ADR table is out of date — run "npm run docs:index"`);
    }
}

// * Every architecture doc (except INDEX/_template) must appear in INDEX.
const archFiles = readdirSync(archDir).filter(
    (file) => file.endsWith(".md") && file !== "INDEX.md" && file !== "_template.md",
);
for (const file of archFiles) {
    if (!indexSrc.includes(`(${file})`)) {
        fail(`INDEX.md: missing row/link for architecture doc ${file}`);
    }
}

// * Cross-doc link/ref integrity for all tracked documentation.
const trackedDocs = [
    ...archFiles.map((file) => join(archDir, file)),
    ...adrFiles.map((file) => join(adrDir, file)),
    ...archivedFiles.map((file) => join(archiveDir, file)),
    join(root, "README.md"),
    join(root, "CONTEXT.md"),
    ...markdownFiles(todoDir).map((file) => join(todoDir, file)),
];

for (const filePath of trackedDocs) {
    const label = relative(root, filePath).replace(/\\/g, "/");
    const src = read(filePath);
    checkMarkdownLinks(label, filePath, src);
    checkLocalOnlyRefs(label, src);
    checkAdrReferences(label, src);
}

// ─── Report ───────────────────────────────────────────────────────────────────

for (const w of warnings) console.warn(`docs:check WARN  ${w}`);
for (const e of errors) console.error(`docs:check FAIL  ${e}`);
const fileCount = readdirSync(archDir).filter((file) => file.endsWith(".md")).length + allAdrFiles.length;
console.log(`docs:check — ${fileCount} files, ` + `${errors.length} error(s), ${warnings.length} warning(s)`);
if (errors.length > 0) {
    process.exitCode = 1;
}
