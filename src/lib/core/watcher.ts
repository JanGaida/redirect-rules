// ─────────────────────────────────────────────────────────────────────────────
// MARK: Watcher — the single side-effect layer
// ─────────────────────────────────────────────────────────────────────────────
// * ADR 0001: every side effect lives HERE — pushState patch, popstate/urlchange
//   listeners, loop-guard state, and the single location.replace call.
// * SPA parity: pushState + popstate hooked; replaceState deliberately not.
// * Loop guard: recent source HASHES (never raw URLs) catch A→B→A within a window.
// ! PRIVACY: state lives in window.name (sessionStorage unavailable at document-start),
//   which is readable by the destination document — hashes and URL-free deltas only.
// ! A foreign window.name OBJECT is preserved; non-JSON/primitive/array payloads
//   are replaced — the guard must persist; accepted destructive trade-off.

import { applyRules, type CompiledSiteRule } from "./redirect-engine";
import type { Stats, StatsSink } from "./stats";
import { createLogger, isDebugEnabled } from "./log";

const log = createLogger("watcher");

/** How long (ms) a redirect source stays "hot" for oscillation detection. */
export const LOOP_WINDOW_MS = 3000;

/** Maximum number of hot sources kept in the history (cap). */
export const LOOP_HISTORY_CAP = 10;

/** What triggered a watcher run — correlation context for debug logs. */
export type WatcherTrigger = "boot" | "manual" | "popstate" | "urlchange";

/** One history entry of the loop guard. */
export interface LoopEntry {
    /** Stable hash of the normalized source URL — NEVER the raw URL. */
    key: string;
    /** When that redirect happened (ms epoch). */
    ts: number;
    /** @deprecated Legacy raw URL from older versions — hashed on read, then dropped. */
    source?: string;
}

/**
 * Side-effect surface the watcher needs — injectable for tests (fakes) and the
 * default binding (browser globals).
 */
export interface WatcherRuntime {
    /** Reads the current page URL. */
    getLocation(): string;
    /** Navigates via `location.replace` (no history entry). */
    replace(url: string): void;
    /**
     * Reads the loop-guard history — `null` when the injected runtime has NO
     * storage (guard off = legacy behavior), `[]` when present but empty.
     * The browser runtime always returns an array (`window.name` is available).
     */
    readLoopHistory(): LoopEntry[] | null;
    /** Persists the loop-guard history. */
    writeLoopHistory(entries: LoopEntry[]): void;
    /** Clears the loop-guard history. */
    clearLoopHistory(): void;
    /** Current time in ms. */
    now(): number;
}

/**
 * `window.name` payload — the field isolates us from foreign users of window.name.
 *
 * ! PRIVACY: `rrLoop` stores URL HASHES, never raw URLs. The stats stash never
 *   carries `last.from`/`last.to`; a failed-write recovery loses only the
 *   last-redirect display, never page URLs.
 */
interface WindowNameState {
    rrLoop?: LoopEntry[];
    rrStatsDelta?: unknown;
    /** Legacy full snapshot from older versions — drained only when storage is empty. */
    rrStats?: unknown;
}

/**
 * Stashes the UNWRITTEN stats delta in `window.name` so it survives a failed GM
 * write. An empty delta clears the field (a later successful write supersedes it).
 *
 * ! URL-free by design: `last` holds raw from/to URLs and is NEVER stashed —
 *   a failed-write recovery loses only the last-redirect display, never page URLs.
 */
