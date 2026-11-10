// ─────────────────────────────────────────────────────────────────────────────
// MARK: adr-index — shared ADR parsing + generated INDEX table
// ─────────────────────────────────────────────────────────────────────────────
// * Single source for the ADR table: `gen-docs-index.mjs` writes it, `check-docs.mjs`
// * re-renders it in memory and fails on drift. Keep this deterministic.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const ADR_FILE_RE = /^(\d{4})-([a-z0-9-]+)\.md$/;
export const ADR_INDEX_START = "<!-- ADR-INDEX:START -->";
export const ADR_INDEX_END = "<!-- ADR-INDEX:END -->";

/**
 * Parses one ADR file into the fields the index needs.
 * @returns {{file: string, number: string, title: string, titleNumber: string|null, status: string, date: string}|null}
 */
export function parseAdr(src, file) {
    const name = file.match(ADR_FILE_RE);
    if (!name) return null;
    const title = src.match(/^#\s+ADR\s+(\d{4}):\s*(.+)$/m);
    const status = src.match(/^-\s*Status:\s*(.+)$/m);
    const dateLine = src.match(/^-\s*Date:\s*(\d{4}-\d{2}-\d{2})/m);
    const dateInStatus = src.match(/^-\s*Status:[^\n]*?(\d{4}-\d{2}-\d{2})/m);
    return {
        file,
        number: name[1],
        title: title ? title[2].trim() : "",
        titleNumber: title ? title[1] : null,
        status: status ? status[1].trim() : "",
        date: dateLine ? dateLine[1] : dateInStatus ? dateInStatus[1] : "",
    };
}

/** Reads and parses the active ADRs (never the archive), sorted by number. */
export function readActiveAdrs(adrDir) {
    return readdirSync(adrDir)
        .filter((file) => file.endsWith(".md"))
        .map((file) => parseAdr(readFileSync(join(adrDir, file), "utf8"), file))
        .filter((adr) => adr !== null)
        .sort((a, b) => Number(a.number) - Number(b.number));
}

function statusLabel(status) {
    if (/^superseded/i.test(status)) return "superseded";
    if (/amend/i.test(status)) return "amended";
    return "accepted";
}

function cell(text) {
    return text.replace(/\|/g, "\\|");
}

/** Renders a left-aligned markdown table (Prettier-stable widths). */
function renderTable(header, rows) {
    const widths = header.map((title, index) => Math.max(3, title.length, ...rows.map((row) => row[index].length)));
    const line = (row) => `| ${row.map((value, index) => value.padEnd(widths[index])).join(" | ")} |`;
    const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
    return [line(header), separator, ...rows.map(line)].join("\n");
}

/** Renders the full marker block. */
export function renderAdrIndexBlock(adrs) {
    const rows = adrs.map((adr) => [
        `[${adr.number}](../adr/${adr.file})`,
        cell(adr.title),
        statusLabel(adr.status),
        adr.date || "—",
    ]);
    const table = renderTable(["ADR", "Decision", "Status", "Date"], rows);
    return [ADR_INDEX_START, table, ADR_INDEX_END].join("\n");
}

/**
 * Normalizes a marker block for semantic comparison — Prettier may reflow the
 * table padding, so only cell content counts (the separator row is dropped).
 */
export function normalizeAdrIndexBlock(block) {
    return block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("|") && !/^\|\s*-{3,}/.test(line.replace(/\s+/g, " ")))
        .map((line) => line.replace(/\s+/g, " "))
        .join("\n");
}
