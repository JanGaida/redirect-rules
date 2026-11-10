import { describe, it, expect } from "vitest";

import { decodeText } from "../encoding";

describe("decodeText", () => {
    it("round-trips UTF-8 content through base64", () => {
        const source = "Umüt → arrows → \nbroken? NEIN\nsecond line";
        const encoded = Buffer.from(source, "utf-8").toString("base64");
        expect(decodeText(encoded)).toBe(source);
    });

    it("decodes an empty payload to an empty string", () => {
        expect(decodeText("")).toBe("");
    });

    it("round-trips four-byte UTF-8 sequences", () => {
        const source = "😀 🚀";
        expect(decodeText(Buffer.from(source, "utf-8").toString("base64"))).toBe(source);
    });

    it("replaces invalid UTF-8 bytes instead of throwing", () => {
        expect(decodeText("/w==")).toBe("\uFFFD");
    });

    it("throws on malformed base64", () => {
        expect(() => decodeText("!!!")).toThrow();
    });
});
