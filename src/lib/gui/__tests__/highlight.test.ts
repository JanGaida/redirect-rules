// ─────────────────────────────────────────────────────────────────────────────
// MARK: highlight — tokenizer pins for regex/substitution highlighting
// ─────────────────────────────────────────────────────────────────────────────
// * Tokens feed the mirror layer; a wrong split would hide visible text.
// * These tests pin the ROUND-TRIP guarantee: join(tokens) === input.
// * Engine parity: non-notation → all plain; `$` rules = GetSubstitution.

import { describe, expect, it } from "vitest";
import { tokenizeRegex, tokenizeSubstitution } from "../highlight";

/** Round-trip + flatten check in one. */
function expectTokens(input: string, tokenize: (s: string) => ReturnType<typeof tokenizeRegex>): void {
    const tokens = tokenize(input);
    expect(tokens.map((tok) => tok.text).join("")).toBe(input);
    for (const tok of tokens) {
        expect(tok.text).not.toBe("");
    }
}

describe("tokenizeRegex — round-trip", () => {
    // * Every input must round-trip losslessly — the mirror renders exactly
    //   these texts; a missing character is data corruption.
    const SAMPLES = [
        "",
        "example.de",
        "/a/",
        "/a\\/b/",
        "/example\\.(de|fr)(\\/.*|\\?.*)?/",
        "/(?<year>\\d{4})-(?<month>\\d{2})/",
        "/[abc]+|^foo$/gi",
        "/[abc/",
        "/[^]]/",
        "/a{2,3}/",
        "/a{x}/",
        "/a{,5}/",
        "/\\s/",
        "/(unclosed/",
        "/",
        "//",
    ];

    it.each(SAMPLES)("round-trips %j", (sample) => {
        expectTokens(sample, tokenizeRegex);
    });
});

describe("tokenizeRegex — kinds", () => {
    it("treats a non-notation string as ONE plain token (literal fallback)", () => {
        expect(tokenizeRegex("example.de")).toEqual([{ text: "example.de", kind: "plain" }]);
    });

    it("splits /pattern/flags into delims + body tokens + flag token", () => {
        const tokens = tokenizeRegex("/ab+/gi");
        expect(tokens).toEqual([
            { text: "/", kind: "delim" },
            { text: "ab", kind: "plain" },
            { text: "+", kind: "quant" },
            { text: "/", kind: "delim" },
            { text: "gi", kind: "flag" },
        ]);
    });

    it("keeps an escape pair together (backslash + next char)", () => {
        const tokens = tokenizeRegex("/a\\.b/");
        expect(tokens.map((tok) => [tok.text, tok.kind])).toEqual([
            ["/", "delim"],
            ["a", "plain"],
            ["\\.", "esc"],
            ["b", "plain"],
            ["/", "delim"],
        ]);
    });

    it("colors group prefixes with their bracket — (?<name> inclusive", () => {
        const tokens = tokenizeRegex("/(?<year>\\d{4})/");
        expect(tokens.map((tok) => [tok.text, tok.kind])).toEqual([
            ["/", "delim"],
            ["(?<year>", "group"],
            ["\\d", "esc"],
            ["{4}", "quant"],
            [")", "group"],
            ["/", "delim"],
        ]);
    });

    it("scans lookahead and non-capture prefixes as group tokens", () => {
        for (const prefix of ["(?:", "(?=", "(?!", "(?<=", "(?<!"]) {
            const tokens = tokenizeRegex(`/${prefix}x)/`);
            expect(tokens[1].kind).toBe("group");
            expect(tokens[1].text).toBe(prefix);
            expectTokens(`/${prefix}x)/`, tokenizeRegex);
        }
    });

    it("scans one character class as a single token (incl. literal ] member)", () => {
        expect(tokenizeRegex("/[abc]+/")).toEqual([
            { text: "/", kind: "delim" },
            { text: "[abc]", kind: "class" },
            { text: "+", kind: "quant" },
            { text: "/", kind: "delim" },
        ]);
        expect(tokenizeRegex("/[^]]/")[1]).toEqual({ text: "[^]]", kind: "class" });
    });

    it("runs an UNBALANCED class to the end of the body", () => {
        const tokens = tokenizeRegex("/[ab/");
        expect(tokens[1]).toEqual({ text: "[ab", kind: "class" });
    });

    it("colors anchors and alternation, merges plain runs", () => {
        const tokens = tokenizeRegex("/^foo|bar$/");
        expect(tokens.map((tok) => [tok.text, tok.kind])).toEqual([
            ["/", "delim"],
            ["^", "anchor"],
            ["foo", "plain"],
            ["|", "alt"],
            ["bar", "plain"],
            ["$", "anchor"],
            ["/", "delim"],
        ]);
    });

    it("keeps malformed quantifier braces plain, colors well-formed ones", () => {
        expect(tokenizeRegex("/a{2,3}/").map((tok) => [tok.text, tok.kind])).toEqual([
            ["/", "delim"],
            ["a", "plain"],
            ["{2,3}", "quant"],
            ["/", "delim"],
        ]);
        expect(tokenizeRegex("/a{x}/").map((tok) => [tok.text, tok.kind])).toEqual([
            ["/", "delim"],
            ["a{x}", "plain"],
            ["/", "delim"],
        ]);
        expect(tokenizeRegex("/a{,5}/")) // {,5} is NO quantifier (no leading digit)
            .toEqual([
                { text: "/", kind: "delim" },
                { text: "a{,5}", kind: "plain" },
                { text: "/", kind: "delim" },
            ]);
    });

    it("merges adjacent same-kind tokens (fewer spans in the mirror)", () => {
        expect(tokenizeRegex("/\\d\\d/")[1]).toEqual({ text: "\\d\\d", kind: "esc" });
    });

    it("returns no tokens for the empty string", () => {
        expect(tokenizeRegex("")).toEqual([]);
    });
});

