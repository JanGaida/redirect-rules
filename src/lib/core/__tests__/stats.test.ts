import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStatsSink, emptyStats, normalizeStats, ruleHash, type Stats, type StatsSinkDeps } from "../stats";
import { installGmStubs, uninstallGmStubs } from "./gm-stubs";
import type { AppliedRule } from "../redirect-engine";

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Stats — hash identity, fail-soft normalization, throttled sink
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
    installGmStubs();
});

afterEach(() => {
    uninstallGmStubs();
});

describe("ruleHash", () => {
    it("is stable for the same site regex + rule", () => {
        const rule = { kind: "replace" as const, regex: "/a/", substitution: "b" };
        expect(ruleHash("/site/", rule)).toBe(ruleHash("/site/", rule));
    });

    it("differs across site groups (siteRegex is part of the key)", () => {
        const rule = { kind: "replace" as const, regex: "/a/", substitution: "b" };
        expect(ruleHash("/one.test/", rule)).not.toBe(ruleHash("/two.test/", rule));
    });

    it("differs when the rule content changes (counter reset on edit — documented)", () => {
        expect(ruleHash("/site/", { kind: "replace", regex: "/a/", substitution: "b" })).not.toBe(
            ruleHash("/site/", { kind: "replace", regex: "/a/", substitution: "c" }),
        );
    });

    it("collides only for identical rules within one group (documented)", () => {
        const one = ruleHash("/site/", { kind: "replace", regex: "/a/", substitution: "b" });
        const two = ruleHash("/site/", { kind: "replace", regex: "/a/", substitution: "b" });
        expect(one).toBe(two);
    });

    it("is independent of object key order and an omitted optional regex", () => {
        const imported = { params: "a=1", kind: "appendQuery" as const };
        const normalized = { kind: "appendQuery" as const, regex: "", params: "a=1" };
        expect(ruleHash("/site/", imported)).toBe(ruleHash("/site/", normalized));
    });

    it("has a distinct removeQuery tuple (keys and gate)", () => {
        const one = ruleHash("/site/", { kind: "removeQuery", keys: "utm_*" });
        const two = ruleHash("/site/", { kind: "removeQuery", keys: "fbclid" });
        const gated = ruleHash("/site/", { kind: "removeQuery", regex: "/x/", keys: "utm_*" });
        expect(one).not.toBe(two);
        expect(one).not.toBe(gated);
        expect(ruleHash("/site/", { kind: "removeQuery", regex: "", keys: "utm_*" })).toBe(one);
    });

    it("has a distinct unwrap tuple keyed by its regex", () => {
        const one = ruleHash("/site/", { kind: "unwrap", regex: "/u=([^&]+)/" });
        const two = ruleHash("/site/", { kind: "unwrap", regex: "/v=([^&]+)/" });
        expect(one).not.toBe(two);
        expect(one).not.toBe(ruleHash("/site/", { kind: "checkpoint", regex: "/u=([^&]+)/", mode: "stop" }));
    });
});

describe("normalizeStats", () => {
    it("round-trips a valid stats object", () => {
        const stats: Stats = {
            counts: { ab12: 3 },
            total: 3,
            last: { from: "https://a.test/", to: "https://b.test/", ts: 1234 },
        };
        expect(normalizeStats(stats)).toEqual(stats);
    });

    it("degrades garbage to empty stats", () => {
        expect(normalizeStats("corrupt")).toEqual(emptyStats());
        expect(normalizeStats(null)).toEqual(emptyStats());
    });

    it("drops invalid count entries and keeps the valid ones", () => {
        const out = normalizeStats({ counts: { ok: 2, broken: "x", neg: -1 }, total: "many" });
        expect(out.counts).toEqual({ ok: 2 });
        expect(out.total).toBe(0);
        expect(out.last).toBeNull();
    });
});

// * Fake deps — every write observable, the debounce manual (no timers).
function fakeDeps(initial: unknown = null): StatsSinkDeps & { writes: Stats[] } {
    const writes: Stats[] = [];
    let stored: unknown = initial;
    return {
        read: () => ({ ok: true, value: stored }),
        write: (stats) => {
            stored = stats;
            writes.push(stats);
            return true;
        },
        now: () => 10_000,
        writes,
    };
}

const applied = (siteRegex: string, rule: AppliedRule["rule"]): AppliedRule[] => [
    { siteRegex, rule, oldUrl: "https://a.test/", newUrl: "https://b.test/" },
];

