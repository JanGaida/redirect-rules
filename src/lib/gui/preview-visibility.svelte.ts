// ─────────────────────────────────────────────────────────────────────────────
// MARK: Preview visibility — global default + per-group overrides (ADR 0040)
// ─────────────────────────────────────────────────────────────────────────────
// * Precedence: effective = local override ?? settings.hideSkipped.
// * Overrides are session-only and keyed by SiteRule IDENTITY — reorder or
// * rename must not move an exception, a cloned group starts with none.
// * Toggling the global switch clears EVERY local override (its reset path).
// * Lives outside the settings store on purpose: overrides never persist.

import { store } from "../stores/settings.svelte";
import type { SiteRule } from "../core/settings";

/**
 * * Plain Map + reactive revision counter: storing the sites in `$state` would
 *   proxy them, so identity lookups against the live (already-proxied) group
 *   could miss. The counter is what the `$derived` readers track.
 */
const overrides = new Map<SiteRule, boolean>();
let revision = $state(0);

/** Local exception for one group, if any (revision read = dependency). */
function overrideFor(site: SiteRule): boolean | undefined {
    void revision;
    return overrides.get(site);
}

/**
 * Effective "hide skipped" value for one group's preview chain.
 *
 * @param site - The previewed group (undefined = global value only).
 */
export function hideSkippedFor(site: SiteRule | undefined): boolean {
    if (site === undefined) return store.settings.hideSkipped;
    return overrideFor(site) ?? store.settings.hideSkipped;
}

/** Whether the group carries a local exception (drives the button indicator). */
export function hasLocalVisibilityOverride(site: SiteRule): boolean {
    return overrideFor(site) !== undefined;
}

/**
 * Local toggle: flips this group's visibility. When the result equals the
 * global default the exception is dropped — the button follows global again.
 *
 * @param site - The previewed group.
 */
export function toggleLocalVisibility(site: SiteRule): void {
    const next = !hideSkippedFor(site);
    if (next === store.settings.hideSkipped) overrides.delete(site);
    else overrides.set(site, next);
    revision += 1;
}

/** Global rail switch: persists the new default and resets all exceptions. */
export function toggleGlobalHideSkipped(): void {
    store.settings.hideSkipped = !store.settings.hideSkipped;
    overrides.clear();
    revision += 1;
}