describe("tokenizeSubstitution — round-trip", () => {
    const SAMPLES = [
        "",
        "https://example.de/neu/$1",
        "$$ $& $` $'",
        "$1$10$99",
        "$<name>",
        "$<unterminated",
        "price: 5$$",
        "$",
        "$42",
        "$x",
    ];

    it.each(SAMPLES)("round-trips %j", (sample) => {
        expectTokens(sample, tokenizeSubstitution);
    });
});

describe("tokenizeSubstitution — kinds", () => {
    it("colors capture refs including two-digit preference", () => {
        expect(tokenizeSubstitution("$1/$12").map((tok) => [tok.text, tok.kind])).toEqual([
            ["$1", "sub"],
            ["/", "plain"],
            ["$12", "sub"],
        ]);
    });

    it("colors the expansion tokens $$ $& $` $' (spaces stay plain)", () => {
        const tokens = tokenizeSubstitution("$$ $& $` $'");
        // * Structure: each expansion is its own sub token; plain spaces
        //   between them — no merge across kind boundaries.
        expect(tokens.filter((tok) => tok.kind === "sub").map((tok) => tok.text)).toEqual(["$$", "$&", "$`", "$'"]);
        expect(tokens.filter((tok) => tok.kind === "plain").map((tok) => tok.text)).toEqual([" ", " ", " "]);
    });

    it("colors named refs with the terminator, keeps the unterminated dollar plain", () => {
        expect(tokenizeSubstitution("$<name>!")[0]).toEqual({ text: "$<name>", kind: "sub" });
        expect(tokenizeSubstitution("$<unterminated")).toEqual([{ text: "$<unterminated", kind: "plain" }]);
    });

    it("keeps a lone dollar and invalid combos plain", () => {
        expect(tokenizeSubstitution("5$ x")).toEqual([{ text: "5$ x", kind: "plain" }]);
        expect(tokenizeSubstitution("$x, $")).toEqual([{ text: "$x, $", kind: "plain" }]);
    });

    it("merges adjacent same-kind tokens", () => {
        expect(tokenizeSubstitution("$1$2")[0]).toEqual({ text: "$1$2", kind: "sub" });
    });
});
