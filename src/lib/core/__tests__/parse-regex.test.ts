import { describe, expect, it } from "vitest";
import {
    escapeUriForRegex,
    isNotationRegex,
    isValidRegex,
    normalizeWhitespaceVariants,
    parseRegex,
    regexToReadableLiteral,
    stripGlobalFlag,
    stripStickyFlag,
} from "../parse-regex";

describe("parseRegex", () => {
    it("parses /pattern/flags notation with flags", () => {
        const re = parseRegex("/example\\.com/i");
        expect(re.source).toBe("example\\.com");
        expect(re.flags).toBe("i");
        expect(re.test("http://EXAMPLE.COM")).toBe(true);
    });

    it("parses /pattern/ notation without flags", () => {
        const re = parseRegex("/sub\\.example\\.org/");
        expect(re.source).toBe("sub\\.example\\.org");
        expect(re.flags).toBe("");
    });

    it("keeps the g flag for replace semantics", () => {
        const re = parseRegex("/:8080/g");
        expect(re.global).toBe(true);
        expect("a:8080b:8080c".replace(re, ":9090")).toBe("a:9090b:9090c");
    });

    it("falls back to literal escaping for plain strings", () => {
        const re = parseRegex("example.de");
        // * Literal: the dot must be escaped, so only a real "example.de" matches.
        expect(re.source).toBe("example\\.de");
        expect(re.test("example.de")).toBe(true);
        expect(re.test("exampleXde")).toBe(false);
    });

    it("escapes regex metacharacters in the literal fallback", () => {
        const re = parseRegex("a+b*(c)?[d].^$");
        expect(re.test("a+b*(c)?[d].^$")).toBe(true);
        expect(re.test("aabb")).toBe(false);
    });

    it("treats a lone slash as a literal, not notation", () => {
        // * "/foo" has no closing "/flags" part — must not throw, must be literal.
        const re = parseRegex("/foo");
        expect(re.test("/foo")).toBe(true);
    });

    it("greedy pattern takes 'a/b/c' — the LAST '/' closes the notation", () => {
        // * Verified against NOTATION_RE: the tail run after the closing "/"
        //   would have to be flags — "c" cannot be flags, so greedy backtrack
        //   yields pattern "a/b/c" with EMPTY flags. Still a valid regex that
        //   matches the string itself (pinned — easy to misread as "literal").
        expect(isNotationRegex("/a/b/c/")).toBe(true);
        // * RegExp.source re-escapes "/" as "\/" — engine display form.
        expect(parseRegex("/a/b/c/").source).toBe("a\\/b\\/c");
        expect(parseRegex("/a/b/c/").test("/a/b/c/")).toBe(true);
    });
});

describe("isValidRegex", () => {
    it("accepts valid notation and literals", () => {
        expect(isValidRegex("/example\\.(de|fr)/i")).toBe(true);
        expect(isValidRegex("example.de")).toBe(true);
    });

    it("rejects empty strings", () => {
        expect(isValidRegex("")).toBe(false);
    });

    it("rejects invalid patterns without throwing", () => {
        expect(isValidRegex("/([unclosed/i")).toBe(false);
        expect(isValidRegex("/(?!/")).toBe(false);
        expect(isValidRegex("/)/")).toBe(false);
    });
});

describe("stripGlobalFlag", () => {
    it("removes only the g flag", () => {
        const re = stripGlobalFlag(parseRegex("/example\\.com/gi"));
        expect(re.global).toBe(false);
        expect(re.ignoreCase).toBe(true);
    });

    it("returns non-global regexes unchanged (identity)", () => {
        const re = parseRegex("/x/i");
        expect(stripGlobalFlag(re)).toBe(re);
    });

    it("makes .test() stateless across calls", () => {
        const stripped = stripGlobalFlag(parseRegex("/a/g"));
        expect(stripped.test("aa")).toBe(true);
        expect(stripped.test("aa")).toBe(true); // * a global regex would fail the second call
    });

    it("removes the sticky flag too", () => {
        const stripped = stripGlobalFlag(parseRegex("/a/y"));
        expect(stripped.sticky).toBe(false);
        expect(stripped.test("aa")).toBe(true);
        expect(stripped.test("aa")).toBe(true);
    });
});

