// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
    browserRuntime,
    createWatcher,
    installSpaHook,
    LOOP_WINDOW_MS,
    type LoopEntry,
    type WatcherRuntime,
} from "../watcher";
import { compileRules } from "../redirect-engine";
import type { SiteRule } from "../settings";

/**
 * Fake runtime — captures navigation + owns an in-memory loop history + a
 * controllable clock. jsdom provides window/history (pushState patch test);
 * jsdom's location.replace is NOT implemented, so the runtime never touches the
 * real location API. `available = false` simulates a storage-less environment
 * (guard off = legacy behavior).
 */
function makeRuntime(initialUrl: string, options: { available?: boolean } = {}) {
    const state = {
        url: initialUrl,
        replaced: [] as string[],
        history: null as LoopEntry[] | null,
        now: 10_000,
    };
    const runtime: WatcherRuntime = {
        getLocation: () => state.url,
        replace: (url) => {
            state.replaced.push(url);
            state.url = url;
        },
        readLoopHistory: () => (options.available === false ? null : (state.history ?? [])),
        writeLoopHistory: (entries) => {
            state.history = entries;
        },
        clearLoopHistory: () => {
            state.history = [];
        },
        now: () => state.now,
    };
    return { state, runtime };
}

/** Legacy loop entry (pre-hash) — the guard hashes `source` on read. */
function legacyEntry(source: string, ts: number): LoopEntry {
    return { source, ts } as LoopEntry;
}

/** A rule set that rewrites /old-path/ → /new-path/ on x.test. */
const REWRITE_RULES: SiteRule[] = [
    {
        siteRegex: "/x\\.test/",
        rules: [{ kind: "replace", regex: "/\\/old-path\\//", substitution: "/new-path/" }],
    },
];

describe("createWatcher — redirect on change", () => {
    it("redirects when a rule rewrites the url and records the source history", () => {
        const { state, runtime } = makeRuntime("https://x.test/old-path/page");
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime);

        expect(watcher.run()).toBe(true);
        expect(state.replaced).toEqual(["https://x.test/new-path/page"]);
        expect(state.history).toHaveLength(1);
        expect(state.history?.[0].key).toMatch(/^[0-9a-f]{16}$/);
        expect(state.history?.[0].ts).toBe(state.now);
        expect(state.history?.[0]).not.toHaveProperty("source");
    });

    it("does nothing when no rule matches", () => {
        const { state, runtime } = makeRuntime("https://other.test/old-path/page");
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime);

        expect(watcher.run()).toBe(false);
        expect(state.replaced).toEqual([]);
        expect(state.history).toBeNull();
    });

    it("accepts an explicit url argument (urlchange listener contract)", () => {
        const { state, runtime } = makeRuntime("https://x.test/unrelated");
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime);

        expect(watcher.run("https://x.test/old-path/here")).toBe(true);
        expect(state.replaced).toEqual(["https://x.test/new-path/here"]);
    });

    it("proceeds without a guard when the storage is unavailable (legacy behavior)", () => {
        const { state, runtime } = makeRuntime("https://x.test/old-path/page", { available: false });
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime);

        expect(watcher.run()).toBe(true);
        expect(state.replaced).toHaveLength(1);
    });
});

