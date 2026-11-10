// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drainPendingStats, clearStatsDeltaStash } from "../stats-drain";
import { createStatsSink, type Stats } from "../stats";
import { STORAGE_KEY_STATS } from "../storage";
import type { AppliedRule } from "../redirect-engine";
import { installGmStubs, uninstallGmStubs } from "./gm-stubs";

let gmStore: Map<string, unknown>;

/** Parses the surviving `window.name` payload (drain always re-serializes it). */
function stashedName(): Record<string, unknown> {
    return JSON.parse(window.name) as Record<string, unknown>;
}

describe("drainPendingStats", () => {
    beforeEach(() => {
        gmStore = installGmStubs();
        window.name = "";
    });

    afterEach(() => {
        uninstallGmStubs();
    });

    it("merges a delta into empty storage and strips the stash", () => {
        const delta = { counts: { hash: 2 }, total: 2, last: null };
        window.name = JSON.stringify({ rrStatsDelta: delta, other: "keep" });

        drainPendingStats();

        expect(gmStore.get(STORAGE_KEY_STATS)).toEqual(delta);
        expect(stashedName()).toEqual({ other: "keep" });
    });

    it("adopts a legacy snapshot when storage is empty", () => {
        const legacy = { counts: { hash: 5 }, total: 5, last: { from: "a", to: "b", ts: 1 } };
        window.name = JSON.stringify({ rrStats: legacy });

        drainPendingStats();

        expect(gmStore.get(STORAGE_KEY_STATS)).toEqual(legacy);
        expect(stashedName()).toEqual({});
    });

    it("keeps newer storage and strips a superseded legacy snapshot", () => {
        const stored = { counts: { hash: 9 }, total: 9, last: null };
        gmStore.set(STORAGE_KEY_STATS, stored);
        window.name = JSON.stringify({ rrStats: { counts: { hash: 1 }, total: 1, last: null } });

        drainPendingStats();

        expect(gmStore.get(STORAGE_KEY_STATS)).toEqual(stored);
        expect(stashedName()).toEqual({});
    });

    it("prefers the delta when both shapes are present", () => {
        const delta = { counts: { delta: 2 }, total: 2, last: null };
        const legacy = { counts: { legacy: 5 }, total: 5, last: null };
        window.name = JSON.stringify({ rrStatsDelta: delta, rrStats: legacy });

        drainPendingStats();

        expect(gmStore.get(STORAGE_KEY_STATS)).toEqual(delta);
        expect(stashedName()).toEqual({});
    });

    it("leaves an unrelated payload untouched", () => {
        const payload = JSON.stringify({ unrelated: true });
        window.name = payload;

        drainPendingStats();

        expect(window.name).toBe(payload);
        expect(gmStore.has(STORAGE_KEY_STATS)).toBe(false);
    });

    it("leaves a non-JSON payload untouched", () => {
        window.name = "not json at all";

        drainPendingStats();

        expect(window.name).toBe("not json at all");
        expect(gmStore.has(STORAGE_KEY_STATS)).toBe(false);
    });

    it("keeps the stash when the GM write fails", () => {
        const delta = { counts: { hash: 2 }, total: 2, last: null };
        window.name = JSON.stringify({ rrStatsDelta: delta });
        (globalThis as Record<string, unknown>).GM_setValue = (): void => {
            throw new Error("quota exceeded");
        };

        drainPendingStats();

        expect(stashedName()).toEqual({ rrStatsDelta: delta });
        expect(gmStore.has(STORAGE_KEY_STATS)).toBe(false);
    });

    it("keeps the stash when the stats read fails", () => {
        const delta = { counts: { hash: 2 }, total: 2, last: null };
        window.name = JSON.stringify({ rrStatsDelta: delta, other: "keep" });
        (globalThis as Record<string, unknown>).GM_getValue = (): never => {
            throw new Error("get failed");
        };

        drainPendingStats();

        // * ! A failed read is NOT empty storage — never merge into an empty base.
        expect(stashedName()).toEqual({ rrStatsDelta: delta, other: "keep" });
        expect(gmStore.has(STORAGE_KEY_STATS)).toBe(false);
    });

    it("adopts a legacy snapshot only when stored stats are TRULY empty", () => {
        const stored = { counts: { existing: 1 }, total: 0, last: null };
        const legacy = { counts: { legacy: 5 }, total: 5, last: null };
        gmStore.set(STORAGE_KEY_STATS, stored);
        window.name = JSON.stringify({ rrStats: legacy });

        drainPendingStats();

        expect(gmStore.get(STORAGE_KEY_STATS)).toEqual(stored);
        expect(stashedName()).toEqual({});
    });

    it("returns null when there is no stash or the drain succeeded", () => {
        window.name = JSON.stringify({ other: "keep" });
        expect(drainPendingStats()).toBeNull();

        window.name = JSON.stringify({ rrStatsDelta: { counts: { hash: 2 }, total: 2, last: null } });
        expect(drainPendingStats()).toBeNull();
    });

    it("returns the un-drained delta when the read fails, and a seeded sink loses nothing", () => {
        const delta = { counts: { seed: 2 }, total: 2, last: null };
        window.name = JSON.stringify({ rrStatsDelta: delta, other: "keep" });
        (globalThis as Record<string, unknown>).GM_getValue = (): never => {
            throw new Error("get failed");
        };

        const seed = drainPendingStats();
        expect(seed).toEqual(delta);
        // * Stash kept for the next boot while the read still fails.
        expect(stashedName()).toEqual({ rrStatsDelta: delta, other: "keep" });

        let readOk = false;
        let stored: unknown = null;
        const writes: Stats[] = [];
        const sink = createStatsSink(
            {
                read: () => (readOk ? { ok: true, value: stored } : { ok: false, value: null }),
                write: (stats) => {
                    stored = stats;
                    writes.push(stats);
                    return true;
                },
                now: () => 10_000,
            },
            seed ?? undefined,
        );
        const applied: AppliedRule[] = [
            {
                siteRegex: "/site/",
                rule: { kind: "replace", regex: "/a/", substitution: "b" },
                oldUrl: "https://a.test/",
                newUrl: "https://b.test/",
            },
        ];

        sink.record(applied, "from", "to");
        expect(writes).toHaveLength(0);
        expect(sink.pendingDelta().counts.seed).toBe(2);
        expect(sink.pendingDelta().total).toBe(3);

        readOk = true;
        expect(sink.flush()).toBe("persisted");
        expect(writes).toHaveLength(1);
        expect((stored as Stats).total).toBe(3);
        expect((stored as Stats).counts.seed).toBe(2);
        expect(sink.pendingDelta().total).toBe(0);
    });

    it("returns null for a failed drain with only a legacy snapshot (never seeded as a delta)", () => {
        const legacy = { counts: { legacy: 5 }, total: 5, last: { from: "a", to: "b", ts: 1 } };
        window.name = JSON.stringify({ rrStats: legacy });
        (globalThis as Record<string, unknown>).GM_getValue = (): never => {
            throw new Error("get failed");
        };

        expect(drainPendingStats()).toBeNull();
        // * Stash kept, but raw from/to URLs are stripped before it stays.
        const stash = stashedName() as { rrStats: Stats };
        expect(stash.rrStats.total).toBe(5);
        expect(stash.rrStats.counts.legacy).toBe(5);
        expect(stash.rrStats.last).toBeNull();
    });

    it("sanitizes a stashed delta last when a failed write keeps it", () => {
        const delta = {
            counts: { hash: 2 },
            total: 2,
            last: { from: "https://a.test/?token=secret", to: "https://b.test/", ts: 1 },
        };
        window.name = JSON.stringify({ rrStatsDelta: delta });
        (globalThis as Record<string, unknown>).GM_setValue = (): void => {
            throw new Error("quota exceeded");
        };

        const seed = drainPendingStats();
        expect(seed?.last).toBeNull();
        expect(window.name).not.toContain("token=secret");
        expect(stashedName()).toEqual({ rrStatsDelta: { counts: { hash: 2 }, total: 2, last: null } });
    });
});

describe("clearStatsDeltaStash", () => {
    it("removes only rrStatsDelta and preserves every other key", () => {
        window.name = JSON.stringify({ rrStatsDelta: { total: 1 }, rrLoop: [{ source: "x", ts: 1 }], other: 2 });

        clearStatsDeltaStash();

        expect(stashedName()).toEqual({ rrLoop: [{ source: "x", ts: 1 }], other: 2 });
    });

    it("leaves a non-JSON payload untouched", () => {
        window.name = "not json at all";

        clearStatsDeltaStash();

        expect(window.name).toBe("not json at all");
    });
});
