// ─────────────────────────────────────────────────────────────────────────────
// MARK: Autosave — debounced persistence + session snapshot (runes singleton)
// ─────────────────────────────────────────────────────────────────────────────
// * Every settings change re-arms the debounce (no maxWait);
//   the rail speed pill sets the canonical delay (ADR 0024), Close/ESC flush.
// * Fail-safe pause: an invalid non-empty regex OR an entirely empty row/group
//   pauses persisting (prune would delete a prefilled row; empty gates are unsafe);
//   a rejected GM write also pauses (`write`) and retries on the next change/flush.
// * Session snapshot: the persisted state at boot powers undo; no stack, no cross-session persistence.
// * Multi-dashboard: remote writes adopt while clean; a dirty tab shows a conflict hint (last-write-wins).
// ! `schedule()` is imperative (writes `autosave.*`): tracked callers MUST `untrack()` it.

import { store } from "../stores/settings.svelte";
import { loadSettingsResult } from "../core/settings";
import { createLogger } from "../core/log";
import { invalidRegexCount, isSitePersistBlocked } from "./validation";

const log = createLogger("autosave");

/** Autosave debounce (ms) — every settings change re-arms this timer. */
export const AUTOSAVE_DELAY_MS = 2000;

/** Why the autosave is paused (null = not paused) — drives hints + the close guard. */
export type PauseReason = "invalid" | "empty" | "write";

/** Reactive autosave state — read by the speed pill, status line, and App guards. */
export const autosave = $state({
    /** "pending" = debounce armed; "paused" = gate blocks persisting; "idle" = neither. */
    phase: "idle" as "idle" | "pending" | "paused",
    /** Why persisting is blocked (null while not paused). */
    pausedReason: null as PauseReason | null,
    /** ms epoch of the last automatic/manual apply (null = none yet). */
    lastAppliedAt: null as number | null,
    /** A remote dashboard wrote settings while this tab was dirty (hint until next apply). */
    remoteConflict: false,
    /** Increments on every re-arm — keys the countdown ring so it restarts. */
    pendingSeq: 0,
    /** Delay of the CURRENT debounce (ms; 0 when nothing is pending). */
    pendingDelayMs: 0,
    /** ms epoch of the session snapshot — the undo button's "stand at HH:MM" timestamp. */
    snapshotAt: Date.now(),
});

/**
 * ! Session snapshot — the persisted state at MODULE INIT (= dashboard tab boot).
 * * `null` when the initial storage read FAILED: the served defaults are NOT a
 *   restorable baseline, so it is recaptured after the first successful storage
 *   adoption (manual refresh / remote write).
 */
let snapshot: string | null = store.initialReadOk ? store.savedSnapshot : null;

/** Debounce timer handle (module scope — one autosave per dashboard context). */
let timer: number | null = null;

/**
 * * Arm counter behind `autosave.pendingSeq` (plain variable on purpose):
 *   `autosave.pendingSeq += 1` would READ the reactive field it writes, so a
 *   caller inside a tracked scope would subscribe and re-run forever.
 */
let pendingSeqCounter = 0;

/**
 * The save gate: why persisting must NOT happen right now (null = clear).
 * * invalid BEFORE empty — an invalid regex is the more actionable problem.
 */
function pauseReason(): PauseReason | null {
    if (invalidRegexCount(store.settings) > 0) return "invalid";
    // * Same predicate as the amber incomplete frame: off groups are inert.
    for (const site of store.settings.rules) {
        if (isSitePersistBlocked(site)) return "empty";
    }
    return null;
}

/** Applies the phase state of a successful persist (shared by all commit paths). */
function applied(): void {
    autosave.phase = "idle";
    autosave.pausedReason = null;
    autosave.lastAppliedAt = Date.now();
    autosave.remoteConflict = false;
    autosave.pendingDelayMs = 0;
}

/** Persists now if the gate allows it — paused otherwise (timer already gone). */
function commit(): void {
    const reason = pauseReason();
    if (reason !== null) {
        log.debug("autosave paused", { reason, dirty: store.dirty });
        autosave.phase = "paused";
        autosave.pausedReason = reason;
        autosave.pendingDelayMs = 0;
        return;
    }
    log.debug("autosave commit", { dirty: store.dirty });
    if (!store.save()) {
        // * prune may have reconciled the state with the snapshot — nothing was lost.
        if (!store.dirty) {
            applied();
            return;
        }
        autosave.phase = "paused";
        autosave.pausedReason = "write";
        autosave.pendingDelayMs = 0;
        return;
    }
    applied();
}

/** Clears an armed debounce timer (shared by all immediate paths). */
function clearTimer(): void {
    if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
    }
}

/**
 * (Re-)arms the autosave debounce — called by the App effect on every settings
 * change. The gate is checked when the timer FIRES (a still-invalid regex may
 * become valid with the next keystroke; the next change re-arms anyway).
 */
