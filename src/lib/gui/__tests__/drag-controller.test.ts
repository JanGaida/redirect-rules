import { describe, expect, it } from "vitest";
import { resolveDropPos } from "../drag-controller";

const rows = [
    { top: 100, bottom: 140 },
    { top: 140, bottom: 180 },
    { top: 180, bottom: 220 },
];

describe("resolveDropPos", () => {
    it("returns null for an empty list", () => {
        expect(resolveDropPos([], 120)).toBeNull();
    });

    it("flips insertAfter at the hovered row midpoint", () => {
        expect(resolveDropPos(rows, 105)).toEqual({ pos: 0, insertAfter: false });
        expect(resolveDropPos(rows, 119)).toEqual({ pos: 0, insertAfter: false });
        expect(resolveDropPos(rows, 121)).toEqual({ pos: 0, insertAfter: true });
        expect(resolveDropPos(rows, 165)).toEqual({ pos: 1, insertAfter: true });
    });

    it("clamps above the first and below the last row", () => {
        expect(resolveDropPos(rows, 0)).toEqual({ pos: 0, insertAfter: false });
        expect(resolveDropPos(rows, 999)).toEqual({ pos: 2, insertAfter: true });
    });

    it("treats a row boundary as the upper row's end", () => {
        expect(resolveDropPos(rows, 140)).toEqual({ pos: 0, insertAfter: true });
    });
});
