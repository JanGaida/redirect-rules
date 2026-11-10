// ─────────────────────────────────────────────────────────────────────────────
// MARK: Regex parsing — /pattern/flags notation with literal fallback
// ─────────────────────────────────────────────────────────────────────────────
// * Authored regex: /pattern/flags notation, or a plain string treated as LITERAL.
// * `stripGlobalFlag` removes stateful g/y so gate `.test()` calls are stateless.
// * Whitespace: " " and `\s` compile to `(?:%20|\s)`; the URL is never decoded.
//   Applies to notation patterns AND literal spaces in the fallback — an
//   authored `\s` in the fallback is escaped first, so it stays literal.
// * ! Inside character classes no rewrite happens — author `%20` explicitly.
// * Escaped spaces (`\ `) and authored `%20` stay untouched.

import { createLogger } from "./log";

const log = createLogger("regex");

/** Accepted JS regex flags (order-insensitive) in /pattern/flags notation. */
const FLAGS_PATTERN = "[dgimsuvy]*";

/** Matches the official /pattern/flags notation. Pattern is greedy (may contain escaped slashes). */
const NOTATION_RE = new RegExp(`^\\/(.+)\\/(${FLAGS_PATTERN})$`);

/** Both-variants whitespace class — matches an encoded `%20` and any raw `\s` whitespace. */
const WS_VARIANTS_CLASS = "(?:%20|\\s)";

/**
 * Escapes all regex metacharacters — the literal-fallback form (no regex power).
 *
 * @param text - The authored plain string.
 */
