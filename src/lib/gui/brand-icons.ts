/**
 * Brand marks (Simple Icons) — checked-in SVG strings
 * (assets/icons/brands/, see its README for source/license/naming).
 *
 * * `?raw` imports → inlined into the userscript bundle, no runtime fetch.
 * * No `fill` attribute in the files; consumers paint via `currentColor`.
 * * Monochrome on purpose: a brand palette would fight the dashboard theme.
 * * `aria-hidden` lives on the wrapper; the link text carries the name.
 */
import openai from "../../../assets/icons/brands/openai.svg?raw";
import claude from "../../../assets/icons/brands/claude.svg?raw";
import githubcopilot from "../../../assets/icons/brands/githubcopilot.svg?raw";
import googlegemini from "../../../assets/icons/brands/googlegemini.svg?raw";
import mistralai from "../../../assets/icons/brands/mistralai.svg?raw";
import kimi from "../../../assets/icons/brands/kimi.svg?raw";
import deepseek from "../../../assets/icons/brands/deepseek.svg?raw";
import qwen from "../../../assets/icons/brands/qwen.svg?raw";
import perplexity from "../../../assets/icons/brands/perplexity.svg?raw";

/** Closed enum of the checked-in brand glyphs — keeps call sites spell-checked. */
export type BrandIconName =
    "openai" | "claude" | "githubcopilot" | "googlegemini" | "mistralai" | "kimi" | "deepseek" | "qwen" | "perplexity";

export const brandIcons: Record<BrandIconName, string> = {
    openai,
    claude,
    githubcopilot,
    googlegemini,
    mistralai,
    kimi,
    deepseek,
    qwen,
    perplexity,
};
