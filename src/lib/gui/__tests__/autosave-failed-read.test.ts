// @vitest-environment jsdom
import { installGmStubs, uninstallGmStubs } from "../../core/__tests__/gm-stubs";
import { STORAGE_KEY } from "../../core/storage";

// ! The store AND the autosave singleton initialize at import time. The initial
//   GM read MUST fail here — the stub is installed (and overridden) BEFORE the
//   dynamic imports, so the module singleton captures a failed boot read.
const storedSettings = {
    locale: "en",
    rules: [
        {
            siteRegex: "/stored\\.test/",
            rules: [{ kind: "replace", regex: "/a/", substitution: "b" }],
        },
    ],
};

const gm = installGmStubs({ settings: storedSettings });
const globals = globalThis as Record<string, unknown>;
const gmGetValue = globals.GM_getValue as (key: string, fallback: unknown) => unknown;
const gmSetValue = globals.GM_setValue as (key: string, value: unknown) => void;

let failRead = true;
let setCalls = 0;
globals.GM_getValue = (key: string, fallback: unknown): unknown => {
    if (failRead) throw new Error("settings read failed");
    return gmGetValue(key, fallback);
};
globals.GM_setValue = (key: string, value: unknown): void => {
    setCalls += 1;
    gmSetValue(key, value);
};

const { store } = await import("../../stores/settings.svelte");
const { autosave, isSnapshotCurrent, refreshFromStorage, restoreSnapshot } = await import("../autosave.svelte");

import { afterAll, describe, expect, it } from "vitest";

afterAll(() => {
    uninstallGmStubs();
});

describe("session snapshot after a failed boot read", () => {
    it("recovers the stored baseline and never writes defaults", () => {
        // * Failed read: defaults live in memory, but no baseline exists.
        expect(store.initialReadOk).toBe(false);
        expect(isSnapshotCurrent()).toBe(true);
        expect(setCalls).toBe(0);

        // * Undo is a guarded no-op — no write over intact storage.
        restoreSnapshot();
        expect(setCalls).toBe(0);
        expect(gm.get(STORAGE_KEY)).toEqual(storedSettings);

        // * The failed-read guard also blocks a direct save — defaults never land on disk.
        expect(store.save()).toBe(false);
        expect(setCalls).toBe(0);

        // * A successful refresh re-enables persistence and adopts the stored state.
        failRead = false;
        refreshFromStorage();
        expect(store.settings.rules[0]?.siteRegex).toBe("/stored\\.test/");
        expect(isSnapshotCurrent()).toBe(true);
        expect(autosave.snapshotAt).toBeGreaterThan(0);

        // * A valid change makes undo available …
        store.settings.rules[0].rules[0] = { kind: "replace", regex: "/b/", substitution: "c" };
        expect(isSnapshotCurrent()).toBe(false);

        // * … and undo restores the RECOVERED stored state, not boot defaults.
        restoreSnapshot();
        expect(isSnapshotCurrent()).toBe(true);
        const persisted = gm.get(STORAGE_KEY) as { rules: Array<{ siteRegex: string; rules: unknown[] }> };
        expect(persisted.rules).toHaveLength(1);
        expect(persisted.rules[0]?.siteRegex).toBe("/stored\\.test/");
        expect(persisted.rules[0]?.rules).toEqual(storedSettings.rules[0].rules);
        expect(setCalls).toBeGreaterThan(0);
    });

    it("keeps the live state and pauses autosave when a refresh read fails", () => {
        const before = JSON.stringify(store.settings);
        const writes = setCalls;

        failRead = true;
        refreshFromStorage();

        expect(JSON.stringify(store.settings)).toBe(before);
        expect(autosave.phase).toBe("paused");
        expect(autosave.pausedReason).toBe("write");
        expect(autosave.pendingDelayMs).toBe(0);
        expect(setCalls).toBe(writes);

        failRead = false;
    });
});
