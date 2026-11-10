// ─────────────────────────────────────────────────────────────────────────────
// MARK: GUI validation policy — invalid-regex counting + empty-row pruning
// ─────────────────────────────────────────────────────────────────────────────
// * Persist policy (legacy parity, pinned in gui.md): rows with no usable
//   regex/params are incomplete and block autosave; entirely empty rows are
//   dropped on save (a NON-EMPTY regex that does not compile also blocks —
//   the legacy editor skipped bad rows silently, which hid authoring mistakes).
// * Empty site groups (empty gate or zero rules) are incomplete: prune-on-save
//   drops them, so the autosave gate pauses before they can vanish.

import { isValidRegex } from "../core/parse-regex";
import { isRuleEmpty, isRuleIncomplete, ruleRegexInvalid } from "../core/rule-policy";
import { isSiteEnabled, type Settings, type SiteRule } from "../core/settings";

/**
 * Counts NON-EMPTY regexes that do not compile — every hit blocks saving.
 *
 * @param settings - The live settings.
 */
export function invalidRegexCount(settings: Settings): number {
    let count = 0;
    for (const site of settings.rules) {
        if (!isSiteEnabled(site)) continue;
        if (site.siteRegex !== "" && !isValidRegex(site.siteRegex)) count++;
        for (const rule of site.rules) {
            if (ruleRegexInvalid(rule)) count++;
        }
    }
    return count;
}

/**
 * Whether a site group is incomplete — empty gate, no rules, or a rule with no
 * usable regex/params.
 *
 * @param site - The site group to test.
 */
export function isSiteIncomplete(site: SiteRule): boolean {
    return site.siteRegex === "" || site.rules.length === 0 || site.rules.some((rule) => isRuleIncomplete(rule));
}

/**
 * Whether the gate or any rule regex in the group fails to compile.
 *
 * @param site - The site group to test.
 */
export function siteHasInvalidRegex(site: SiteRule): boolean {
    if (site.siteRegex !== "" && !isValidRegex(site.siteRegex)) return true;
    return site.rules.some((rule) => ruleRegexInvalid(rule));
}

/**
 * Whether a site group would block autosave (invalid or incomplete content).
 * @param site - The site group to test.
 */
export function isSitePersistBlocked(site: SiteRule): boolean {
    // * Off groups are inert: a broken/parked group must be saveable (emergency switch).
    if (!isSiteEnabled(site)) return false;
    return isSiteIncomplete(site) || siteHasInvalidRegex(site);
}

/**
 * Prunes entirely-empty rules and empty site groups (in place, mirrors the legacy
 * save behavior) — call right before persisting.
 *
 * @param settings - The live settings (mutated).
 * @returns The same object, for chaining.
 */
export function pruneEmptyRows(settings: Settings): Settings {
    for (const site of settings.rules) {
        // * Off groups stay untouched — parked drafts survive save/prune.
        if (!isSiteEnabled(site)) continue;
        site.rules = site.rules.filter((rule) => !isRuleEmpty(rule));
    }
    settings.rules = settings.rules.filter(
        (site) => !isSiteEnabled(site) || (site.siteRegex !== "" && site.rules.length > 0),
    );
    return settings;
}
