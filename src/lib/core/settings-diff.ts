// ─────────────────────────────────────────────────────────────────────────────
// MARK: Settings diff — unsaved-change counting
// ─────────────────────────────────────────────────────────────────────────────
// * Row granularity: each added/removed/modified site or rule counts 1.
// * Ordered compare: moves count as changes (no stable row identity).
// * Pure: the store owns the saved mirror; App derives the count from both.

import type { Settings, UrlRule } from "./settings";

/**
 * Counts row-level changes between the saved and the working settings.
 *
 * * Added/removed sites count 1 (the gate row) PLUS their added/removed rules
 *   — an added site's rules ARE added rules (every added/
 *   removed/modified site OR rule counts 1).
 *
 * @param saved   - The last persisted settings (the store's saved mirror).
 * @param current - The live working settings.
 * @returns The number of changed (added/removed/modified) site and rule rows.
 */
export function countChanges(saved: Settings, current: Settings): number {
    const savedSites = saved.rules;
    const currentSites = current.rules;

    let count = 0;

    // * Removed site tail: the gate row + every rule row it takes with it.
    for (let i = Math.min(savedSites.length, currentSites.length); i < savedSites.length; i++) {
        count += 1 + countRuleChanges(savedSites[i].rules, []);
    }
    // * Added site tail: the gate row + every rule row it brings.
    for (let i = Math.min(savedSites.length, currentSites.length); i < currentSites.length; i++) {
        count += 1 + countRuleChanges([], currentSites[i].rules);
    }

    // * Same-index sites: gate or description change counts 1, rules compared per row.
    const common = Math.min(savedSites.length, currentSites.length);
    for (let i = 0; i < common; i++) {
        if (
            savedSites[i].siteRegex !== currentSites[i].siteRegex ||
            (savedSites[i].description ?? "") !== (currentSites[i].description ?? "") ||
            (savedSites[i].disabled === true) !== (currentSites[i].disabled === true)
        ) {
            count++;
        }
        count += countRuleChanges(savedSites[i].rules, currentSites[i].rules);
    }
    return count;
}

/** Row-level diff of one site's rule list (added/removed/modified rules). */
function countRuleChanges(saved: UrlRule[], current: UrlRule[]): number {
    let count = Math.abs(saved.length - current.length);
    const common = Math.min(saved.length, current.length);
    for (let i = 0; i < common; i++) {
        if (JSON.stringify(saved[i]) !== JSON.stringify(current[i])) count++;
    }
    return count;
}