function escapeLiteral(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrites authored whitespace (literal " " and `\s`) so BOTH uri variants match.
 *
 * Scope: applies to BOTH notation patterns and literal-fallback strings (site
 * gates, replace rules, appendQuery gates) because everything funnels through
 * `parseRegex`. The literal fallback escapes first, so an authored `\s` there
 * stays literal while literal SPACES are still normalized. Only UNESCAPED
 * whitespace OUTSIDE character classes is rewritten — inside classes and
 * escaped (`\ `, `\\s`) stays verbatim. The rewrite uses a NON-CAPTURING group,
 * so `$1`…`$n` indices in substitutions never shift.
 *
 * @param pattern - The escaped/authored regex pattern (NOT the flags).
 * @returns The pattern with whitespace variants normalized.
 */
export function normalizeWhitespaceVariants(pattern: string): string {
    let out = "";
    let inClass = false;
    let i = 0;

    while (i < pattern.length) {
        const ch = pattern[i];

        // * Escape pair — consumed verbatim; "\ " (authored escape) stays as-is.
        if (ch === "\\") {
            const next = pattern[i + 1];
            if (next === undefined) {
                out += ch;
                i += 1;
                continue;
            }
            // * "\s" OUTSIDE a class becomes the both-variants class; inside a
            //   class it is impossible (multi-char) — left verbatim.
            if (next === "s" && !inClass) {
                out += WS_VARIANTS_CLASS;
                i += 2;
                continue;
            }
            out += pattern.slice(i, i + 2);
            i += 2;
            continue;
        }

        if (!inClass) {
            if (ch === "[") {
                inClass = true;
                out += ch;
                i += 1;
                // * JS class syntax: a "]" right after "[" (or "[^") is a literal
                //   "]" member, not the class terminator.
                if (pattern[i] === "^") {
                    out += "^";
                    i += 1;
                }
                if (pattern[i] === "]") {
                    out += "]";
                    i += 1;
                }
                continue;
            }
            if (ch === " ") {
                out += WS_VARIANTS_CLASS;
                i += 1;
                continue;
            }
        } else if (ch === "]") {
            inClass = false;
        }

        out += ch;
        i += 1;
    }

    return out;
}

// ─── Authoring helpers — escape toggle + readable captions ─────────────────────

/**
 * Whether a string is authored in official `/pattern/flags` notation — the
 * SAME detector {@link parseRegex} uses, so "escaped" can never diverge from
 * "compiled". Greedy backtrack: the LAST `/` closes the notation whenever the
 * tail run is no valid flag set (e.g. `"/a/b/c/"` → pattern `a/b/c`, no flags).
 *
 * @param regexStr - The authored string.
 */
export function isNotationRegex(regexStr: string): boolean {
    return NOTATION_RE.test(regexStr);
}

/**
 * Escapes a raw pasted URI/text into official `/pattern/` notation.
 *
 * * ALL metacharacters (incl. `/`) are backslash-escaped, so the result is a
 *   REGEX that matches the raw input exactly — yet stays editable as a real
 *   regex (the user can loosen parts afterwards, e.g. `\.` → `.*`).
 * * MUST wrap into `/…/` notation: an escaped string WITHOUT slashes would
 *   fall into the literal fallback, which would DOUBLE-escape the
 *   backslashes (`escapeLiteral` also escapes `\`) — engine contract.
 *
 * @param raw - The raw text as one knows it (e.g. a pasted URI).
 */
export function escapeUriForRegex(raw: string): string {
    return `/${raw.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/`;
}

/**
 * Resolves an authored regex string into its readable raw form — the display
 * "name" of a gate (explorer summary + dock title): strips `/…/flags` notation
 * and resolves every backslash escape (`\.` → `.`, `\/` → `/`).
 *
 * ! LOSSY for hand-authored regex CONSTRUCTS (user decision — toggle
 * !   convenience beats fidelity): `"\d"` → `"d"`, flags are dropped. Meant for
 * !   escape-toggle round-trips and captions, NOT for engine use.
 *
 * @param regexStr - The authored string (notation OR plain literal).
 */
export function regexToReadableLiteral(regexStr: string): string {
    const match = regexStr.match(NOTATION_RE);
    return (match ? match[1] : regexStr).replace(/\\(.)/g, "$1");
}

/**
 * Parses a regex string in official `/pattern/flags` notation.
 *
 * Falls back to treating the string as a LITERAL (all regex metacharacters escaped)
 * when the notation doesn't match — mirrors the legacy behavior. Whitespace
 * normalization applies to BOTH forms; the fallback escapes first, so an
 * authored `\s` stays literal while literal spaces still normalize.
 *
 * @param regexStr - e.g. `"/example\\.com/i"` or `"example.de"`.
 * @throws When the extracted pattern is an invalid RegExp (callers use {@link isValidRegex}
 *   or try/catch — the engine compiles fail-soft, never lets a bad rule kill the boot).
 */
export function parseRegex(regexStr: string): RegExp {
    const match = regexStr.match(NOTATION_RE);
    if (match) {
        return new RegExp(normalizeWhitespaceVariants(match[1]), match[2]);
    }
    return new RegExp(normalizeWhitespaceVariants(escapeLiteral(regexStr)));
}

/**
 * Whether a regex string parses into a valid RegExp (notation OR literal).
 *
 * * GUI live validation uses this; the engine compiles fail-soft and skips
 *   unusable rules separately (empty gates/rules are rejected at compile).
 *
 * @param regexStr - The authored regex string. Empty strings are INVALID.
 */
export function isValidRegex(regexStr: string): boolean {
    if (!regexStr) return false;
    try {
        parseRegex(regexStr);
        return true;
    } catch (e) {
        log.debug("invalid regex rejected", { regexStr, error: String(e) });
        return false;
    }
}

/**
 * Returns a copy of the regex WITHOUT the stateful `g`/`y` flags.
 *
 * * Global and sticky regexes advance `lastIndex` on every `.test()` call,
 *   silently skipping matches depending on how often they ran before. Gate
 *   regexes (site gates, appendQuery gates) must therefore never carry them.
 *
 * @param re - The compiled regex (with any flags).
 */
export function stripGlobalFlag(re: RegExp): RegExp {
    if (!re.global && !re.sticky) return re;
    return new RegExp(re.source, re.flags.replace(/[gy]/g, ""));
}

/**
 * Returns a copy of the regex WITHOUT the sticky `y` flag — `g` is kept.
 *
 * * A sticky (even non-global) replace regex advances `lastIndex` across
 *   `String.replace` calls, leaking state between engine runs. Replace rules
 *   strip `y` at compile; `g` keeps its replace-all meaning.
 *
 * @param re - The compiled regex (with any flags).
 */
export function stripStickyFlag(re: RegExp): RegExp {
    if (!re.sticky) return re;
    return new RegExp(re.source, re.flags.replace(/y/g, ""));
}
