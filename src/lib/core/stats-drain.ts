// ─────────────────────────────────────────────────────────────────────────────
// MARK: Stats drain — boot recovery for a truncated GM write
// ─────────────────────────────────────────────────────────────────────────────
// * A redirect whose GM write was truncated stashes the pending counters in
//   `window.name`; the next boot drains them into storage before the watcher.
// * ! Boot-time only — runs at document-start, outside the stats sink.

import { createLogger } from "./log";
import { mergeStats, normalizeStats, type Stats } from "./stats";
import { STORAGE_KEY_STATS, storageGetResult, storageSet } from "./storage";

const log = createLogger("boot");

/**
 * Clears ONLY the `rrStatsDelta` stash from `window.name`.
 *
 * * Every other key is preserved; a non-JSON payload is left untouched.
 * * Used after a successful `flush()` so the next boot cannot re-apply the delta.
 */
export function clearStatsDeltaStash(): void {
    try {
        const raw = window.name;
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
        const state = parsed as Record<string, unknown>;
        if (!("rrStatsDelta" in state)) return;
        delete state.rrStatsDelta;
        window.name = JSON.stringify(state);
        log.debug("stats delta stash cleared");
    } catch (e) {
        // * Foreign non-JSON payload — leave it untouched.
        log.debug("window.name payload ignored during stats stash clear", { error: String(e) });
    }
}

/**
 * Strips raw from/to URLs from every stashed stats field, in place.
 *
 * * `last` is display-only; counts/total survive unchanged.
 * * Legacy `rrStats` shares the shape and is sanitized the same way.
 */
function stripStashedUrls(state: Record<string, unknown>): void {
    for (const field of ["rrStatsDelta", "rrStats"]) {
        const value = state[field];
        if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
        const stats = value as Record<string, unknown>;
        if ("last" in stats) stats.last = null;
    }
}

/**
 * Drains stats stashed in `window.name` from a prior truncated GM write.
 *
 * @returns `null` when there is no stash or the drain succeeded; the normalized
 *          un-drained `rrStatsDelta` when the read/write failed and the stash is
 *          kept, so the boot sink can seed its pending delta. A legacy `rrStats`
 *          full snapshot is NEVER returned as a delta (that would double-count).
 */
export function drainPendingStats(): Stats | null {
    try {
        const raw = window.name;
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
        const state = parsed as Record<string, unknown>;
        if (state.rrStatsDelta === undefined && state.rrStats === undefined) return null;
        log.debug("pending stats stash found in window.name", {
            hasDelta: state.rrStatsDelta !== undefined,
            hasLegacySnapshot: state.rrStats !== undefined,
        });
        // * ! A failed read is NOT empty storage: keep the stash and retry later.
        const read = storageGetResult<unknown>(STORAGE_KEY_STATS, null);
        if (!read.ok) {
            // * ! Never leave raw URLs in window.name — strip before keeping the stash.
            stripStashedUrls(state);
            window.name = JSON.stringify(state);
            log.warn("stats read failed — keeping the window.name stash");
            return state.rrStatsDelta === undefined ? null : normalizeStats(state.rrStatsDelta);
        }
        const stored = normalizeStats(read.value);
        // * Legacy adoption requires storage to be TRULY empty (all three fields).
        const storedEmpty = stored.total === 0 && Object.keys(stored.counts).length === 0 && stored.last === null;
        let written = false;
        if (state.rrStatsDelta !== undefined) {
            // * New shape: the delta recorded since the last failed write.
            written = storageSet(STORAGE_KEY_STATS, mergeStats(stored, normalizeStats(state.rrStatsDelta)));
        } else if (storedEmpty) {
            // * Legacy full snapshot: only safe when storage has no newer data.
            written = storageSet(STORAGE_KEY_STATS, normalizeStats(state.rrStats));
        } else {
            written = true; // * Legacy snapshot superseded by newer storage.
        }
        if (!written) {
            // * ! Keep the un-drained delta for the next boot, URL-free.
            stripStashedUrls(state);
            window.name = JSON.stringify(state);
            log.warn("pending stats drain failed — keeping the window.name stash");
            return state.rrStatsDelta === undefined ? null : normalizeStats(state.rrStatsDelta);
        }
        delete state.rrStatsDelta;
        delete state.rrStats;
        window.name = JSON.stringify(state);
        log.debug("pending stats drained into storage");
        return null;
    } catch (e) {
        // * Self-heal — a foreign payload never crashes boot.
        log.debug("window.name payload ignored during stats drain", { error: String(e) });
        return null;
    }
}