describe("stripStickyFlag", () => {
    it("removes only the sticky flag and keeps g", () => {
        const re = stripStickyFlag(parseRegex("/a/gy"));
        expect(re.sticky).toBe(false);
        expect(re.global).toBe(true);
        expect("a-a".replace(re, "b")).toBe("b-b");
    });

    it("returns non-sticky regexes unchanged (identity)", () => {
        const re = parseRegex("/a/g");
        expect(stripStickyFlag(re)).toBe(re);
    });

    it("keeps other flags intact", () => {
        const re = stripStickyFlag(parseRegex("/a/iy"));
        expect(re.flags).toBe("i");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Whitespace-variant normalization
// ─────────────────────────────────────────────────────────────────────────────
// * location.href ALWAYS carries "%20" — authored " " or "\s" never matched
//   before. Both authoring variants now compile to (?:%20|\s).

describe("normalizeWhitespaceVariants", () => {
    it("rewrites an authored literal space into the both-variants class", () => {
        expect(normalizeWhitespaceVariants("my file")).toBe("my(?:%20|\\s)file");
    });

    it("rewrites authored \\s outside a class", () => {
        expect(normalizeWhitespaceVariants("my\\sfile")).toBe("my(?:%20|\\s)file");
    });

    it("keeps \\s inside a character class verbatim (class limitation)", () => {
        expect(normalizeWhitespaceVariants("[a\\s]b")).toBe("[a\\s]b");
        expect(normalizeWhitespaceVariants("my[ x]y")).toBe("my[ x]y");
    });

    it("keeps an escaped space verbatim (authored escape)", () => {
        expect(normalizeWhitespaceVariants("my\\ file")).toBe("my\\ file");
    });

    it("keeps a literal backslash + s verbatim (not a \\s token)", () => {
        expect(normalizeWhitespaceVariants("my\\\\sfile")).toBe("my\\\\sfile");
    });

    it("treats a literal ']' right after '[' or '[^' as a class member", () => {
        expect(normalizeWhitespaceVariants("[]a b]")).toBe("[]a b]");
        expect(normalizeWhitespaceVariants("[^]a b]")).toBe("[^]a b]");
    });

    it("leaves patterns without whitespace untouched", () => {
        expect(normalizeWhitespaceVariants("example\\.com")).toBe("example\\.com");
    });
});

describe("parseRegex — whitespace variants", () => {
    it("matches a %20 URL with an authored literal space (notation + literal form)", () => {
        expect(parseRegex("/my file/").test("my%20file")).toBe(true);
        expect(parseRegex("my file").test("my%20file")).toBe(true);
    });

    it("matches a %20 URL with an authored \\s", () => {
        expect(parseRegex("/my\\sfile/").test("my%20file")).toBe(true);
        expect(parseRegex("/my\\s+file/").test("my%20%20file")).toBe(true);
    });

    it("still matches the raw-space form too", () => {
        expect(parseRegex("/my\\sfile/").test("my file")).toBe(true);
        expect(parseRegex("/my file/").test("my file")).toBe(true);
    });

    it("matches an authored %20 pattern against %20 URLs", () => {
        expect(parseRegex("/my%20file/").test("my%20file")).toBe(true);
    });

    it("does not shift capture-group indices ($n reuse stays stable)", () => {
        const re = parseRegex("/(my)\\sfile/");
        const groups = re.exec("my%20file");
        expect(groups?.[1]).toBe("my");
        expect(re.source).toBe("(my)(?:%20|\\s)file");
    });

    it("keeps \\s inside a class powerless against %20 (documented limitation)", () => {
        const re = parseRegex("/[a\\s]b/");
        expect(re.test(" b")).toBe(true); // * raw whitespace still matches
        expect(re.test("%b")).toBe(false); // * %20 (two chars) cannot enter a class
        expect(re.source).toBe("[a\\s]b");
    });

    it("keeps an escaped space matching only the raw form", () => {
        expect(parseRegex("/my\\ file/").test("my file")).toBe(true);
        expect(parseRegex("/my\\ file/").test("my%20file")).toBe(false);
    });

    it("keeps an authored \\s literal in the literal fallback (escaped first)", () => {
        const re = parseRegex("my\\sfile");
        expect(re.source).toBe("my\\\\sfile");
        expect(re.test("my\\sfile")).toBe(true);
        expect(re.test("my file")).toBe(false);
        expect(re.test("my%20file")).toBe(false);
    });

    it("applies to gates via stripGlobalFlag (site gates, appendQuery gates)", () => {
        const gate = stripGlobalFlag(parseRegex("/example\\.com\\s/i"));
        expect(gate.test("example.com%20")).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Authoring helpers — escape toggle + readable gate captions
// ─────────────────────────────────────────────────────────────────────────────
// * UX contract: paste a raw URI into the site gate → escape toggle wraps it
//   into /…/ notation (metacharacters escaped); readable captions strip the
//   notation again. Engine contract: an escaped string MUST carry the /…/
//   slashes, or the literal fallback would double-escape the backslashes.

describe("escapeUriForRegex", () => {
    it("wraps a raw URI into /…/ notation with all metacharacters escaped", () => {
        expect(escapeUriForRegex("https://example.com/path?a=1+2")).toBe(
            "/https:\\/\\/example\\.com\\/path\\?a=1\\+2/",
        );
    });

    it("produces a valid regex that matches exactly the raw input", () => {
        const raw = "https://example.com/sub/page?v=1#frag";
        const escaped = escapeUriForRegex(raw);
        expect(isValidRegex(escaped)).toBe(true);
        expect(parseRegex(escaped).test(raw)).toBe(true);
        expect(parseRegex(escaped).test("https://exampleXcom/sub/page?v=1#frag")).toBe(false);
    });

    it("keeps the escaped form in notation, never in the literal fallback", () => {
        // * Without /…/ slashes the literal fallback would double-escape "\."
        // * into "\\." — the match would silently target the WRONG text.
        const escaped = escapeUriForRegex("example.de");
        expect(isNotationRegex(escaped)).toBe(true);
        expect(parseRegex(escaped).source).toBe("example\\.de");
    });
});

describe("regexToReadableLiteral", () => {
    it("strips notation + flags and resolves backslash escapes", () => {
        expect(regexToReadableLiteral("/https:\\/\\/example\\.de\\/path/i")).toBe("https://example.de/path");
    });

    it("round-trips a raw URI through escape → readable", () => {
        const raw = "https://example.com/path?a=1+2";
        expect(regexToReadableLiteral(escapeUriForRegex(raw))).toBe(raw);
    });

    it("passes plain literals through unchanged", () => {
        expect(regexToReadableLiteral("example.de")).toBe("example.de");
    });

    it("is lossy for real regex constructs (toggle decision, documented)", () => {
        // * "\\d" resolves to "d", flags are dropped — captions/toggle only.
        expect(regexToReadableLiteral("/\\d+/")).toBe("d+");
        expect(regexToReadableLiteral("/a{2,}/")).toBe("a{2,}");
    });
});

describe("isNotationRegex", () => {
    it("mirrors the parseRegex notation detector", () => {
        expect(isNotationRegex("/example\\.de/i")).toBe(true);
        expect(isNotationRegex("/sub\\.example\\.org/")).toBe(true);
        expect(isNotationRegex("example.de")).toBe(false);
        // * Greedy backtrack: the LAST '/' closes the notation (empty flags).
        expect(isNotationRegex("/a/b/c/")).toBe(true);
    });
});
