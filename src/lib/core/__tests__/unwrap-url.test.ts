import { describe, expect, it } from "vitest";
import { unwrapTarget } from "../unwrap-url";

describe("unwrapTarget — capture semantics", () => {
    it("decodes capture group 1 of a DuckDuckGo wrapper", () => {
        const url = "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage%3Fa%3D1&rut=abc";
        expect(unwrapTarget(url, /[?&]uddg=([^&]+)/)).toEqual({
            matched: true,
            target: "https://example.com/page?a=1",
        });
    });

    it("decodes the whole match when the regex has no capture group", () => {
        expect(unwrapTarget("https://x.test/?u=https%3A%2F%2Fexample.com%2F", /https%3A%2F%2F[^&]+/)).toEqual({
            matched: true,
            target: "https://example.com/",
        });
    });

    it("keeps a fragment that was part of the encoded target", () => {
        expect(unwrapTarget("https://x.test/?u=https%3A%2F%2Fexample.com%2Fa%23top", /u=([^&]+)/)).toEqual({
            matched: true,
            target: "https://example.com/a#top",
        });
    });

    it("decodes UTF-8 escapes and leaves a literal plus alone", () => {
        expect(unwrapTarget("https://x.test/?u=https%3A%2F%2Fexample.com%2F%3Fq%3D%C3%A4%2Bb", /u=([^&]+)/)).toEqual({
            matched: true,
            target: "https://example.com/?q=ä+b",
        });
    });

    it("accepts uppercase schemes and plain http", () => {
        expect(unwrapTarget("https://x.test/?u=HTTP%3A%2F%2FEXAMPLE.COM%2F", /u=([^&]+)/)).toMatchObject({
            matched: true,
            target: "HTTP://EXAMPLE.COM/",
        });
    });
});

describe("unwrapTarget — rejection paths", () => {
    it("reports no-match without decoding", () => {
        expect(unwrapTarget("https://x.test/page", /u=([^&]+)/)).toEqual({ matched: false, target: null });
    });

    it("rejects a javascript target", () => {
        expect(unwrapTarget("https://x.test/?u=javascript%3Aalert%281%29", /u=([^&]+)/)).toEqual({
            matched: true,
            target: null,
            reason: "invalid-target",
        });
    });

    it("rejects data and file targets", () => {
        expect(unwrapTarget("https://x.test/?u=data%3Atext%2Fplain%2Cx", /u=([^&]+)/).reason).toBe("invalid-target");
        expect(unwrapTarget("https://x.test/?u=file%3A%2F%2F%2Fetc%2Fpasswd", /u=([^&]+)/).reason).toBe(
            "invalid-target",
        );
    });

    it("rejects an empty capture and a non-participating optional group", () => {
        expect(unwrapTarget("https://x.test/?u=", /u=([^&]*)/).reason).toBe("invalid-target");
        expect(unwrapTarget("https://x.test/?u", /u(?:=([^&]+))?/).reason).toBe("invalid-target");
    });

    it("rejects a malformed percent escape", () => {
        expect(unwrapTarget("https://x.test/?u=https%3A%2F%2Fexample.com%2F%zz", /u=([^&]+)/).reason).toBe(
            "invalid-target",
        );
    });
});

describe("unwrapTarget — stateless matcher", () => {
    it("does not leak lastIndex across calls for a global regex", () => {
        const matcher = /u=([^&]+)/g;
        const url = "https://x.test/?u=https%3A%2F%2Fexample.com%2F";
        expect(unwrapTarget(url, matcher).target).toBe("https://example.com/");
        expect(unwrapTarget(url, matcher).target).toBe("https://example.com/");
    });
});
