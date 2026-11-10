import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOTION_FAST_MS, motionFastDuration } from "../motion";
import type { MotionLevel } from "../../core/settings";

const css = readFileSync(new URL("../dashboard.css", import.meta.url), "utf8");

/** Extracts the fast duration per `:root[data-motion="…"]` block from the CSS. */
function cssFastDurations(): Map<string, number> {
    const durations = new Map<string, number>();
    for (const block of css.matchAll(/:root\[data-motion="([a-z]+)"\]\s*\{([^}]*)\}/g)) {
        const fast = /--rr-motion-duration-fast:\s*(\d+)ms/.exec(block[2]);
        if (fast) durations.set(block[1], Number(fast[1]));
    }
    return durations;
}

describe("MOTION_FAST_MS", () => {
    it("matches every fast duration declared in dashboard.css", () => {
        const durations = cssFastDurations();
        expect([...durations.keys()].sort()).toEqual(Object.keys(MOTION_FAST_MS).sort());
        for (const [motion, ms] of durations) {
            expect(MOTION_FAST_MS[motion as MotionLevel]).toBe(ms);
        }
    });

    it("keeps zero for the aus preset", () => {
        expect(MOTION_FAST_MS.aus).toBe(0);
    });
});

describe("motionFastDuration", () => {
    it("returns the preset duration", () => {
        expect(motionFastDuration("schnell")).toBe(100);
        expect(motionFastDuration("normal")).toBe(120);
        expect(motionFastDuration("langsam")).toBe(220);
        expect(motionFastDuration("aus")).toBe(0);
    });

    it("falls back to 120 for an unknown runtime value", () => {
        expect(motionFastDuration("bogus" as MotionLevel)).toBe(120);
        expect(motionFastDuration(undefined as unknown as MotionLevel)).toBe(120);
    });
});

describe("motionFastDuration reduced motion", () => {
    afterEach(() => vi.unstubAllGlobals());

    const stubReducedMotion = (matches: boolean): void => {
        vi.stubGlobal("matchMedia", (query: string) => ({
            matches,
            media: query,
            onchange: null,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            addListener: () => undefined,
            removeListener: () => undefined,
            dispatchEvent: () => false,
        }));
    };

    it("returns 0 regardless of the preset when the OS asks for reduced motion", () => {
        stubReducedMotion(true);
        expect(motionFastDuration("schnell")).toBe(0);
        expect(motionFastDuration("normal")).toBe(0);
        expect(motionFastDuration("langsam")).toBe(0);
    });

    it("keeps the preset when reduced motion is not requested", () => {
        stubReducedMotion(false);
        expect(motionFastDuration("langsam")).toBe(220);
    });
});
