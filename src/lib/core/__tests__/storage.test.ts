import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    STORAGE_KEY,
    STORAGE_KEY_DASHBOARD_REQUEST,
    STORAGE_KEY_STATS,
    storageDelete,
    storageGet,
    storageGetResult,
    storageSet,
} from "../storage";
import { installGmStubs, uninstallGmStubs } from "./gm-stubs";

type GmGlobals = Record<string, unknown>;

let store: Map<string, unknown>;

beforeEach(() => {
    store = installGmStubs();
});

afterEach(() => {
    uninstallGmStubs();
});

describe("storage", () => {
    it("reads a stored value and falls back when the key is absent", () => {
        store.set(STORAGE_KEY, { locale: "de" });
        expect(storageGet(STORAGE_KEY, null)).toEqual({ locale: "de" });
        expect(storageGet("missing", "fallback")).toBe("fallback");
    });

    it("falls back when GM_getValue throws", () => {
        (globalThis as GmGlobals).GM_getValue = () => {
            throw new Error("get failed");
        };
        expect(storageGet(STORAGE_KEY, "fallback")).toBe("fallback");
    });

    it("distinguishes a failed read from an absent key (storageGetResult)", () => {
        store.set(STORAGE_KEY, { locale: "de" });
        expect(storageGetResult(STORAGE_KEY, null)).toEqual({ ok: true, value: { locale: "de" } });
        expect(storageGetResult("missing", null)).toEqual({ ok: true, value: null });

        (globalThis as GmGlobals).GM_getValue = () => {
            throw new Error("get failed");
        };
        expect(storageGetResult(STORAGE_KEY, "fallback")).toEqual({ ok: false, value: "fallback" });
    });

    it("writes and reports success, or false when GM_setValue throws", () => {
        expect(storageSet(STORAGE_KEY_STATS, { total: 1 })).toBe(true);
        expect(store.get(STORAGE_KEY_STATS)).toEqual({ total: 1 });
        (globalThis as GmGlobals).GM_setValue = () => {
            throw new Error("set failed");
        };
        expect(storageSet(STORAGE_KEY_STATS, { total: 2 })).toBe(false);
        expect(store.get(STORAGE_KEY_STATS)).toEqual({ total: 1 });
    });

    it("deletes and reports success, or false when GM_deleteValue throws", () => {
        store.set(STORAGE_KEY_DASHBOARD_REQUEST, { id: "1" });
        expect(storageDelete(STORAGE_KEY_DASHBOARD_REQUEST)).toBe(true);
        expect(store.has(STORAGE_KEY_DASHBOARD_REQUEST)).toBe(false);
        (globalThis as GmGlobals).GM_deleteValue = () => {
            throw new Error("delete failed");
        };
        expect(storageDelete(STORAGE_KEY_DASHBOARD_REQUEST)).toBe(false);
    });
});