describe("createWatcher — loop guard", () => {
    it("blocks a redirect when the current url is a recent source (return within window)", () => {
        const { state, runtime } = makeRuntime("https://x.test/old-path/page");
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime);

        // * Simulate the oscillation point: the history says we already
        //   redirected away from THIS url moments ago.
        state.history = [legacyEntry(state.url, state.now - 100)];

        expect(watcher.run()).toBe(false);
        expect(state.replaced).toEqual([]);
        // * The history is cleared so a later legitimate navigation works again.
        expect(state.history).toEqual([]);
    });

    it("blocks 2-cycle oscillations (A→B→A) — the single-marker blind spot", () => {
        const { state, runtime } = makeRuntime("https://x.test/old-path/page");
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime);

        // * A→B happened from THIS url, and B came back through a redirect — the
        //   history holds BOTH sources. A single last-source marker would hold
        //   only the OTHER page at this point and miss the cycle entirely.
        state.history = [
            legacyEntry(state.url, state.now - 200),
            legacyEntry("https://x.test/new-path/page", state.now - 100),
        ];

        expect(watcher.run()).toBe(false);
        expect(state.replaced).toEqual([]);
        expect(state.history).toEqual([]);
    });

    it("allows the redirect when the history entries are older than the window", () => {
        const { state, runtime } = makeRuntime("https://x.test/old-path/page");
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime);

        state.history = [legacyEntry(state.url, state.now - LOOP_WINDOW_MS - 1)];

        expect(watcher.run()).toBe(true);
        expect(state.replaced).toHaveLength(1);
    });

    it("blocks equivalent URLs that differ only by default-port/case normalization", () => {
        const { state, runtime } = makeRuntime("https://x.test/old-path/page");
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime);

        state.history = [legacyEntry("https://X.TEST:443/old-path/page", state.now - 100)];

        expect(watcher.run()).toBe(false);
        expect(state.replaced).toEqual([]);
    });

    it("allows legit chains — a history of DIFFERENT sources never blocks", () => {
        const { state, runtime } = makeRuntime("https://x.test/old-path/page");
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime);

        // * A→B just happened (source: a.test); we are now at x.test — allowed.
        state.history = [legacyEntry("https://a.test/", state.now)];

        expect(watcher.run()).toBe(true);
        expect(state.replaced).toHaveLength(1);
        expect(state.history?.at(-1)?.key).toMatch(/^[0-9a-f]{16}$/);
        expect(state.history?.at(-1)).not.toHaveProperty("source");
    });

    it("caps the history at LOOP_HISTORY_CAP entries", () => {
        const { state, runtime } = makeRuntime("https://x.test/old-path/page");
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime);

        state.history = Array.from({ length: 12 }, (_, i) => legacyEntry(`https://x.test/src-${i}`, state.now - 100));

        expect(watcher.run()).toBe(true);
        expect(state.history).toHaveLength(10);
        expect(state.history?.at(-1)?.key).toMatch(/^[0-9a-f]{16}$/);
        expect(state.history?.at(-1)).not.toHaveProperty("source");
    });
});

describe("browserRuntime — window.name loop state", () => {
    it("round-trips keyed history through window.name and self-heals foreign content", () => {
        const runtime = browserRuntime();

        // * Foreign window.name content (another script's data) → reads as empty.
        window.name = "someone-elses-string";
        expect(runtime.readLoopHistory()).toEqual([]);

        const entries: LoopEntry[] = [{ key: "0123456789abcdef", ts: 123 }];
        runtime.writeLoopHistory(entries);
        expect(runtime.readLoopHistory()).toEqual(entries);
        expect(JSON.parse(window.name)).toEqual({ rrLoop: entries });

        runtime.clearLoopHistory();
        expect(runtime.readLoopHistory()).toEqual([]);

        window.name = "";
    });

    it("migrates a legacy source entry to a hash and removes the raw URL", () => {
        const runtime = browserRuntime();
        window.name = JSON.stringify({ rrLoop: [{ source: "https://x.test/a?token=secret", ts: 123 }] });

        const history = runtime.readLoopHistory() ?? [];

        expect(history).toHaveLength(1);
        expect(history[0].key).toMatch(/^[0-9a-f]{16}$/);
        expect(history[0]).not.toHaveProperty("source");
        expect(history[0].ts).toBe(123);
        expect(window.name).not.toContain("token=secret");
        expect(JSON.parse(window.name)).toEqual({ rrLoop: history });

        window.name = "";
    });

    it("writes only hashed loop keys to window.name after a redirect", () => {
        window.name = JSON.stringify({ foreign: true });
        const base = browserRuntime();
        const runtime: WatcherRuntime = {
            ...base,
            getLocation: () => "https://x.test/old-path/page",
            replace: () => {},
        };
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime);

        expect(watcher.run()).toBe(true);

        const state = JSON.parse(window.name) as { rrLoop?: LoopEntry[]; foreign?: boolean };
        expect(state.foreign).toBe(true);
        expect(state.rrLoop).toHaveLength(1);
        expect(state.rrLoop?.[0].key).toMatch(/^[0-9a-f]{16}$/);
        expect(state.rrLoop?.[0]).not.toHaveProperty("source");
        expect(window.name).not.toContain("old-path");

        window.name = "";
    });
});

