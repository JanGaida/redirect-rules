// ─────────────────────────────────────────────────────────────────────────────
// MARK: Stats — persisted redirect counters (per-rule, content-hash keyed)
// ─────────────────────────────────────────────────────────────────────────────
// * Counters live under a separate GM key (never exported); identity is the
//   content hash of siteRegex + rule (editing resets; duplicate rules collide).
// * Fail-soft: corrupt storage degrades to empty stats.
// * Eager DELTA persistence: each redirect writes only increments via
//   read-modify-write, so concurrent contexts never clobber newer counts.

import type { AppliedRule } from "./redirect-engine";
import type { UrlRule } from "./settings";
import { storageGetResult, storageSet, STORAGE_KEY_STATS } from "./storage";
import { createLogger } from "./log";

const log = createLogger("stats");

// ─── Shape + normalization ─────────────────────────────────────────────────────

/** The persisted stats object — exactly what lives under the "stats" GM key. */
export interface Stats {
    /** Applied-rule counter per {@link ruleHash} key. */
    counts: Record<string, number>;
    /** Total redirects issued (all-time, all rules). */
    total: number;
    /** The most recent redirect (null before the first one). */
    last: { from: string; to: string; ts: number } | null;
}

/** Returns empty stats — the fail-soft bottom for corrupt storage. */
export function emptyStats(): Stats {
    return { counts: {}, total: 0, last: null };
}

/**
 * Normalizes an unknown (possibly corrupt) stored value into `Stats` — never throws.
 *
 * @param raw - Whatever was stored under the stats GM key.
 */
export function normalizeStats(raw: unknown): Stats {
    if (typeof raw !== "object" || raw === null) {
        if (raw !== null && raw !== undefined) {
            log.warn("stored stats are not an object — starting empty", { type: typeof raw });
        }
        return emptyStats();
    }
    const record = raw as Record<string, unknown>;
    const result = emptyStats();
    let dropped = 0;
    if (typeof record.total === "number" && Number.isFinite(record.total) && record.total >= 0) {
        result.total = record.total;
    } else if (record.total !== undefined) {
        dropped += 1;
    }
    if (typeof record.counts === "object" && record.counts !== null) {
        for (const [hash, count] of Object.entries(record.counts)) {
            if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
                result.counts[hash] = count;
            } else {
                dropped += 1;
            }
        }
    } else if (record.counts !== undefined) {
        dropped += 1;
    }
    if (typeof record.last === "object" && record.last !== null) {
        const last = record.last as Record<string, unknown>;
        if (typeof last.from === "string" && typeof last.to === "string" && typeof last.ts === "number") {
            result.last = { from: last.from, to: last.to, ts: last.ts };
        } else {
            dropped += 1;
        }
    } else if (record.last !== undefined && record.last !== null) {
        dropped += 1;
    }
    if (dropped > 0) log.debug("stats fields dropped during normalization", { dropped });
    return result;
}

/**
 * Merges a stats delta into a base snapshot (counts add, latest `last` wins).
 *
 * @param base  - The persisted state (or an empty snapshot).
 * @param delta - Increments recorded since the base was read.
 * @returns A new merged object (inputs are never mutated).
 */
export function mergeStats(base: Stats, delta: Stats): Stats {
    const counts = { ...base.counts };
    for (const [hash, count] of Object.entries(delta.counts)) {
        counts[hash] = (counts[hash] ?? 0) + count;
    }
    const last = delta.last !== null && (base.last === null || delta.last.ts >= base.last.ts) ? delta.last : base.last;
    return { counts, total: base.total + delta.total, last };
}

/** Whether a delta carries anything worth persisting. */
function hasDelta(delta: Stats, removed: ReadonlySet<string>): boolean {
    return delta.total > 0 || Object.keys(delta.counts).length > 0 || delta.last !== null || removed.size > 0;
}

// ─── Identity — the rule content hash ──────────────────────────────────────────

