// ─────────────────────────────────────────────────────────────────────────────
// MARK: Decode surface — matching-level percent-decode (URL strings stay raw)
// ─────────────────────────────────────────────────────────────────────────────
// * Motivation: pages deliver percent-encoded query keys; raw-authored gates
//   must still match them (fuq.com loop).
// * Semantics: match the decode-normalized surface, edit the raw string.
// * Escape runs decode together (UTF-8); invalid bytes stay raw.
// * `+` is form-space only in query/keys; raw `+` becomes space BEFORE decoding,
//   so `%2B` stays a literal plus.

/** One or more consecutive `%XX` escapes (raw `%`-text elsewhere stays raw). */
const ESCAPE_RUN_RE = /(?:%[0-9A-Fa-f]{2})+/g;

/** Maximum UTF-8 sequence length in escapes (4 bytes × 3 chars). */
const MAX_ESCAPE_RUN = 12;

/**
 * Decodes a run of `%XX` escapes — the longest valid prefix wins.
 *
 * Whole-run decoding keeps multibyte characters intact. When the run contains
 * an invalid byte (`%FF`), progressively shorter prefixes are attempted so the
 * valid parts still decode and only the broken escapes stay raw.
 *
 * @param run - A string made only of consecutive `%XX` escapes.
 */
function decodeEscapeRun(run: string): string {
    let out = "";
    let position = 0;
    while (position < run.length) {
        let matched = false;
        for (let length = Math.min(MAX_ESCAPE_RUN, run.length - position); length >= 3; length -= 3) {
            try {
                out += decodeURIComponent(run.slice(position, position + length));
                position += length;
                matched = true;
                break;
            } catch {
                // * Try the next shorter prefix.
            }
        }
        if (!matched) {
            out += run.slice(position, position + 3);
            position += 3;
        }
    }
    return out;
}

/**
 * Decodes every `%XX` escape — invalid escapes stay raw.
 *
 * @param s - The raw string (typically a url or a param key).
 */
function decodeEscapes(s: string): string {
    return s.replace(ESCAPE_RUN_RE, decodeEscapeRun);
}

/**
 * Matching surface for a param KEY — escapes decoded, `+` read as space.
 *
 * Used by `appendQueryParams` key matching so `filter[quality]` (authored) and
 * `filter%5Bquality%5D` (delivered) collide as the same key — overwrite instead
 * of duplicate. Raw segments are never rewritten through this; it is compare-only.
 *
 * @param key - A raw param key as authored in the params string or the url.
 */
export function paramKeySurface(key: string): string {
    // * Raw `+` is form-space; `%2B` decodes to a literal plus afterwards.
    return decodeEscapes(key.replace(/\+/g, " "));
}

/**
 * Matching surface for a URL — the QUERY component's escapes decoded.
 *
 * Scope: the text between the FIRST `?` (before the FIRST `#`) and the first
 * `#`/end — exactly the range `appendQueryParams` edits. Path and fragment stay
 * raw verbatim: `+` and percent-escapes there keep their literal meaning.
 * Gates authored raw (`filter[quality]=`, `filter[duration]=`, a literal " ")
 * therefore match both the raw form (`filter[quality]=`) and the delivered
 * encoded form (`filter%5Bquality%5D=`, `%20`, `+`).
 *
 * @param url - The current URL (any string — no `new URL()`).
 * @returns The url with the query component's escapes decoded (fragment intact).
 */
export function querySurface(url: string): string {
    const hashIdx = url.indexOf("#");
    const beforeFragment = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
    const qIdx = beforeFragment.indexOf("?");
    if (qIdx < 0) return url;
    const base = beforeFragment.slice(0, qIdx + 1);
    const query = beforeFragment.slice(qIdx + 1);
    const fragment = hashIdx >= 0 ? url.slice(hashIdx) : "";
    return base + decodeEscapes(query.replace(/\+/g, " ")) + fragment;
}
