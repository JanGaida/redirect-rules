// ─────────────────────────────────────────────────────────────────────────────
// MARK: highlight — tokenizer for regex/substitution highlighting
// ─────────────────────────────────────────────────────────────────────────────
// * Pure STRING -> HighlightToken[]; no HTML. Components render tokens as text
//   spans in the mirror layer behind the transparent field text.
// * Never throws: even malformed patterns produce best-effort tokens.
// * Engine truth: a string without /pattern/flags is a LITERAL (parseRegex
//   escapes it), so it is tokenized as plain. The detector is isNotationRegex,
//   so highlight and compile cannot diverge.
// * Substitution grammar follows ECMA-262 GetSubstitution (mirrors
//   expandSubstitution): $$, $&, $`, $', $1…$99, $<name>.

import { isNotationRegex } from "../core/parse-regex";

/** One colored text segment of the mirror layer. */
export interface HighlightToken {
    text: string;
    /** CSS suffix (`rh-<kind>`) — colors defined in dashboard.css. */
    kind: "plain" | "delim" | "flag" | "esc" | "class" | "group" | "quant" | "alt" | "anchor" | "sub";
}

/** Appends text, merging equal neighbors (fewer spans). */
function pushToken(tokens: HighlightToken[], text: string, kind: HighlightToken["kind"]): void {
    if (text === "") return;
    const last = tokens[tokens.length - 1];
    if (last !== undefined && last.kind === kind) {
        last.text += text;
        return;
    }
    tokens.push({ text, kind });
}

/**
 * Tokenizes a regex BODY (without /…/) into esc/class/group/quant/alt/anchor;
 * everything else collapses into a plain run.
 *
 * Best effort on malformed input: unbalanced `[` classes run to the end and a
 * trailing `\\` is a one-character escape — never a throw.
 *
 * @param pattern - The pattern part (no delimiters/flags).
 */
function tokenizeRegexBody(pattern: string): HighlightToken[] {
    const tokens: HighlightToken[] = [];
    let plain = "";
    const flush = (): void => {
        pushToken(tokens, plain, "plain");
        plain = "";
    };

    let i = 0;
    while (i < pattern.length) {
        const ch = pattern[i];

        // * Escape pair — both characters VERBATIM as an esc token (trailing `\\`
        //   is a single backslash; malformed input stays visible).
        if (ch === "\\") {
            const next = pattern[i + 1];
            const text = next === undefined ? ch : pattern.slice(i, i + 2);
            flush();
            pushToken(tokens, text, "esc");
            i += text.length;
            continue;
        }

        // * Character class [ … ] — JS syntax: `]` right after `[`/`[^` is a
        //   LITERAL member, not the terminator (parse-regex parity). An
        //   unbalanced class runs to the end of the string.
        if (ch === "[") {
            let j = i + 1;
            if (pattern[j] === "^") j += 1;
            if (pattern[j] === "]") j += 1;
            while (j < pattern.length && pattern[j] !== "]") {
                if (pattern[j] === "\\") j += 1;
                j += 1;
            }
            const end = j < pattern.length ? j + 1 : pattern.length;
            flush();
            pushToken(tokens, pattern.slice(i, end), "class");
            i = end;
            continue;
        }

        // * Group opener incl. (?= … ?! … ?: … ?<= … (?<name> — the prefix is
        //   visually part of the bracket; a missing `>` consumes the rest.
        if (ch === "(") {
            let len = 1;
            if (pattern[i + 1] === "?") {
                const c2 = pattern[i + 2];
                if (c2 === "=" || c2 === "!" || c2 === ":") {
                    len = 3;
                } else if (c2 === "<") {
                    const c3 = pattern[i + 3];
                    if (c3 === "=" || c3 === "!") {
                        len = 4;
                    } else {
                        const close = pattern.indexOf(">", i + 2);
                        len = close === -1 ? pattern.length - i : close - i + 1;
                    }
                } else {
                    len = 2;
                }
            }
            flush();
            pushToken(tokens, pattern.slice(i, i + len), "group");
            i += len;
            continue;
        }

        if (ch === ")") {
            flush();
            pushToken(tokens, ch, "group");
            i += 1;
            continue;
        }

        // * Quantifier: star/plus/question + well-formed {n}/{n,}/{n,m} braces —
        //   malformed forms ({x}, {}, {,5}) stay plain (engine truth).
        if (ch === "*" || ch === "+") {
            flush();
            pushToken(tokens, ch, "quant");
            i += 1;
            continue;
        }
        if (ch === "?") {
            flush();
            pushToken(tokens, ch, "quant");
            i += 1;
            continue;
        }
        if (ch === "{") {
            let j = i + 1;
            if (/[0-9]/.test(pattern[j] ?? "")) {
                while (j < pattern.length && /[0-9,]/.test(pattern[j])) j += 1;
                if (pattern[j] === "}") {
                    flush();
                    pushToken(tokens, pattern.slice(i, j + 1), "quant");
                    i = j + 1;
                    continue;
                }
            }
            plain += ch;
            i += 1;
            continue;
        }

        if (ch === "|") {
            flush();
            pushToken(tokens, ch, "alt");
            i += 1;
            continue;
        }

        if (ch === "^" || ch === "$") {
            flush();
            pushToken(tokens, ch, "anchor");
            i += 1;
            continue;
        }

        plain += ch;
        i += 1;
    }
    flush();
    return tokens;
}

