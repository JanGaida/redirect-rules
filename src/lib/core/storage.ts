// ─────────────────────────────────────────────────────────────────────────────
// MARK: Storage — thin GM_* wrapper
// ─────────────────────────────────────────────────────────────────────────────
// * Single GM key (ADR 0003); Tampermonkey scopes keys per script, so no prefixing.
// * Fail-soft: every GM call is guarded; errors surface via the logger.

import { createLogger } from "./log";

const log = createLogger("storage");

/** The single GM storage key holding the settings object. */
export const STORAGE_KEY = "settings";

/** The separate GM key for redirect stats (telemetry — never exported with settings). */
export const STORAGE_KEY_STATS = "stats";

/** Cross-tab dashboard signaling: the boot request ("Create new Rule" prefill). */
export const STORAGE_KEY_DASHBOARD_REQUEST = "dashboard-request";

/** Result of a guarded GM read — `ok: false` means the GM call threw. */
export interface StorageGetResult<T> {
    /** False when `GM_getValue` threw (NOT the same as an absent key). */
    ok: boolean;
    /** The stored value, or the fallback when the read failed. */
    value: T;
}

/**
 * Reads a value from GM storage and reports whether the read succeeded.
 *
 * @param key      - Storage key (see `STORAGE_KEY`).
 * @param fallback - Value returned when the key is absent or the read failed.
 * @returns `ok: true` with the stored value (or fallback when absent);
 *          `ok: false` with the fallback when `GM_getValue` threw.
 */
export function storageGetResult<T>(key: string, fallback: T): StorageGetResult<T> {
    try {
        const value = GM_getValue<T>(key, fallback);
        log.debug("get", { key, found: value !== fallback });
        return { ok: true, value };
    } catch (e) {
        log.error("GM_getValue failed — using fallback", {
            key,
            error: String(e),
            stack: e instanceof Error ? e.stack : undefined,
        });
        return { ok: false, value: fallback };
    }
}

/**
 * Reads a value from GM storage.
 *
 * @param key      - Storage key (see `STORAGE_KEY`).
 * @param fallback - Value returned when the key is absent or storage fails.
 * @returns The stored value, or the fallback.
 */
export function storageGet<T>(key: string, fallback: T): T {
    return storageGetResult(key, fallback).value;
}

/**
 * Writes a value to GM storage.
 *
 * @param key   - Storage key (see `STORAGE_KEY`).
 * @param value - Value to store (structured values are cloned by Tampermonkey).
 * @returns True on success, false when the GM call threw.
 */
export function storageSet(key: string, value: unknown): boolean {
    try {
        GM_setValue(key, value);
        log.debug("set", { key, valueType: typeof value });
        return true;
    } catch (e) {
        log.error("GM_setValue failed", {
            key,
            error: String(e),
            stack: e instanceof Error ? e.stack : undefined,
        });
        return false;
    }
}

/**
 * Deletes a key from GM storage.
 *
 * @param key - Storage key (see `STORAGE_KEY`).
 * @returns True on success, false when the GM call threw.
 */
export function storageDelete(key: string): boolean {
    try {
        GM_deleteValue(key);
        log.debug("delete", { key });
        return true;
    } catch (e) {
        log.error("GM_deleteValue failed", {
            key,
            error: String(e),
            stack: e instanceof Error ? e.stack : undefined,
        });
        return false;
    }
}
