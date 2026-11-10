// @vitest-environment jsdom
import { installGmStubs, uninstallGmStubs } from "../../core/__tests__/gm-stubs";

// ! Same import-order contract as settings-store.test.ts: the store AND the
//   autosave singleton initialize at import time — the session SNAPSHOT is
//   captured from the persisted state at module init (= dashboard boot).
// * Seed: a clean empty-rules state (a missing `rules` key would normalize to
//   the EXAMPLE rules — see settings.test.ts).
const gm = installGmStubs({ settings: { locale: "en", rules: [] } });
const { store } = await import("../../stores/settings.svelte");
const { autosave, AUTOSAVE_DELAY_MS, schedule, flush, restoreSnapshot, onRemoteSettingsChange, isSnapshotCurrent } =
    await import("../autosave.svelte");

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../../core/storage";

afterAll(() => {
    uninstallGmStubs();
});

beforeEach(() => {
    vi.useFakeTimers();
});

/** Resets the store + autosave state between tests (both singletons persist). */
function reset(): void {
    store.replace({ locale: "en", rules: [] });
    store.save();
    flush();
    autosave.lastAppliedAt = null;
    autosave.remoteConflict = false;
    autosave.pendingSeq = 0;
    autosave.pendingDelayMs = 0;
}

/** A valid dirty state: one site group with one complete replace rule. */
function makeValidChange(): void {
    store.addSiteRule();
    store.settings.rules[0].siteRegex = "/a\\.test/";
    store.addRule(0);
    store.settings.rules[0].rules[0] = { kind: "replace", regex: "/old/", substitution: "/new/" };
}

/** The persisted rules (clone-on-write stub — reads what is ACTUALLY on disk). */
function persistedRules(): unknown[] {
    return (gm.get(STORAGE_KEY) as { rules: unknown[] }).rules ?? [];
}

/**
 * An INVALID authored regex — a bare "/(" is a LITERAL (valid!) in the
 * /pattern/flags-or-literal notation (parse-regex.ts); "/(/" is notation with
 * an uncompilable body.
 */
const INVALID_REGEX = "/(/";

describe("autosave debounce", () => {
    it("applies after the delay and clears the phase", () => {
        reset();
        makeValidChange();
        schedule();

        expect(autosave.phase).toBe("pending");
        expect(autosave.pendingSeq).toBe(1);
        expect(autosave.pendingDelayMs).toBe(AUTOSAVE_DELAY_MS);
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
        expect(store.dirty).toBe(true);

        vi.advanceTimersByTime(1);
        expect(store.dirty).toBe(false);
        expect(autosave.phase).toBe("idle");
        expect(autosave.pendingDelayMs).toBe(0);
        expect(autosave.lastAppliedAt).not.toBeNull();
        expect(persistedRules()).toHaveLength(1);
    });

    it("re-arms on every schedule call (pure debounce, no maxWait)", () => {
        reset();
        makeValidChange();

        schedule();
        const firstSeq = autosave.pendingSeq;
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 500);
        schedule(); // * a later change re-arms the timer
        expect(autosave.pendingSeq).toBe(firstSeq + 1);
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 500);
        expect(store.dirty).toBe(true); // * still waiting — the delay restarted

        vi.advanceTimersByTime(500);
        expect(store.dirty).toBe(false);
    });
});