export function schedule(): void {
    // * Read the arm flag from the module-local timer, NOT `autosave.phase`:
    //   this function writes that field, and a tracked caller must not learn
    //   its own writes as dependencies.
    const wasPending = timer !== null;
    clearTimer();
    const delay = store.settings.autosaveDelayMs ?? AUTOSAVE_DELAY_MS;
    autosave.phase = "pending";
    autosave.pausedReason = null;
    pendingSeqCounter += 1;
    autosave.pendingSeq = pendingSeqCounter;
    autosave.pendingDelayMs = delay;
    if (!wasPending) log.debug("autosave armed", { delay });
    timer = window.setTimeout(() => {
        timer = null;
        log.debug("autosave timer fired", { dirty: store.dirty });
        // * Clean (a flush raced ahead) → nothing to persist.
        if (!store.dirty) {
            autosave.phase = "idle";
            autosave.pendingDelayMs = 0;
            return;
        }
        commit();
    }, delay);
}

/**
 * Immediate gate-checked persist (close paths: X/ESC/beforeunload) — cancels a
 * pending debounce; rows that cannot persist (invalid/empty) stay unpersisted
 * so the close guard can still ask about them.
 *
 * @returns True when the store is clean or the write persisted; false when
 *          autosave is paused (invalid/empty/write) and a receipt must say so.
 */
export function flush(): boolean {
    clearTimer();
    log.debug("autosave flush", { dirty: store.dirty });
    if (!store.dirty) {
        // * Clean flush must not leave an idle-but-paused phase behind.
        autosave.phase = "idle";
        autosave.pausedReason = null;
        autosave.remoteConflict = false;
        autosave.pendingDelayMs = 0;
        return true;
    }
    commit();
    return autosave.phase === "idle";
}

/** Restores the session snapshot (undo) + persists it deterministically. */
export function restoreSnapshot(): void {
    clearTimer();
    // * ! No trusted baseline (failed boot read) — never replace the live state
    //   with defaults; that would overwrite intact storage on the commit.
    if (snapshot === null) {
        log.warn("restore snapshot refused — no trusted session baseline (initial read failed)");
        return;
    }
    log.debug("autosave restore snapshot", { snapshotAt: autosave.snapshotAt });
    store.replace(JSON.parse(snapshot) as unknown, { source: "undo" });
    commit();
}

/**
 * Whether the working state EQUALS the session snapshot — the undo button's
 * disabled condition. NOT plain `!dirty`: after an autosave commit the store is
 * clean but the session still differs from its opening state — undo must stay
 * available exactly then (it is the safety net for automatic saves).
 * * No trusted baseline → undo is never available.
 */
export function isSnapshotCurrent(): boolean {
    return snapshot === null || store.settingsJson === snapshot;
}

/**
 * Recaptures the undo baseline after the FIRST successful storage adoption on a
 * failed-read boot — the recovered stored state replaces the unusable defaults.
 */
function recaptureSnapshotIfMissing(): void {
    if (snapshot !== null) return;
    snapshot = store.savedSnapshot;
    autosave.snapshotAt = Date.now();
    log.debug("session snapshot recovered from storage");
}

/**
 * A remote settings write from another dashboard (GM value-change listener).
 * * CLEAN → adopt: the store reloads (UI syncs live), clean by construction —
 *   the autosave effect sees no dirty state, no write-back, no ping-pong.
 * * DIRTY → local wins: raise the conflict hint; the local commit overwrites
 *   the remote change (documented last-write-wins policy).
 */
/**
 * Manual refresh: discard in-memory state, reload site rules/settings from GM
 * storage (cache), recompute/render previews via store reactivity.
 *
 * A FAILED read does NOT reload: the store keeps its current state, autosave
 * pauses with the generic `write` reason, and intact storage stays untouched.
 */
export function refreshFromStorage(): void {
    clearTimer();
    log.debug("autosave refresh from storage");
    const read = loadSettingsResult();
    if (!read.ok) {
        log.error("refresh aborted — settings read failed; storage left untouched");
        autosave.phase = "paused";
        autosave.pausedReason = "write";
        autosave.pendingDelayMs = 0;
        return;
    }
    store.reloadRemote(read.settings);
    recaptureSnapshotIfMissing();
    autosave.phase = "idle";
    autosave.pausedReason = null;
    autosave.pendingDelayMs = 0;
    autosave.remoteConflict = false;
}

export function onRemoteSettingsChange(raw: unknown): void {
    if (store.dirty) {
        autosave.remoteConflict = true;
        log.debug("remote settings write ignored — local tab is dirty");
        return;
    }
    log.debug("remote settings write adopted");
    store.reloadRemote(raw);
    recaptureSnapshotIfMissing();
    autosave.remoteConflict = false;
}
