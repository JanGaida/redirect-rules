// ─────────────────────────────────────────────────────────────────────────────
// MARK: Site caption — description-first explorer label
// ─────────────────────────────────────────────────────────────────────────────
// * Display-only: the engine never reads this label.
// * Empty/whitespace description falls back to the readable regex.

import { regexToReadableLiteral } from "../core/parse-regex";
import type { SiteRule } from "../core/settings";

/**
 * Resolves the explorer caption for a site group.
 *
 * @param site - The site group.
 * @returns Trimmed description, else the readable site regex, else "—".
 */
export function siteCaption(site: SiteRule): string {
    const description = site.description?.trim() ?? "";
    return description !== "" ? description : regexToReadableLiteral(site.siteRegex) || "—";
}
