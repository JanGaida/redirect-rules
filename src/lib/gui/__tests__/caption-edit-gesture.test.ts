import { describe, expect, it } from "vitest";
import { CAPTION_EDIT_CLICK_MS, isCaptionEditClick } from "../caption-edit-gesture";

describe("isCaptionEditClick", () => {
    it("ignores a first click", () => {
        expect(isCaptionEditClick(null, 1000)).toBe(false);
    });

    it("pairs a second click inside the window", () => {
        expect(isCaptionEditClick(1000, 1100)).toBe(true);
        expect(isCaptionEditClick(1000, 1000 + CAPTION_EDIT_CLICK_MS / 2)).toBe(true);
    });

    it("pairs a second click exactly at the window limit", () => {
        expect(isCaptionEditClick(1000, 1000 + CAPTION_EDIT_CLICK_MS)).toBe(true);
    });

    it("rejects a second click beyond the window", () => {
        expect(isCaptionEditClick(1000, 1000 + CAPTION_EDIT_CLICK_MS + 1)).toBe(false);
    });

    it("never pairs a backwards clock", () => {
        expect(isCaptionEditClick(2000, 1999)).toBe(false);
    });
});
