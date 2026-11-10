/**
 * In-memory GM_* stubs shared by the settings + store test suites.
 *
 * The storage module resolves the GM globals at CALL time (not import time), so
 * assigning them on globalThis is enough — the userscript context provides them
 * via Tampermonkey grants; vitest node/jsdom envs do not.
 */
export function installGmStubs(initial: Record<string, unknown> = {}): Map<string, unknown> {
    const store = new Map<string, unknown>(Object.entries(initial));
    (globalThis as Record<string, unknown>).GM_getValue = <T>(key: string, fallback: T): T =>
        store.has(key) ? (store.get(key) as T) : fallback;
    // * Clone-on-write (Tampermonkey parity, storage.ts documents the clone):
    //   a stored REFERENCE would leak later store mutations into "persisted"
    //   reads — autosave tests assert what is ACTUALLY on disk. JSON round-trip
    //   because settings values are $state PROXIES (structuredClone throws);
    //   the SEED stays by reference — settings.test.ts asserts load does NOT
    //   rewrite the stored object (reference identity).
    (globalThis as Record<string, unknown>).GM_setValue = (key: string, value: unknown): void => {
        store.set(key, JSON.parse(JSON.stringify(value)));
    };
    (globalThis as Record<string, unknown>).GM_deleteValue = (key: string): void => {
        store.delete(key);
    };
    (globalThis as Record<string, unknown>).GM_listValues = (): string[] => [...store.keys()];
    return store;
}

/** Removes the GM stubs (test teardown). */
export function uninstallGmStubs(): void {
    for (const name of ["GM_getValue", "GM_setValue", "GM_deleteValue", "GM_listValues"]) {
        delete (globalThis as Record<string, unknown>)[name];
    }
}
