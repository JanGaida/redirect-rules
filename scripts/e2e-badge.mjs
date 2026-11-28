// ─────────────────────────────────────────────────────────────────────────────
// MARK: e2e-badge — Playwright JSON -> shields endpoint badge
// ─────────────────────────────────────────────────────────────────────────────
// * Thresholds: 100 % success, >= 80 % warning, else failure (owner contract).
// * Palette: GitHub state colors — #28a745 / #dbab09 / #cb2431 — so the chip sits
// * on the same green as the Actions badge.
// * Missing or corrupt report -> 0/0 failure: a crashed run must never look green.
// * Usage: node scripts/e2e-badge.mjs <playwright-json> <label> <out-file>

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [reportPath, label, outPath] = process.argv.slice(2);

if (!reportPath || !label || !outPath) {
    console.error("usage: e2e-badge.mjs <playwright-json> <label> <out-file>");
    process.exit(2);
}

/** Reads the Playwright stats block; a missing report counts as an empty run. */
function readStats(path) {
    try {
        const report = JSON.parse(readFileSync(path, "utf8"));
        return report?.stats ?? {};
    } catch {
        return {};
    }
}

/** Coerces a stats counter to a non-negative integer. */
function count(value) {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

const stats = readStats(reportPath);
// * Flaky tests passed on retry — they count as passed, not as failures.
const passed = count(stats.expected) + count(stats.flaky);
const total = passed + count(stats.unexpected) + count(stats.skipped);
const ratio = total === 0 ? 0 : passed / total;
const color = total > 0 && passed === total ? "#28a745" : ratio >= 0.8 ? "#dbab09" : "#cb2431";

const badge = { schemaVersion: 1, label, message: `${passed}/${total}`, color };
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(badge)}\n`);
console.log(`${label}: ${badge.message} (${badge.color}) -> ${outPath}`);
