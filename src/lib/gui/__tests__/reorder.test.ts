import { describe, expect, it } from "vitest";
import { moveFlag, moveIndex, moveItem, remapIndex, shiftIndexAfterInsert, shiftIndexAfterRemove } from "../reorder";

describe("moveIndex", () => {
    it("handles insert-before and insert-after in both directions", () => {
        expect(moveIndex(1, 3, false, 4)).toBe(2); // * B below D's top half → before D
        expect(moveIndex(1, 3, true, 4)).toBe(3); // * B below D's bottom half → after D
        expect(moveIndex(3, 1, false, 4)).toBe(1); // * D above B → before B
        expect(moveIndex(3, 1, true, 4)).toBe(2); // * D below B → after B
    });

    it("clamps to the valid result range", () => {
        expect(moveIndex(0, 0, false, 1)).toBe(0);
        expect(moveIndex(0, 99, true, 3)).toBe(2);
        expect(moveIndex(2, -5, false, 3)).toBe(0);
        expect(moveIndex(0, 0, false, 0)).toBe(0);
    });
});

describe("moveItem", () => {
    it("moves without mutating the source", () => {
        const source = ["A", "B", "C", "D"];
        expect(moveItem(source, 1, 2)).toEqual(["A", "C", "B", "D"]);
        expect(source).toEqual(["A", "B", "C", "D"]);
    });

    it("returns a copy for an invalid source index", () => {
        const source = [1, 2];
        const next = moveItem(source, 5, 0);
        expect(next).toEqual([1, 2]);
        expect(next).not.toBe(source);
    });
});

describe("state index helpers", () => {
    it("moves flags with the item", () => {
        expect(moveFlag([true, false, true, false], 0, 2)).toEqual([false, true, true, false]);
    });

    it("remaps selection across moves and removals/inserts", () => {
        expect(remapIndex(0, 0, 3)).toBe(3);
        expect(remapIndex(2, 0, 3)).toBe(1);
        expect(remapIndex(1, 3, 0)).toBe(2);
        expect(shiftIndexAfterRemove(3, 1)).toBe(2);
        expect(shiftIndexAfterRemove(1, 1)).toBe(1);
        expect(shiftIndexAfterInsert(2, 1)).toBe(3);
        expect(shiftIndexAfterInsert(0, 1)).toBe(0);
    });
});
