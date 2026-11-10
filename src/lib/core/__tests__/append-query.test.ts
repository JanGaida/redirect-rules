import { describe, expect, it } from "vitest";
import { appendQueryParams, removeQueryParams } from "../append-query";

describe("appendQueryParams — separator handling", () => {
    it("appends with ? when the url has no query", () => {
        expect(appendQueryParams("https://x.test/page", "base=1")).toBe("https://x.test/page?base=1");
    });

    it("appends with & when a query exists", () => {
        expect(appendQueryParams("https://x.test/page?foo=bar", "base=1")).toBe("https://x.test/page?foo=bar&base=1");
    });

    it("appends multiple params in order", () => {
        expect(appendQueryParams("https://x.test/page", "base=1&extra=2&deep=3")).toBe(
            "https://x.test/page?base=1&extra=2&deep=3",
        );
    });

    it("appends to an existing query with multiple params", () => {
        expect(appendQueryParams("https://x.test/page?foo=bar", "base=1&extra=2&deep=3")).toBe(
            "https://x.test/page?foo=bar&base=1&extra=2&deep=3",
        );
    });
});

describe("appendQueryParams — overwrite semantics", () => {
    it("overwrites an existing key's value in place (position kept)", () => {
        expect(appendQueryParams("https://x.test/page?foo=bar&baz=qux", "foo=NEW")).toBe(
            "https://x.test/page?foo=NEW&baz=qux",
        );
    });

    it("later params win over earlier ones", () => {
        expect(appendQueryParams("https://x.test/page?a=1", "a=2&a=3")).toBe("https://x.test/page?a=3");
    });

    it("does not touch a second occurrence of the same key", () => {
        // * Only the FIRST existing occurrence is overwritten (documented semantics).
        expect(appendQueryParams("https://x.test/page?k=1&k=2", "k=9")).toBe("https://x.test/page?k=9&k=2");
    });
});

describe("appendQueryParams — fragment safety", () => {
    it("keeps the fragment after the appended params", () => {
        expect(appendQueryParams("https://x.test/page?foo=bar#section1", "base=1&extra=2")).toBe(
            "https://x.test/page?foo=bar&base=1&extra=2#section1",
        );
    });

    it("inserts ? before a fragment when no query exists", () => {
        expect(appendQueryParams("https://x.test/page#section2", "base=1")).toBe("https://x.test/page?base=1#section2");
    });

    it("leaves the fragment untouched even with ? inside it", () => {
        expect(appendQueryParams("https://x.test/page#frag?x", "a=1")).toBe("https://x.test/page?a=1#frag?x");
    });
});

describe("appendQueryParams — decoded-key matching", () => {
    it("overwrites an encoded-delivered key with a raw-authored key in place", () => {
        // * The fuq.com case: the page delivers `filter%5Bquality%5D`, the params
        //   string is authored raw. Compare-only decoding — the rewrite writes
        //   the AUTHORED pair's form at the existing position.
        expect(appendQueryParams("https://f.test/c?filter%5Bquality%5D=hd&page=2", "filter[quality]=4k")).toBe(
            "https://f.test/c?filter[quality]=4k&page=2",
        );
    });

    it("overwrites the other direction too (percent-encoded authored key)", () => {
        expect(appendQueryParams("https://f.test/c?filter[quality]=hd", "filter%5Bquality%5D=4k")).toBe(
            "https://f.test/c?filter%5Bquality%5D=4k",
        );
    });

    it("still appends when the decoded key is genuinely absent", () => {
        expect(appendQueryParams("https://f.test/c?filter%5Bduration%5D=60", "filter[quality]=hd")).toBe(
            "https://f.test/c?filter%5Bduration%5D=60&filter[quality]=hd",
        );
    });

    it("treats + in keys as a space", () => {
        expect(appendQueryParams("https://x.test/p?my+filter=o", "my filter=new")).toBe(
            "https://x.test/p?my filter=new",
        );
    });

    it("matches unchanged invalid escapes on both sides", () => {
        expect(appendQueryParams("https://x.test/p?%E4=1", "%E4=2")).toBe("https://x.test/p?%E4=2");
    });
});

describe("appendQueryParams — raw encoding preservation", () => {
    it("keeps + in existing values (no re-encoding)", () => {
        expect(appendQueryParams("https://x.test/page?search=Headhunter+Heavy+Belt", "base=1")).toBe(
            "https://x.test/page?search=Headhunter+Heavy+Belt&base=1",
        );
    });

    it("keeps percent-encoding and empty values verbatim", () => {
        expect(appendQueryParams("https://x.test/page?a=%20&b=", "c=3")).toBe("https://x.test/page?a=%20&b=&c=3");
    });

    it("keeps key-only existing segments as authored", () => {
        expect(appendQueryParams("https://x.test/page?flag&foo=bar", "baz=1")).toBe(
            "https://x.test/page?flag&foo=bar&baz=1",
        );
    });
});