function stashStatsDeltaInWindowName(delta: Stats, runId?: number): void {
    try {
        const raw = window.name;
        let state: WindowNameState = {};
        if (raw) {
            const parsed: unknown = JSON.parse(raw);
            // * ! Reject arrays: extra props do not serialize, the stash would vanish.
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                state = parsed as WindowNameState;
            }
        }
        // * `last` is never stashed, so it does not make an otherwise empty delta non-empty.
        const empty = delta.total === 0 && Object.keys(delta.counts).length === 0;
        const debug = isDebugEnabled();
        if (empty) {
            delete state.rrStatsDelta;
            delete state.rrStats;
            if (debug) log.debug("stats delta cleared from window.name", { runId });
        } else {
            state.rrStatsDelta = { counts: { ...delta.counts }, total: delta.total, last: null };
            delete state.rrStats;
            if (debug) {
                log.debug("stats delta stashed in window.name", {
                    runId,
                    total: delta.total,
                    counters: Object.keys(delta.counts).length,
                });
            }
        }
        window.name = JSON.stringify(state);
    } catch (e) {
        // ! Trade-off: a valid foreign JSON OBJECT payload is preserved (keys
        //   spread through); only non-JSON/primitive/array payloads are replaced.
        //   Kept deliberately — the delta hand-off must be able to persist.
        log.warn("window.name stats stash failed — keeping in-memory delta", { runId, error: String(e) });
    }
}

/**
 * The default runtime bound to the browser globals.
 *
 * * Loop state in `window.name`: synchronous at document-start (sessionStorage
 *   is NOT — see file header) and persistent across same-tab navigations. A
 *   non-object/invalid window.name payload parses to an empty history —
 *   self-healing, never a crash (a valid object payload is preserved on write).
 */
export function browserRuntime(): WatcherRuntime {
    const readState = (): WindowNameState => {
        try {
            const raw = window.name;
            if (!raw) return {};
            const parsed: unknown = JSON.parse(raw);
            // * Reject arrays — they cannot carry our named fields.
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
            return parsed as WindowNameState;
        } catch (e) {
            // * Self-heal: foreign/invalid window.name payload degrades to empty state.
            log.debug("window.name unreadable — using empty state", { error: String(e) });
            return {};
        }
    };
    const writeState = (state: WindowNameState): void => {
        window.name = JSON.stringify(state);
    };

    return {
        getLocation: () => location.href,
        replace: (url) => location.replace(url),
        readLoopHistory: () => {
            const state = readState();
            const raw = Array.isArray(state.rrLoop) ? state.rrLoop : [];
            const sanitized: LoopEntry[] = [];
            let migrated = false;
            for (const candidate of raw) {
                if (typeof candidate !== "object" || candidate === null) {
                    migrated = true;
                    continue;
                }
                const entry = candidate as LoopEntry;
                const key = entryLoopKey(entry);
                if (key === null) {
                    // * No key and no legacy source — nothing stable to compare.
                    migrated = true;
                    continue;
                }
                if (entry.key !== key || "source" in entry) migrated = true;
                const ts = typeof entry.ts === "number" && Number.isFinite(entry.ts) ? entry.ts : 0;
                sanitized.push({ key, ts });
            }
            // * ! Migration drops legacy raw URLs from window.name as soon as it is read.
            if (migrated) writeState({ ...state, rrLoop: sanitized });
            return sanitized;
        },
        writeLoopHistory: (entries) => {
            writeState({ ...readState(), rrLoop: entries });
        },
        clearLoopHistory: () => {
            writeState({ ...readState(), rrLoop: [] });
        },
        now: () => Date.now(),
    };
}

/**
 * Canonical key for loop-guard comparison — URL normalization when possible.
 *
 * `new URL().href` lowercases the host and drops default ports (e.g. `:443`),
 * so those cosmetic differences cannot slip A→B→A cycles through. Trailing
 * slashes and percent encodings are NOT normalized. Unparsable strings compare
 * verbatim (never throw).
 */
function loopKey(url: string): string {
    try {
        return new URL(url).href;
    } catch {
        return url;
    }
}

/**
 * Stable 64-bit-ish hash of a normalized URL key — two seeded djb2 passes.
 *
 * * 64 bits keeps the collision risk negligible for a ≤10-entry, 3-second
 *   window (a single 32-bit hash would risk a false loop abort from noise).
 * * Hex output is deterministic across runs, so the guard survives navigation.
 */