describe("installSpaHook — pushState triggers a re-run", () => {
    it("re-runs the watcher on history.pushState via the urlchange event", () => {
        const { state, runtime } = makeRuntime(window.location.href);
        const watcher = createWatcher(
            compileRules([
                {
                    siteRegex: "/localhost/",
                    rules: [{ kind: "replace", regex: "/\\/spa-old\\//", substitution: "/spa-new/" }],
                },
            ]),
            runtime,
        );
        installSpaHook(watcher);

        history.pushState({}, "", "/spa-old/entry");
        // * The patched pushState dispatches urlchange; the hook calls
        //   run(location.href) — the fake runtime's getLocation reads the REAL
        //   jsdom location (vitest serves jsdom at http://localhost:3000), so
        //   this proves the listener wiring end to end.
        expect(state.replaced).toEqual(["http://localhost:3000/spa-new/entry"]);

        watcher.dispose();
    });

    it("dispose removes the SPA listeners it installed", () => {
        const { state, runtime } = makeRuntime(window.location.href);
        const watcher = createWatcher(
            compileRules([
                {
                    siteRegex: "/localhost/",
                    rules: [{ kind: "replace", regex: "/\\/spa-old\\//", substitution: "/spa-new/" }],
                },
            ]),
            runtime,
        );
        installSpaHook(watcher);
        watcher.dispose();

        history.pushState({}, "", "/spa-old/after-dispose");
        expect(state.replaced).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Stats sink integration — redirects are counted, aborts are not
// ─────────────────────────────────────────────────────────────────────────────

describe("createWatcher — stats sink", () => {
    /** Recording fake — captures every record() call. */
    function makeSink() {
        const calls: { applied: unknown[]; from: string; to: string }[] = [];
        return {
            calls,
            sink: {
                record: (applied: unknown[], from: string, to: string) => calls.push({ applied, from, to }),
                flush: () => "idle" as const,
                snapshot: () => ({ counts: {}, total: 0, last: null }),
                pendingDelta: () => ({ counts: {}, total: 0, last: null }),
                prune: (_keep: Iterable<string>) => {},
                subscribe: () => () => {},
            },
        };
    }

    it("records applied rules after an issued redirect", () => {
        const { state, runtime } = makeRuntime("https://x.test/old-path/page");
        const { calls, sink } = makeSink();
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime, sink);

        expect(watcher.run()).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0].from).toBe("https://x.test/old-path/page");
        expect(calls[0].to).toBe("https://x.test/new-path/page");
        expect(state.replaced).toHaveLength(1);
    });

    it("records NOTHING on a loop-guard abort (would-apply is not a redirect)", () => {
        const { state, runtime } = makeRuntime("https://x.test/old-path/page");
        const { calls, sink } = makeSink();
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime, sink);

        state.history = [legacyEntry(state.url, state.now - 100)];
        expect(watcher.run()).toBe(false);
        expect(calls).toHaveLength(0);
        expect(state.replaced).toEqual([]);
    });

    it("records nothing when no rule matches", () => {
        const { runtime } = makeRuntime("https://other.test/old-path/page");
        const { calls, sink } = makeSink();
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime, sink);

        expect(watcher.run()).toBe(false);
        expect(calls).toHaveLength(0);
    });

    it("works without a sink (production pre-stats shape stays valid)", () => {
        const { state, runtime } = makeRuntime("https://x.test/old-path/page");
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime);
        expect(watcher.run()).toBe(true);
        expect(state.replaced).toHaveLength(1);
    });

    it("stashes the stats delta without raw from/to URLs (last is never stashed)", () => {
        window.name = "";
        const { runtime } = makeRuntime("https://x.test/old-path/page");
        const delta = {
            counts: { hash: 1 },
            total: 1,
            last: { from: "https://a.test/?token=secret", to: "https://b.test/", ts: 1 },
        };
        const sink = {
            record: () => {},
            flush: () => "idle" as const,
            snapshot: () => ({ counts: {}, total: 0, last: null }),
            pendingDelta: () => delta,
            prune: () => {},
            subscribe: () => () => {},
        };
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime, sink);

        expect(watcher.run()).toBe(true);
        const state = JSON.parse(window.name) as { rrStatsDelta?: { last: unknown } };
        expect(state.rrStatsDelta).toEqual({ counts: { hash: 1 }, total: 1, last: null });
        expect(window.name).not.toContain("token=secret");
        window.name = "";
    });

    it("rejects an array window.name payload instead of silently losing the stash", () => {
        window.name = JSON.stringify(["foreign"]);
        const { runtime } = makeRuntime("https://x.test/old-path/page");
        const delta = { counts: { hash: 1 }, total: 1, last: null };
        const sink = {
            record: () => {},
            flush: () => "idle" as const,
            snapshot: () => ({ counts: {}, total: 0, last: null }),
            pendingDelta: () => delta,
            prune: () => {},
            subscribe: () => () => {},
        };
        const watcher = createWatcher(compileRules(REWRITE_RULES), runtime, sink);

        expect(watcher.run()).toBe(true);
        const parsed: unknown = JSON.parse(window.name);
        expect(Array.isArray(parsed)).toBe(false);
        expect((parsed as { rrStatsDelta?: unknown }).rrStatsDelta).toEqual(delta);
        window.name = "";
    });
});