describe("createStatsSink", () => {
    it("counts applied rules, totals, and last redirect in the snapshot", () => {
        const sink = createStatsSink(fakeDeps());
        sink.record(applied("/site/", { kind: "replace", regex: "/a/", substitution: "b" }), "from", "to");
        const snapshot = sink.snapshot();
        expect(snapshot.total).toBe(1);
        expect(snapshot.last).toEqual({ from: "from", to: "to", ts: 10_000 });
        expect(Object.values(snapshot.counts)[0]).toBe(1);
    });

    it("loads persisted stats lazily and merges into them", () => {
        const persisted: Stats = { counts: { existing: 5 }, total: 5, last: null };
        const sink = createStatsSink(fakeDeps(persisted));
        sink.record(applied("/site/", { kind: "replace", regex: "/a/", substitution: "b" }), "from", "to");
        expect(sink.snapshot().total).toBe(6);
    });

    it("writes storage immediately on record (eager persistence)", () => {
        const deps = fakeDeps();
        const sink = createStatsSink(deps);
        sink.record(applied("/site/", { kind: "replace", regex: "/a/", substitution: "b" }), "from", "to");
        expect(deps.writes).toHaveLength(1);
        expect(deps.writes[0].total).toBe(1);
        sink.flush();
        // * No pending delta after the successful write — flush must not rewrite.
        expect(deps.writes).toHaveLength(1);
    });

    it("merges the delta against fresh storage (stale snapshot cannot clobber)", () => {
        let stored: unknown = null;
        const writes: Stats[] = [];
        const deps: StatsSinkDeps = {
            read: () => ({ ok: true, value: stored }),
            write: (stats) => {
                stored = stats;
                writes.push(stats);
                return true;
            },
            now: () => 10_000,
        };
        const stale = createStatsSink(deps);
        stale.snapshot(); // * Loads the empty state before the other context writes.
        const other = createStatsSink(deps);
        other.record(applied("/site/", { kind: "replace", regex: "/a/", substitution: "b" }), "from", "to");
        stale.record(applied("/site/", { kind: "replace", regex: "/c/", substitution: "d" }), "from", "to");
        expect((stored as Stats).total).toBe(2);
        expect(writes.at(-1)?.total).toBe(2);
    });

    it("keeps the delta pending when the write fails and retries it on flush", () => {
        let stored: unknown = null;
        let fail = true;
        const deps: StatsSinkDeps = {
            read: () => ({ ok: true, value: stored }),
            write: (stats) => {
                if (fail) return false;
                stored = stats;
                return true;
            },
            now: () => 10_000,
        };
        const sink = createStatsSink(deps);
        sink.record(applied("/site/", { kind: "replace", regex: "/a/", substitution: "b" }), "from", "to");
        expect(sink.pendingDelta().total).toBe(1);
        expect(sink.flush()).toBe("failed");
        fail = false;
        expect(sink.flush()).toBe("persisted");
        expect((stored as Stats).total).toBe(1);
        expect(sink.pendingDelta().total).toBe(0);
    });

    it("keeps the delta and skips the write when the read fails", () => {
        let readOk = false;
        let stored: unknown = { counts: { existing: 5 }, total: 5, last: null };
        let writes = 0;
        const sink = createStatsSink({
            read: () => (readOk ? { ok: true, value: stored } : { ok: false, value: null }),
            write: (stats) => {
                stored = stats;
                writes += 1;
                return true;
            },
            now: () => 10_000,
        });

        sink.record(applied("/site/", { kind: "replace", regex: "/a/", substitution: "b" }), "from", "to");
        // * ! A failed read must NOT be merged into an empty base (would wipe storage).
        expect(writes).toBe(0);
        expect(sink.pendingDelta().total).toBe(1);

        readOk = true;
        expect(sink.flush()).toBe("persisted");
        expect(writes).toBe(1);
        expect((stored as Stats).total).toBe(6);
        expect((stored as Stats).counts.existing).toBe(5);
    });

    it("seeds pending from a recovered delta without seeding the snapshot", () => {
        const seed: Stats = { counts: { seed: 2 }, total: 2, last: null };
        const deps = fakeDeps({ counts: { existing: 5 }, total: 5, last: null });
        const sink = createStatsSink(deps, seed);

        expect(sink.pendingDelta()).toEqual(seed);
        // * Do not seed `current` — the stored snapshot stays the source of truth.
        expect(sink.snapshot().total).toBe(5);

        sink.record(applied("/site/", { kind: "replace", regex: "/a/", substitution: "b" }), "from", "to");
        expect(deps.writes.at(-1)?.total).toBe(8);
        expect(sink.pendingDelta().total).toBe(0);
    });

    it("never carries a seeded last record (URL-free seed)", () => {
        const seed: Stats = {
            counts: { seed: 1 },
            total: 1,
            last: { from: "https://a.test/", to: "https://b.test/", ts: 1 },
        };
        const sink = createStatsSink(fakeDeps(), seed);
        expect(sink.pendingDelta().last).toBeNull();
        expect(sink.pendingDelta().total).toBe(1);
    });

    it("skips the write on flush when nothing was ever recorded", () => {
        const deps = fakeDeps();
        const sink = createStatsSink(deps);
        expect(sink.flush()).toBe("idle");
        expect(deps.writes).toHaveLength(0);
    });

    it("prunes orphaned counters but keeps live ones", () => {
        const sink = createStatsSink(fakeDeps());
        const live = { kind: "replace" as const, regex: "/live/", substitution: "x" };
        const dead = { kind: "replace" as const, regex: "/dead/", substitution: "y" };
        sink.record(applied("/site/", live), "f", "t");
        sink.record(applied("/site/", dead), "f", "t");
        sink.prune([ruleHash("/site/", live)]);
        const counts = sink.snapshot().counts;
        expect(counts[ruleHash("/site/", live)]).toBe(1);
        expect(counts[ruleHash("/site/", dead)]).toBeUndefined();
        // * total + last stay untouched by pruning (only counts shrink).
        expect(sink.snapshot().total).toBe(2);
    });
});