function hashLoopKey(normalized: string): string {
    let first = 5381;
    let second = 52711;
    for (let i = 0; i < normalized.length; i++) {
        const code = normalized.charCodeAt(i);
        first = ((first << 5) + first + code) >>> 0;
        second = ((second << 5) + second + code) >>> 0;
    }
    return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

/**
 * Loop-guard identity of one history entry.
 *
 * * New entries carry `key` (a hash — never the raw URL).
 * * Legacy entries carry only `source`; hash it on read for migration.
 *
 * @returns The key, or `null` when the entry yields neither.
 */
export function entryLoopKey(entry: LoopEntry): string | null {
    if (typeof entry.key === "string" && entry.key.length > 0) return entry.key;
    if (typeof entry.source === "string" && entry.source.length > 0) {
        return hashLoopKey(loopKey(entry.source));
    }
    return null;
}

/** Handle returned by {@link createWatcher} / {@link startWatcher}. */
export interface Watcher {
    /**
     * Applies the rules to `url` (default: the current location) and redirects
     * when something changed and the loop guard allows it.
     *
     * @param url     - URL to evaluate (defaults to the current location).
     * @param trigger - What invoked the run (boot/menu/SPA event) — debug context.
     * @returns True when a redirect was issued.
     */
    run(url?: string, trigger?: WatcherTrigger): boolean;
    /** Removes the SPA listeners installed by the watcher (test teardown). */
    dispose(): void;
}

/** SPA listeners installed per watcher — `dispose` removes exactly these. */
const spaDisposers = new WeakMap<Watcher, () => void>();

/** Monotonic run id — correlates watcher, engine, and redirect logs. */
let runSeq = 0;

/**
 * Creates a watcher WITHOUT installing any DOM listeners — the run/loop-guard
 * logic against an injectable runtime.
 *
 * * This is the unit-test surface: fakes for location/window.name make the
 *   loop-guard decidable without a browser.
 *
 * @param compiled - Compiled site rules (see `compileRules`).
 * @param runtime  - Side-effect surface — defaults to {@link browserRuntime}.
 * @param sink     - Optional stats sink — records applied rules ONLY when a
 *                   redirect was actually issued (loop-guard aborts count nothing).
 */
export function createWatcher(
    compiled: CompiledSiteRule[],
    runtime: WatcherRuntime = browserRuntime(),
    sink?: StatsSink,
): Watcher {
    function run(url?: string, trigger: WatcherTrigger = "manual"): boolean {
        const runId = ++runSeq;
        const current = url ?? runtime.getLocation();
        const debug = isDebugEnabled();
        if (debug) log.debug("run started", { runId, trigger, url: current, groups: compiled.length });
        const result = applyRules(current, compiled, { runId });

        // * Loop guard: the current url already being a RECENT source means we
        //   redirected away from it (and came back) within the window —
        //   oscillation, abort. A single-marker design cannot catch this: in a
        //   2-cycle the marker always holds the OTHER page on the next hop.
        const history = runtime.readLoopHistory();
        if (debug && history === null) log.debug("loop guard disabled — no history storage", { runId });
        const entries = history ?? [];
        const now = runtime.now();
        // * Clamp negative deltas (backwards clock) to 0 so the age check stays sane.
        const hot = entries.filter((entry) => Math.max(0, now - entry.ts) < LOOP_WINDOW_MS);
        // * Prune stale/over-cap entries even on no-change runs — hashed sources
        //   must not linger in window.name until the next redirect.
        if (history !== null && hot.length !== entries.length) {
            runtime.writeLoopHistory(hot.slice(-LOOP_HISTORY_CAP));
        }

        if (!result.changed) {
            if (debug) log.debug("run finished", { runId, trigger, changed: false, applied: 0, url: current });
            return false;
        }

        const currentKey = hashLoopKey(loopKey(current));
        if (hot.some((entry) => entryLoopKey(entry) === currentKey)) {
            runtime.clearLoopHistory();
            log.error("redirect loop detected — aborting (rule A→B→A?)", {
                runId,
                url: current,
                windowMs: LOOP_WINDOW_MS,
                history: hot.length,
            });
            return false;
        }

        hot.push({ key: currentKey, ts: now } satisfies LoopEntry);
        runtime.writeLoopHistory(hot.slice(-LOOP_HISTORY_CAP));
        if (debug) log.debug("loop history updated", { runId, hot: hot.length, cap: LOOP_HISTORY_CAP });

        log.info("redirecting", { runId, trigger, from: current, to: result.url, rules: result.applied.length });
        // * Stats BEFORE the redirect is issued — `location.replace` can
        //   synchronously raise `beforeunload` (and persist) before any code after
        //   it runs; recording first guarantees the counters are in memory. "Would
        //   apply" is NOT a redirect — loop-guard aborts above return early and
        //   never reach this line.
        sink?.record(result.applied, current, result.url);
        // * Window.name fallback: stash ONLY the still-unwritten delta, so the
        // *   next boot can merge it without double-counting.
        if (sink !== undefined) {
            stashStatsDeltaInWindowName(sink.pendingDelta(), runId);
        }
        runtime.replace(result.url);
        if (debug) {
            log.debug("run finished", {
                runId,
                trigger,
                changed: true,
                applied: result.applied.length,
                from: current,
                to: result.url,
            });
        }
        return true;
    }

    const watcher: Watcher = {
        run,
        dispose: () => {
            const cleanup = spaDisposers.get(watcher);
            if (cleanup === undefined) return;
            cleanup();
            spaDisposers.delete(watcher);
        },
    };
    return watcher;
}

/**
 * Installs the SPA hook (pushState patch + listeners) — module-level, idempotent.
 *
 * * The pushState override dispatches the custom `urlchange` event so the watcher
 *   re-runs on SPA navigations, exactly like the legacy script.
 * * `history.replaceState` is deliberately NOT patched — legacy parity (see
 *   `docs/architecture/testing.md`).
 */
let pushStatePatched = false;
export function installSpaHook(watcher: Watcher): void {
    if (!pushStatePatched) {
        // * ! Hardened pages may reject the patch: keep going — the popstate /
        //   urlchange listeners and the initial redirect must still install.
        try {
            const pushState = history.pushState;
            history.pushState = function (...args: Parameters<typeof pushState>) {
                pushState.apply(this, args);
                window.dispatchEvent(new Event("urlchange"));
            };
            pushStatePatched = true;
            log.debug("history.pushState patched (once per page)");
        } catch (e) {
            log.warn("history.pushState patch failed — SPA pushState events disabled", { error: String(e) });
        }
    }
    const onPopState = (): void => {
        watcher.run(location.href, "popstate");
    };
    const onUrlChange = (): void => {
        watcher.run(location.href, "urlchange");
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("urlchange", onUrlChange);
    log.debug("spa listeners installed", { url: location.href });
    const previousCleanup = spaDisposers.get(watcher);
    spaDisposers.set(watcher, () => {
        previousCleanup?.();
        window.removeEventListener("popstate", onPopState);
        window.removeEventListener("urlchange", onUrlChange);
    });
}

/**
 * Boots the full watcher: SPA hook installed, initial run against the current URL.
 *
 * @param compiled - Compiled site rules (see `compileRules`).
 * @param sink     - Optional stats sink (records issued redirects, see `createWatcher`).
 */
export function startWatcher(compiled: CompiledSiteRule[], sink?: StatsSink): Watcher {
    const watcher = createWatcher(compiled, browserRuntime(), sink);
    installSpaHook(watcher);
    log.debug("watcher started", { url: location.href, groups: compiled.length, stats: sink !== undefined });
    watcher.run(location.href, "boot");
    return watcher;
}
