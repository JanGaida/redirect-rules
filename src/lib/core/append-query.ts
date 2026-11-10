// ─────────────────────────────────────────────────────────────────────────────
// MARK: Query surgery — appendQuery / removeQuery
// ─────────────────────────────────────────────────────────────────────────────
// * Dedicated query-parameter surgery (ADR 0002) — replaces the legacy
//   substitution magic that appended after the fragment.
// * ! Pure string surgery: no `new URL()` (malformed corpus strings), raw
//   encodings are never re-encoded.
// * ! Key matching uses `paramKeySurface` (decode-normalized); edits stay raw.
//   Compare-only normalization prevents duplicate keys (fuq.com loop).
// * removeQuery patterns: exact keys plus a trailing-`*` prefix wildcard; ALL
//   matching pairs are removed (duplicates included).

import { createLogger } from "./log";

const log = createLogger("append-query");
import { paramKeySurface } from "./decode-surface";

/** A parsed parameter pair from the `params` string (`k=v&k2=v2`). */
interface ParamPair {
    key: string;
    value: string;
}

/** An existing query segment, kept raw so untouched pairs rebuild verbatim. */
interface ExistingPair {
    key: string;
    /** The original `key=value` segment exactly as authored in the URL. */
    raw: string;
}

/**
 * Parses a params string (`"k=v&k2=v2"`) into pairs.
 *
 * Segments without `=`, empty keys, and empty segments are SKIPPED (logged at
 * debug) — a half-authored params string must not corrupt the URL.
 *
 * @param params - The raw params string from an `appendQuery` rule.
 */
function parseParams(params: string): ParamPair[] {
    const pairs: ParamPair[] = [];
    for (const segment of params.split("&")) {
        if (segment === "") continue;
        const eq = segment.indexOf("=");
        if (eq < 0) {
            log.debug("skipping params segment without '='", { segment });
            continue;
        }
        const key = segment.slice(0, eq);
        if (key === "") {
            log.debug("skipping params segment with empty key", { segment });
            continue;
        }
        pairs.push({ key, value: segment.slice(eq + 1) });
    }
    return pairs;
}

