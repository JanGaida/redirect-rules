// ─────────────────────────────────────────────────────────────────────────────
// MARK: Chat template — LLM hand-off text (pure)
// ─────────────────────────────────────────────────────────────────────────────
// * Renders the copy-paste block for the Rule configuration assistant; the user
//   pastes it into any web LLM and adds their wishes.
// * Live from the optional target group only. A selected group is dumped as its
//   FULL settings JSON; without one the LLM asks for the target site.
// * ADR 0014: locale bodies live as Base64 text files under src/lib/data/.
// * The answer contract is strict JSON (single rule or group), see the body.
// * * `$`-safe: placeholders are replaced via functions — substitutions such as
// *   `$&` or `$1` must never be interpreted by `String.replaceAll`.

import type { SiteRule } from "./settings";
import type { Locale } from "./locale";
import { decodeText } from "./encoding";

/** Text shown when no group is selected (the LLM must ask for the site). */
const NO_GROUP: Record<Locale, string> = {
    en: "(none — ask the user for the target site in the chat.)",
    de: "(keine — frag im Chat nach der Zielseite.)",
};

/**
 * Dumps the selected group as JSON. The whole group setting is intentional:
 * the LLM sees existing rules and can propose only the rules to add.
 */
function existingGroup(site: SiteRule | undefined, locale: Locale): string {
    if (site === undefined) return NO_GROUP[locale];
    return "```json\n" + JSON.stringify(site, null, 2) + "\n```";
}

/**
 * Renders the chat template for an optional target site group.
 *
 * @param site   - Optional target group; its full settings are embedded.
 * @param locale - The UI locale (template language follows it).
 * @returns The full template text, ready for the clipboard.
 */
export function renderChatTemplate(site: SiteRule | undefined, locale: Locale): string {
    const template =
        locale === "de" ? decodeText(__CHAT_TEMPLATE_DE_B64__.join("")) : decodeText(__CHAT_TEMPLATE_EN_B64__.join(""));

    return template.replaceAll("{existingGroup}", () => existingGroup(site, locale));
}

/**
 * Renders the repair prompt for an unusable proposal.
 *
 * @param input  - The original LLM answer (fenced Markdown included).
 * @param error  - The parser's reported message.
 * @param locale - The UI locale.
 */
export function renderChatErrorTemplate(input: string, error: string, locale: Locale): string {
    const template =
        locale === "de"
            ? decodeText(__CHAT_ERROR_TEMPLATE_DE_B64__.join(""))
            : decodeText(__CHAT_ERROR_TEMPLATE_EN_B64__.join(""));

    return template.replaceAll("{input}", () => input.trim() || "—").replaceAll("{error}", () => error.trim() || "—");
}
