// ─────────────────────────────────────────────────────────────────────────────
// MARK: GUI locale detection
// ─────────────────────────────────────────────────────────────────────────────
// * The GUI ships exactly two locales (de/en) — the legacy script's AI-generated
//   fr-FR/it-IT/zh-CN dictionaries were dropped. Everything
//   the browser reports outside "de" falls back to English.

/** Display locales actually shipped (de/en). */
export type Locale = "de" | "en";

/** Persisted language setting — `auto` resolves against the browser at runtime. */
export type LocaleSetting = "auto" | Locale;

/** Locale union values (for dropdowns / type guards). */
export const LOCALE_SETTINGS: readonly LocaleSetting[] = ["auto", "de", "en"];

/** Type guard for a resolved display locale. */
export function isLocale(value: unknown): value is Locale {
    return value === "de" || value === "en";
}

/** Type guard for a persisted language setting (incl. `auto`). */
export function isLocaleSetting(value: unknown): value is LocaleSetting {
    return value === "auto" || value === "de" || value === "en";
}

/**
 * Detects the GUI locale from the browser language preferences.
 *
 * Maps only German-language variants (tags whose primary language subtag is
 * `de`, e.g. `de`, `de-CH`, `de-AT`, `de-DE`) to `"de"`; everything else
 * (including `en-CH`, `fr-CH`) falls back to `"en"`.
 *
 * @returns `"de"` or `"en"`.
 */
export function detectLocale(): Locale {
    try {
        const languages: readonly string[] =
            (navigator as Navigator & { languages?: readonly string[] }).languages ?? [];
        const primary = languages.length > 0 ? languages[0] : navigator.language;
        if (primary && String(primary).toLowerCase().startsWith("de")) {
            return "de";
        }
    } catch (_) {
        // * No navigator (rare sandbox contexts) — English fallback.
    }
    return "en";
}
