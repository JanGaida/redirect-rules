import { describe, expect, it } from "vitest";
import { paramKeySurface, querySurface } from "../decode-surface";

describe("paramKeySurface — escape decoding", () => {
    it("decodes percent-encoded keys", () => {
        expect(paramKeySurface("filter%5Bquality%5D")).toBe("filter[quality]");
    });

    it("leaves already-raw keys verbatim", () => {
        expect(paramKeySurface("filter[quality]")).toBe("filter[quality]");
    });

    it("reads + as a literal space", () => {
        expect(paramKeySurface("my+filter")).toBe("my filter");
    });

    it("keeps an invalid escape raw instead of throwing", () => {
        expect(paramKeySurface("%FF")).toBe("%FF");
    });

    it("keeps an encoded plus distinct from a raw plus", () => {
        expect(paramKeySurface("a%2Bb")).toBe("a+b");
        expect(paramKeySurface("a+b")).toBe("a b");
        expect(paramKeySurface("a%2Bb")).not.toBe(paramKeySurface("a+b"));
    });

    it("decodes multibyte UTF-8 runs", () => {
        expect(paramKeySurface("%C3%A4")).toBe("ä");
        expect(paramKeySurface("%F0%9F%98%80")).toBe("😀");
    });

    it("decodes valid multibyte prefixes and leaves only invalid escapes raw", () => {
        expect(paramKeySurface("%C3%A4%FF")).toBe("ä%FF");
    });
});

describe("querySurface — query-scoped decoding", () => {
    it("decodes the query between ? and #", () => {
        expect(querySurface("https://f.test/c?filter%5Bquality%5D=hd&x=a%20b#frag")).toBe(
            "https://f.test/c?filter[quality]=hd&x=a b#frag",
        );
    });

    it("decodes + as space in the query", () => {
        expect(querySurface("https://f.test/c?q=a+b")).toBe("https://f.test/c?q=a b");
    });

    it("keeps the PATH raw verbatim", () => {
        expect(querySurface("https://f.test/a%20b/c?q=1")).toBe("https://f.test/a%20b/c?q=1");
    });

    it("returns a url without ? unchanged", () => {
        expect(querySurface("https://f.test/c#frag%2F")).toBe("https://f.test/c#frag%2F");
    });

    it("splits at the FIRST # — a ? inside the fragment stays raw", () => {
        expect(querySurface("https://f.test/c#frag?x%3D1")).toBe("https://f.test/c#frag?x%3D1");
    });

    it("keeps every invalid escape in the query raw", () => {
        expect(querySurface("https://f.test/c?a=%FFq")).toBe("https://f.test/c?a=%FFq");
    });

    it("keeps an encoded plus while decoding a raw plus as space", () => {
        expect(querySurface("https://f.test/c?q=a%2Bb+c")).toBe("https://f.test/c?q=a+b c");
    });

    it("decodes multibyte escapes in the query", () => {
        expect(querySurface("https://f.test/c?q=%C3%A4")).toBe("https://f.test/c?q=ä");
    });
});
