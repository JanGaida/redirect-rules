// ─────────────────────────────────────────────────────────────────────────────
// MARK: gen-docs-index — regenerate the ADR table in docs/architecture/INDEX.md
// ─────────────────────────────────────────────────────────────────────────────
// * Run after adding/archiving/amending an ADR: npm run docs:index
// * The docs gate fails when the committed block differs — never edit it by hand.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { ADR_INDEX_END, ADR_INDEX_START, readActiveAdrs, renderAdrIndexBlock } from "./lib/adr-index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const adrDir = join(root, "docs", "adr");
const indexPath = join(root, "docs", "architecture", "INDEX.md");

const source = readFileSync(indexPath, "utf8");
const start = source.indexOf(ADR_INDEX_START);
const end = source.indexOf(ADR_INDEX_END);

if (start === -1 || end === -1 || end < start) {
    console.error(`docs:index FAIL  missing ${ADR_INDEX_START} / ${ADR_INDEX_END} in INDEX.md`);
    process.exitCode = 1;
} else {
    const adrs = readActiveAdrs(adrDir);
    const block = renderAdrIndexBlock(adrs);
    const next = source.slice(0, start) + block + source.slice(end + ADR_INDEX_END.length);
    // * Prettier owns the file layout; the gate compares content, not padding.
    const formatted = await prettier.format(next, { filepath: indexPath });
    writeFileSync(indexPath, formatted);
    console.log(`docs:index — ${adrs.length} active ADR(s) written to docs/architecture/INDEX.md`);
}