/**
 * Stable content hash for one rule within a site group (djb2, hex string).
 *
 * The siteRegex is part of the key so identical rules in DIFFERENT groups get
 * distinct counters. The rule is reduced to a kind-specific tuple, so object
 * key order and an omitted optional `regex` cannot change the identity.
 *
 * @param siteRegex - The owning site group's gate.
 * @param rule      - The applied rule.
 */
export function ruleHash(siteRegex: string, rule: UrlRule): string {
    const parts =
        rule.kind === "replace"
            ? ["replace", rule.regex, rule.substitution]
            : rule.kind === "appendQuery"
              ? ["appendQuery", rule.regex ?? "", rule.params]
              : rule.kind === "removeQuery"
                ? ["removeQuery", rule.regex ?? "", rule.keys]
                : rule.kind === "unwrap"
                  ? ["unwrap", rule.regex]
                  : ["checkpoint", rule.regex, rule.mode];
    const key = `${siteRegex}\u0000${JSON.stringify(parts)}`;
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
}

// ─── Sink — in-memory counters + delta persistence ─────────────────────────────

/** Guarded read of persisted stats — `ok: false` means the read threw. */
export interface StatsReadResult {
    ok: boolean;
    value: unknown;
}

/** Outcome of a flush attempt — callers may clear a stash only on "persisted". */
export type StatsFlushResult = "idle" | "persisted" | "failed";

/** Side-effect surface the sink needs — injectable for tests. */
export interface StatsSinkDeps {
    /** Reads the persisted stats (raw, unknown — normalized fail-soft). */
    read(): StatsReadResult;
    /** Persists merged stats; false means the write failed and must be retried. */
    write(stats: Stats): boolean;
    /** Current time in ms epoch (for the `last` redirect record). */
    now(): number;
}

/** The recording surface the watcher calls after an issued redirect. */
export interface StatsSink {
    /** Counts every applied rule of one redirect (from → to) and persists eagerly. */
    record(applied: AppliedRule[], from: string, to: string): void;
    /** Retries the pending delta (dashboard open/close, beforeunload). */
    flush(): StatsFlushResult;
    /** The current in-memory stats (dashboard rendering). */
    snapshot(): Stats;
    /** The unpersisted delta — `window.name` fallback for a failed GM write. */
    pendingDelta(): Stats;
    /** Drops count entries for hashes not in `keep` (edited/deleted rules). */
    prune(keep: Iterable<string>): void;
    /** Subscribe to in-memory stats changes. Returns an unsubscribe function. */
    subscribe(listener: (stats: Stats) => void): () => void;
}

/**
 * Creates the stats sink — in-memory counters over GM storage.
 *
 * * Every record persists eagerly, but only as a DELTA against a fresh read
 *   (read-modify-write). A stale in-memory snapshot can therefore never
 *   overwrite counters recorded by another context.
 * * A failed write keeps the delta pending; `flush` retries it and the watcher
 *   stashes it in `window.name` for the next document boot.
 * * The sink loads persisted stats lazily, so boot costs nothing when no
 *   redirect ever happens.
 *
 * @param deps - Read/write/clock surface (injectable for tests).
 * @param seed - Un-drained delta recovered from `window.name` at boot; cloned
 *               into `pending` (counts/total, `last` stays null) until a
 *               successful persist. Never seeds `current` (no double count).
 */
