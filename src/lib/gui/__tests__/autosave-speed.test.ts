import { describe, expect, it } from "vitest";

import { AUTOSAVE_SPEEDS, nearestAutosaveSpeed, nextAutosaveDelay } from "../autosave-speed";

describe("autosave speed mapping (ADR 0024)", () => {
    it("exposes the canonical fast → normal → slow cycle", () => {
        expect(AUTOSAVE_SPEEDS.map((step) => [step.id, step.ms])).toEqual([
            ["fast", 1000],
            ["normal", 2000],
            ["slow", 5000],
        ]);
    });

    it("maps persisted delays to the nearest step", () => {
        expect(nearestAutosaveSpeed(500).id).toBe("fast");
        expect(nearestAutosaveSpeed(1000).id).toBe("fast");
        expect(nearestAutosaveSpeed(1500).id).toBe("normal");
        expect(nearestAutosaveSpeed(2000).id).toBe("normal");
        expect(nearestAutosaveSpeed(3500).id).toBe("slow");
        expect(nearestAutosaveSpeed(5000).id).toBe("slow");
        expect(nearestAutosaveSpeed(10000).id).toBe("slow");
    });

    it("advances to the next canonical delay and wraps", () => {
        expect(nextAutosaveDelay(1000)).toBe(2000);
        expect(nextAutosaveDelay(2000)).toBe(5000);
        expect(nextAutosaveDelay(5000)).toBe(1000);
        // * Legacy values advance from their nearest step.
        expect(nextAutosaveDelay(500)).toBe(2000);
        expect(nextAutosaveDelay(10000)).toBe(1000);
    });
});