/**
 * Tokenizes an authored regex with engine semantics: `/pattern/flags` notation
 * → delimiters + flags + tokenized body; without notation → the WHOLE string
 * as plain (engine literal fallback, see module header).
 *
 * @param regexStr - The authored string (e.g. `/example\\.de/i`).
 */
export function tokenizeRegex(regexStr: string): HighlightToken[] {
    if (regexStr === "") return [];
    // * Detector parity: same greedy backtracking detector as compile
    //   (`isNotationRegex`) — the last `/` before a valid flag run closes it.
    if (!isNotationRegex(regexStr)) return [{ text: regexStr, kind: "plain" }];
    const body = regexStr.slice(1, regexStr.lastIndexOf("/"));
    const flags = regexStr.slice(regexStr.lastIndexOf("/") + 1);
    const tokens: HighlightToken[] = [
        { text: "/", kind: "delim" },
        ...tokenizeRegexBody(body),
        { text: "/", kind: "delim" },
    ];
    if (flags !== "") pushToken(tokens, flags, "flag");
    return tokens;
}

/**
 * Tokenizes a String.replace substitution template per ECMA-262
 * GetSubstitution: `$$`, `$&`, `` $` ``, `$'`, `$1`…`$99` (two-digit preferred)
 * and `$<name>` (to `>`; without a terminator → literal `$`).
 *
 * @param template - The substitution template (rule.substitution).
 */
export function tokenizeSubstitution(template: string): HighlightToken[] {
    const tokens: HighlightToken[] = [];
    let plain = "";
    const flush = (): void => {
        pushToken(tokens, plain, "plain");
        plain = "";
    };

    let i = 0;
    while (i < template.length) {
        if (template[i] !== "$") {
            plain += template[i];
            i += 1;
            continue;
        }
        // * `$` at the end → literal (GetSubstitution parity).
        const rest = template.slice(i + 1);
        let text: string | null = null;
        if (rest.startsWith("$")) {
            text = "$$";
        } else if (rest.startsWith("&") || rest.startsWith("`") || rest.startsWith("'")) {
            text = `$${rest[0]}`;
        } else if (rest.startsWith("<")) {
            const close = template.indexOf(">", i + 2);
            if (close !== -1) text = template.slice(i, close + 1);
        } else {
            const digits = rest.match(/^\d{1,2}/);
            if (digits !== null) text = `$${digits[0]}`;
        }
        if (text === null) {
            plain += template[i];
            i += 1;
            continue;
        }
        flush();
        pushToken(tokens, text, "sub");
        i += text.length;
    }
    flush();
    return tokens;
}