/** Escapes a literal `#` so it cannot start a fragment mid-pair. */
function escapeHash(part: string): string {
    return part.replace(/#/g, "%23");
}

/**
 * Appends/overwrites query parameters on a URL — fragment-safe, encoding-preserving.
 *
 * Semantics (pinned by `append-query.test.ts` + the ported legacy corpus):
 * 1. The URL splits at the FIRST `#` (fragment) and then the FIRST `?` (query).
 * 2. Each new pair: when the key already exists in the query (compared through
 *    `paramKeySurface` — escape-decoded, `+` as space), its value is
 *    OVERWRITTEN in place (position preserved, the AUTHORED pair's form is
 *    written); otherwise the pair is appended raw as authored.
 * 3. Separator: `?` when the URL has no query yet, `&` otherwise.
 * 4. The fragment is never touched; params are inserted BEFORE the `#`.
 * 5. Existing pairs are rebuilt verbatim — no re-encoding (`+` stays `+`).
 * 6. A params string yielding no valid pairs returns the URL unchanged.
 *
 * @param url    - The current URL (any string — no URL-object validation).
 * @param params - Params in `k=v&k2=v2` form.
 * @returns The rewritten URL.
 */
export function appendQueryParams(url: string, params: string): string {
    const newPairs = parseParams(params);
    if (newPairs.length === 0) return url;

    // * 1. Fragment split (first `#`) — everything after it is untouchable.
    const hashIdx = url.indexOf("#");
    const beforeFragment = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
    const fragment = hashIdx >= 0 ? url.slice(hashIdx) : "";

    // * 2. Query split (first `?`) — `query === null` means "no ? present".
    const qIdx = beforeFragment.indexOf("?");
    const base = qIdx >= 0 ? beforeFragment.slice(0, qIdx) : beforeFragment;
    const query = qIdx >= 0 ? beforeFragment.slice(qIdx + 1) : null;

    // * 3. Existing pairs — raw segments preserved, keys parsed for matching.
    const pairs: ExistingPair[] = [];
    if (query !== null && query !== "") {
        for (const segment of query.split("&")) {
            if (segment === "") continue;
            const eq = segment.indexOf("=");
            const key = eq >= 0 ? segment.slice(0, eq) : segment;
            pairs.push({ key, raw: segment });
        }
    }

    // * 4. Apply: overwrite in place on decoded-key match, else append.
    // * ! `#` is the one structurally unsafe character — escape it at serialize
    //   time; the pair object keeps the unescaped key for matching.
    for (const { key, value } of newPairs) {
        const existing = pairs.find((p) => paramKeySurface(p.key) === paramKeySurface(key));
        const raw = `${escapeHash(key)}=${escapeHash(value)}`;
        if (existing) {
            existing.raw = raw;
        } else {
            pairs.push({ key, raw });
        }
    }

    // * 5. Rebuild — the separator is always `?` (the query is rebuilt from pairs).
    return `${base}?${pairs.map((p) => p.raw).join("&")}${fragment}`;
}

// ─── removeQuery — key-based removal ──────────────────────────────────────────

/** One authored key pattern: an exact key or a trailing-`*` prefix wildcard. */
interface KeyPattern {
    exact: string | null;
    prefix: string | null;
}

/**
 * Parses a `keys` string (`"utm_*&fbclid"`) into exact/prefix patterns.
 *
 * @param keys - The raw `keys` string from a `removeQuery` rule.
 */
function parseKeyPatterns(keys: string): KeyPattern[] {
    const patterns: KeyPattern[] = [];
    for (const segment of keys.split("&")) {
        const key = segment.trim();
        if (key === "") continue;
        if (key.endsWith("*")) patterns.push({ exact: null, prefix: key.slice(0, -1) });
        else patterns.push({ exact: key, prefix: null });
    }
    return patterns;
}

/** Whether a decode-normalized key surface matches one authored pattern. */
function keyMatches(surface: string, pattern: KeyPattern): boolean {
    return pattern.exact !== null ? surface === pattern.exact : surface.startsWith(pattern.prefix ?? "");
}

/**
 * Removes query parameters by key — fragment-safe, encoding-preserving.
 *
 * Semantics:
 * 1. Patterns are exact keys or trailing-`*` prefix wildcards (`utm_*`); `*` alone
 *    matches every key (clears the query).
 * 2. Key MATCHING is decode-normalized (`paramKeySurface`) — the same surface as
 *    `appendQueryParams`.
 * 3. ALL matching pairs are removed, duplicates included; unmatched pairs are
 *    rebuilt verbatim.
 * 4. The fragment is never touched. When the query becomes empty the `?` is
 *    dropped; when NOTHING matched, the url is returned unchanged.
 * 5. No `new URL()`, no re-encoding.
 *
 * @param url  - The current URL (any string — no URL-object validation).
 * @param keys - `&`-separated key patterns; a trailing `*` is a prefix wildcard.
 * @returns The rewritten URL (identical to the input when nothing matched).
 */
export function removeQueryParams(url: string, keys: string): string {
    const patterns = parseKeyPatterns(keys);
    if (patterns.length === 0) return url;

    const hashIdx = url.indexOf("#");
    const beforeFragment = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
    const fragment = hashIdx >= 0 ? url.slice(hashIdx) : "";

    const qIdx = beforeFragment.indexOf("?");
    if (qIdx < 0) return url;
    const base = beforeFragment.slice(0, qIdx);
    const query = beforeFragment.slice(qIdx + 1);
    if (query === "") return url;

    const kept: string[] = [];
    let removed = false;
    for (const segment of query.split("&")) {
        if (segment === "") continue;
        const eq = segment.indexOf("=");
        const key = eq >= 0 ? segment.slice(0, eq) : segment;
        if (patterns.some((pattern) => keyMatches(paramKeySurface(key), pattern))) {
            removed = true;
            continue;
        }
        kept.push(segment);
    }

    if (!removed) return url;
    if (kept.length === 0) return `${base}${fragment}`;
    return `${base}?${kept.join("&")}${fragment}`;
}
