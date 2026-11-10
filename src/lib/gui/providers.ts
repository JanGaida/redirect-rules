/**
 * Static copy-paste targets for the Assistant tab.
 *
 * * Plain external links only: no provider API, no URL prefill, no buttons.
 * * Icon names must exist in `brand-icons.ts` (checked by the union type).
 * * Grok is intentionally absent — no dedicated Simple Icons slug, and the X
 *   mark would misrepresent the service.
 */
import type { BrandIconName } from "./brand-icons";

export interface ProviderLink {
    /** Visible link text (not translated — product names are proper nouns). */
    name: string;
    href: string;
    icon: BrandIconName;
}

export const PROVIDERS: readonly ProviderLink[] = [
    { name: "ChatGPT", href: "https://chatgpt.com/", icon: "openai" },
    { name: "Claude", href: "https://claude.ai/", icon: "claude" },
    { name: "Copilot", href: "https://copilot.microsoft.com/", icon: "githubcopilot" },
    { name: "Gemini", href: "https://gemini.google.com/", icon: "googlegemini" },
    { name: "Mistral", href: "https://chat.mistral.ai/", icon: "mistralai" },
    { name: "Kimi", href: "https://www.kimi.com/", icon: "kimi" },
    { name: "DeepSeek", href: "https://chat.deepseek.com/", icon: "deepseek" },
    { name: "Qwen", href: "https://chat.qwen.ai/", icon: "qwen" },
    { name: "Perplexity", href: "https://www.perplexity.ai/", icon: "perplexity" },
];