export function createStatsSink(deps: StatsSinkDeps, seed?: Stats): StatsSink {
    let current: Stats | null = null;
    let pending: Stats =
        seed === undefined ? emptyStats() : { counts: { ...seed.counts }, total: seed.total, last: null };
    const removedHashes = new Set<string>();
    const subscribers = new Set<(stats: Stats) => void>();

    const load = (): Stats => {
        if (current === null) {
            const read = deps.read();
            current = read.ok ? normalizeStats(read.value) : emptyStats();
            if (!read.ok) log.warn("stats read failed — rendering an empty in-memory snapshot");
            log.debug("stats loaded", { total: current.total, counters: Object.keys(current.counts).length });
        }
        return current;
    };

    const notify = (): void => {
        if (current === null) return;
        for (const listener of subscribers) listener(current);
    };

    const persist = (): StatsFlushResult => {
        if (!hasDelta(pending, removedHashes)) return "idle";
        // * ! A failed read is NOT empty storage: writing merged(pending, empty)
        //   would drop every stored counter. Keep the delta for a later retry.
        const read = deps.read();
        if (!read.ok) {
            log.warn("stats read failed — keeping delta for retry");
            return "failed";
        }
        const stored = normalizeStats(read.value);
        const merged = mergeStats(stored, pending);
        for (const hash of removedHashes) delete merged.counts[hash];
        if (!deps.write(merged)) {
            log.warn("stats write failed — keeping delta for retry");
            return "failed";
        }
        // * Keep `current` as an independent clone: test/stub deps may store the
        //   written object by reference (GM storage serializes, fakes may not).
        current = normalizeStats(merged);
        pending = emptyStats();
        removedHashes.clear();
        log.debug("stats persisted", { total: merged.total });
        return "persisted";
    };

    return {
        record(applied, from, to): void {
            const stats = load();
            for (const entry of applied) {
                const hash = ruleHash(entry.siteRegex, entry.rule);
                stats.counts[hash] = (stats.counts[hash] ?? 0) + 1;
                pending.counts[hash] = (pending.counts[hash] ?? 0) + 1;
            }
            stats.total += 1;
            pending.total += 1;
            const last = { from, to, ts: deps.now() };
            stats.last = last;
            pending.last = last;
            persist();
            notify();
            log.debug("redirect recorded", { from, to, rules: applied.length });
        },
        flush(): StatsFlushResult {
            log.debug("flush requested", {
                pendingTotal: pending.total,
                pendingCounters: Object.keys(pending.counts).length,
                removed: removedHashes.size,
            });
            const result = persist();
            notify();
            return result;
        },
        snapshot(): Stats {
            return load();
        },
        pendingDelta(): Stats {
            return { counts: { ...pending.counts }, total: pending.total, last: pending.last };
        },
        prune(keep: Iterable<string>): void {
            const stats = load();
            const keepSet = new Set(keep);
            let removed = 0;
            for (const hash of Object.keys(stats.counts)) {
                if (!keepSet.has(hash)) {
                    delete stats.counts[hash];
                    removedHashes.add(hash);
                    removed += 1;
                }
            }
            if (removed > 0) {
                persist();
                notify();
            }
            log.debug("orphaned counters pruned", { removed });
        },
        subscribe(listener): () => void {
            load();
            subscribers.add(listener);
            log.debug("subscriber added", { subscribers: subscribers.size });
            listener(current as Stats);
            return () => {
                subscribers.delete(listener);
                log.debug("subscriber removed", { subscribers: subscribers.size });
            };
        },
    };
}

/**
 * The production sink — GM storage, eager delta writes.
 *
 * `beforeunload` wiring is the CONSUMER's concern (dashboard.ts adds it to the
 * dashboard window; main.ts to the opener window).
 */
export function createGmStatsSink(seed?: Stats): StatsSink {
    return createStatsSink(
        {
            read: () => storageGetResult<unknown>(STORAGE_KEY_STATS, null),
            write: (stats) => storageSet(STORAGE_KEY_STATS, stats),
            now: () => Date.now(),
        },
        seed,
    );
}

// ─── Shared sink — one instance per userscript context ──────────────────────────

/** The shared production sink — created lazily, reused by boot + dashboard. */
let sharedSink: StatsSink | null = null;

/**
 * Returns THE stats sink (module singleton) — main.ts wires it into the
 * watcher, dashboard.ts flushes/prunes it, the system tab renders it.
 *
 * @param seed - Un-drained delta recovered at boot; used only when the
 *               singleton is created (later callers share the same sink).
 */
export function getStatsSink(seed?: Stats): StatsSink {
    if (sharedSink === null) sharedSink = createGmStatsSink(seed);
    return sharedSink;
}