describe("autosave pause gates (fail-safe)", () => {
    it("pauses on an invalid regex and persists NOTHING", () => {
        reset();
        makeValidChange();
        store.settings.rules[0].rules[0] = { kind: "replace", regex: INVALID_REGEX, substitution: "x" };

        schedule();
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

        expect(autosave.phase).toBe("paused");
        expect(autosave.pausedReason).toBe("invalid");
        expect(autosave.pendingDelayMs).toBe(0);
        expect(store.dirty).toBe(true);
        expect(persistedRules()).toEqual([]);
    });

    it("pauses on an entirely-empty row (create-new-rule prefill trap)", () => {
        reset();
        store.addSiteRule(); // * left empty — prune-on-save would DROP it
        store.addRule(0);
        store.settings.rules[0].siteRegex = "/host\\.test/";
        store.settings.rules[0].rules[0] = { kind: "replace", regex: "", substitution: "" };

        schedule();
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

        expect(autosave.phase).toBe("paused");
        expect(autosave.pausedReason).toBe("empty");
        // * the editor state SURVIVES — only persisting waits.
        expect(store.settings.rules).toHaveLength(1);
        expect(persistedRules()).toEqual([]);
    });

    it("pauses on a gated group with zero rules instead of pruning it", () => {
        reset();
        store.addSiteRule(); // * rules: [] — prune would delete the group
        store.settings.rules[0].siteRegex = "/host\\.test/";

        schedule();
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

        expect(autosave.phase).toBe("paused");
        expect(autosave.pausedReason).toBe("empty");
        expect(store.settings.rules).toHaveLength(1); // * editor state survives
        expect(store.dirty).toBe(true);
        expect(persistedRules()).toEqual([]);
    });

    it("ignores a disabled group with invalid/empty content (emergency switch, ADR 0038)", () => {
        reset();
        store.addSiteRule();
        store.addRule(0);
        store.settings.rules[0].siteRegex = INVALID_REGEX;
        store.settings.rules[0].rules[0] = { kind: "replace", regex: "", substitution: "" };
        store.settings.rules[0].disabled = true;

        schedule();
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

        expect(autosave.phase).toBe("idle");
        expect(autosave.pausedReason).toBeNull();
        expect(store.dirty).toBe(false);
        expect(persistedRules()).toHaveLength(1);
    });

    it("reports invalid before empty when both apply", () => {
        reset();
        store.addSiteRule();
        store.addRule(0);
        store.settings.rules[0].siteRegex = INVALID_REGEX; // * invalid gate …
        // * … AND the default empty replace rule (addRule) — invalid wins.

        schedule();
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
        expect(autosave.pausedReason).toBe("invalid");
    });

    it("pauses when the GM write fails and retries on the next change", () => {
        reset();
        makeValidChange();

        const gmSetValue = (globalThis as Record<string, unknown>).GM_setValue as (key: string, value: unknown) => void;
        (globalThis as Record<string, unknown>).GM_setValue = () => {
            throw new Error("quota exceeded");
        };
        try {
            schedule();
            vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

            expect(autosave.phase).toBe("paused");
            expect(autosave.pausedReason).toBe("write");
            expect(store.dirty).toBe(true);
            expect(persistedRules()).toEqual([]);
        } finally {
            (globalThis as Record<string, unknown>).GM_setValue = gmSetValue;
        }

        // * No automatic retry timer: the next change re-arms and succeeds.
        store.settings.rules[0].rules[0] = { kind: "replace", regex: "/old2/", substitution: "/new2/" };
        schedule();
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

        expect(autosave.phase).toBe("idle");
        expect(autosave.pausedReason).toBeNull();
        expect(store.dirty).toBe(false);
        expect(persistedRules()).toHaveLength(1);
    });

    it("recovers: fixing the row lets the next change persist", () => {
        reset();
        store.addSiteRule();
        store.addRule(0);
        store.settings.rules[0].siteRegex = "/host\\.test/";
        store.settings.rules[0].rules[0] = { kind: "replace", regex: "", substitution: "" };

        schedule();
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
        expect(autosave.phase).toBe("paused");

        // * the user completes the row → the next change re-arms the debounce.
        store.settings.rules[0].rules[0] = { kind: "replace", regex: "/a/", substitution: "b" };
        schedule();
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

        expect(autosave.phase).toBe("idle");
        expect(persistedRules()).toHaveLength(1);
    });
});