describe("appendQueryParams — fragment-unsafe character escaping", () => {
    it("escapes a literal # in an appended value and preserves the url fragment", () => {
        expect(appendQueryParams("https://x.test/page#section1", "q=a#b")).toBe("https://x.test/page?q=a%23b#section1");
    });

    it("escapes a literal # when overwriting an existing pair in place", () => {
        expect(appendQueryParams("https://x.test/page?q=1&keep=2", "q=a#b")).toBe("https://x.test/page?q=a%23b&keep=2");
    });

    it("escapes a literal # in an authored key", () => {
        expect(appendQueryParams("https://x.test/page", "a#b=1")).toBe("https://x.test/page?a%23b=1");
    });

    it("leaves an authored %23 untouched (no double escape)", () => {
        expect(appendQueryParams("https://x.test/page", "q=a%23b")).toBe("https://x.test/page?q=a%23b");
    });

    it("leaves an existing encoded pair verbatim", () => {
        expect(appendQueryParams("https://x.test/page?q=a%23b", "keep=1")).toBe("https://x.test/page?q=a%23b&keep=1");
    });
});

describe("appendQueryParams — malformed input tolerance", () => {
    it("returns the url unchanged for an empty params string", () => {
        expect(appendQueryParams("https://x.test/page", "")).toBe("https://x.test/page");
    });

    it("returns the url unchanged when no segment yields a valid pair", () => {
        expect(appendQueryParams("https://x.test/page", "&&&")).toBe("https://x.test/page");
        expect(appendQueryParams("https://x.test/page", "novaluehere")).toBe("https://x.test/page");
        expect(appendQueryParams("https://x.test/page", "=valueonly")).toBe("https://x.test/page");
    });

    it("skips invalid segments but applies the valid ones", () => {
        expect(appendQueryParams("https://x.test/page", "good=1&bad&=alsobad&fine=2")).toBe(
            "https://x.test/page?good=1&fine=2",
        );
    });

    it("treats a trailing bare ? as an empty query", () => {
        expect(appendQueryParams("https://x.test/page?", "a=1")).toBe("https://x.test/page?a=1");
    });

    it("works on non-URL strings (no new URL() on the path)", () => {
        expect(appendQueryParams("ttp://www.test.com:12345", "a=1")).toBe("ttp://www.test.com:12345?a=1");
        expect(appendQueryParams("user:pass@www.test.com#frag", "a=1")).toBe("user:pass@www.test.com?a=1#frag");
    });

    it("splits at the FIRST ? only", () => {
        expect(appendQueryParams("https://x.test/p?path=a%3Fb", "k=v")).toBe("https://x.test/p?path=a%3Fb&k=v");
    });
});

describe("removeQueryParams — key removal", () => {
    it("removes an exact key and keeps the others", () => {
        expect(removeQueryParams("https://x.test/p?a=1&fbclid=x&b=2", "fbclid")).toBe("https://x.test/p?a=1&b=2");
    });

    it("removes first/last-position keys without dangling separators", () => {
        expect(removeQueryParams("https://x.test/p?fbclid=x&a=1", "fbclid")).toBe("https://x.test/p?a=1");
        expect(removeQueryParams("https://x.test/p?a=1&fbclid=x", "fbclid")).toBe("https://x.test/p?a=1");
    });

    it("removes ALL occurrences, duplicates included", () => {
        expect(removeQueryParams("https://x.test/p?a=1&a=2&b=3", "a")).toBe("https://x.test/p?b=3");
    });

    it("drops the question mark when the query becomes empty", () => {
        expect(removeQueryParams("https://x.test/p?a=1", "a")).toBe("https://x.test/p");
        expect(removeQueryParams("https://x.test/p?a=1#frag", "a")).toBe("https://x.test/p#frag");
    });

    it("supports a trailing-* prefix wildcard and the all-keys *", () => {
        expect(removeQueryParams("https://x.test/p?utm_source=a&utm_medium=b&id=1", "utm_*")).toBe(
            "https://x.test/p?id=1",
        );
        expect(removeQueryParams("https://x.test/p?a=1&b=2#frag", "*")).toBe("https://x.test/p#frag");
    });

    it("matches keys through the decode-normalized surface", () => {
        expect(removeQueryParams("https://x.test/p?filter%5Bquality%5D=hd&a=1", "filter[quality]")).toBe(
            "https://x.test/p?a=1",
        );
    });

    it("never touches the fragment and removes bare key segments", () => {
        expect(removeQueryParams("https://x.test/p?a=1#a=2", "a")).toBe("https://x.test/p#a=2");
        expect(removeQueryParams("https://x.test/p?flag&a=1", "flag")).toBe("https://x.test/p?a=1");
    });

    it("returns the url unchanged when nothing matches or keys are empty", () => {
        expect(removeQueryParams("https://x.test/p?a=1", "b")).toBe("https://x.test/p?a=1");
        expect(removeQueryParams("https://x.test/p", "a")).toBe("https://x.test/p");
        expect(removeQueryParams("https://x.test/p?", "a")).toBe("https://x.test/p?");
        expect(removeQueryParams("https://x.test/p?a=1", "")).toBe("https://x.test/p?a=1");
    });
});