describe("flush + close save", () => {
    it("flush persists a valid pending change immediately", () => {
        reset();
        makeValidChange();
        schedule();

        flush();
        expect(store.dirty).toBe(false);
        expect(autosave.phase).toBe("idle");
    });

    it("flush stays paused on a gated state (close guard can still ask)", () => {
        reset();
        makeValidChange();
        store.settings.rules[0].rules[0] = { kind: "replace", regex: INVALID_REGEX, substitution: "x" };

        flush();
        expect(autosave.phase).toBe("paused");
        expect(autosave.pausedReason).toBe("invalid");
        expect(store.dirty).toBe(true);
        expect(persistedRules()).toEqual([]);
    });

    it("flush pauses on an incomplete row instead of pruning it", () => {
        reset();
        store.addSiteRule(); // * entirely empty — the gate pauses
        store.addSiteRule();
        store.settings.rules[1].siteRegex = "/keep\\.test/";
        store.addRule(1);
        store.settings.rules[1].rules[0] = { kind: "appendQuery", params: "a=1" };

        flush();

        expect(autosave.phase).toBe("paused");
        expect(autosave.pausedReason).toBe("empty");
        expect(store.dirty).toBe(true);
        expect(persistedRules()).toEqual([]);
    });

    it("clears a stale paused/conflict state when flushing a clean store", () => {
        reset();
        expect(store.dirty).toBe(false);
        autosave.phase = "paused";
        autosave.pausedReason = "invalid";
        autosave.remoteConflict = true;

        flush();

        expect(autosave.phase).toBe("idle");
        expect(autosave.pausedReason).toBeNull();
        expect(autosave.remoteConflict).toBe(false);
        expect(autosave.pendingDelayMs).toBe(0);
    });

    it("flush persists a valid close-time change immediately", () => {
        reset();
        makeValidChange();

        flush();

        expect(store.dirty).toBe(false);
        const persisted = persistedRules() as Array<{ siteRegex: string }>;
        expect(persisted.map((s) => s.siteRegex)).toEqual(["/a\\.test/"]);
    });

    it("flush reports false while paused and true after a successful persist", () => {
        reset();
        expect(flush()).toBe(true); // * clean path

        makeValidChange();
        store.settings.rules[0].rules[0] = { kind: "replace", regex: INVALID_REGEX, substitution: "x" };
        expect(flush()).toBe(false); // * receipt must not claim success
        expect(autosave.pausedReason).toBe("invalid");
        expect(store.dirty).toBe(true);

        store.settings.rules[0].rules[0] = { kind: "replace", regex: "/ok/", substitution: "x" };
        expect(flush()).toBe(true);
        expect(store.dirty).toBe(false);
        expect(persistedRules()).toHaveLength(1);
    });
});

describe("session snapshot (undo)", () => {
    it("restores the dashboard's opening state and persists it", () => {
        reset();
        makeValidChange();
        flush(); // * the session moved on — persisted even
        expect(persistedRules()).toHaveLength(1);

        restoreSnapshot();

        expect(store.replacementSource).toBe("undo");
        expect(store.settings.rules).toEqual([]); // * back to the boot state
        expect(store.dirty).toBe(false);
        expect(persistedRules()).toEqual([]);
    });

    it("stays undoable AFTER an autosave commit (clean ≠ snapshot)", () => {
        reset();
        expect(isSnapshotCurrent()).toBe(true); // * boot = snapshot

        makeValidChange();
        schedule();
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
        expect(store.dirty).toBe(false); // * committed …
        expect(isSnapshotCurrent()).toBe(false); // * … but the session ≠ boot state → undo available

        restoreSnapshot();
        expect(isSnapshotCurrent()).toBe(true);
    });
});

describe("remote settings sync (multi-dashboard)", () => {
    it("adopts a remote write while CLEAN (store reloads, stays clean)", () => {
        reset();
        const remote = { locale: "de", rules: [{ siteRegex: "/remote\\.test/", rules: [] }] };

        onRemoteSettingsChange(remote);

        expect(store.settings.locale).toBe("de");
        expect(store.settings.rules[0]?.siteRegex).toBe("/remote\\.test/");
        expect(store.replacementSource).toBe("external");
        expect(store.dirty).toBe(false); // * clean by construction — no ping-pong
        expect(autosave.remoteConflict).toBe(false);
    });

    it("raises the conflict hint while DIRTY (local wins, no adoption)", () => {
        reset();
        makeValidChange();

        onRemoteSettingsChange({ locale: "de", rules: [] });

        expect(autosave.remoteConflict).toBe(true);
        expect(store.settings.rules).toHaveLength(1); // * LOCAL state kept
        expect(store.dirty).toBe(true);
    });

    it("clears the conflict hint on the next local apply", () => {
        reset();
        makeValidChange();
        onRemoteSettingsChange({ locale: "de", rules: [] });
        expect(autosave.remoteConflict).toBe(true);

        flush();
        expect(autosave.remoteConflict).toBe(false);
    });
});
