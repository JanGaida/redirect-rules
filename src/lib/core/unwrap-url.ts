// ─────────────────────────────────────────────────────────────────────────────
// MARK: Unwrap — decode a redirect-wrapper target
// ─────────────────────────────────────────────────────────────────────────────
// * The one EDIT-level percent-decode: `unwrap` captures an encoded target and
//   replaces the whole URL with its decoded form (DDG `uddg`, Yahoo `RU=`,
//   Google `imgurl`).
// * ! Only absolute http(s) targets pass — `javascript:`, `data:`, `file:` etc.
//   are rejected before the watcher can navigate to them.
// * One `decodeURIComponent` pass; no `+` → space, no re-encoding, no `new URL()`.

import { createLogger } from "./log";

const log = createLogger("unwrap");

/** Why an `unwrap` match was not usable. */
export type UnwrapReason = "invalid-target";

/** One `unwrap` evaluation against the current (raw) URL. */
export interface UnwrapOutcome {
    /** Whether the matcher regex matched the URL at all. */
    matched: boolean;
    /** The decoded http(s) target, or null when the match is unusable. */
    target: string | null;
    /** Why a matched target was rejected (absent when unmatched). */
    reason?: UnwrapReason;
}

/** Absolute http(s) targets only — the security boundary for `location.replace`. */
const HTTP_TARGET_RE = /^https?:\/\//i;

/** Returns a stateless copy — a `g`/`y` matcher must not leak `lastIndex`. */
function stateless(matcher: RegExp): RegExp {
    if (!matcher.global && !matcher.sticky) return matcher;
    return new RegExp(matcher.source, matcher.flags.replace(/[gy]/g, ""));
}

/**
 * Matches a redirect wrapper and decodes its captured target.
 *
 * * Capture group 1 is the target; without a capture group the whole match is used.
 * * The regex tests the RAW current URL (wrappers encode the target), unlike the
 *   query gates that test `querySurface`.
 * * A malformed escape or a non-http(s) target leaves the URL unchanged.
 *
 * @param url     - The current raw URL.
 * @param matcher - The compiled `unwrap` regex.
 */
export function unwrapTarget(url: string, matcher: RegExp): UnwrapOutcome {
    const match = stateless(matcher).exec(url);
    if (match === null) return { matched: false, target: null };

    const raw = match.length > 1 ? match[1] : match[0];
    if (raw === undefined || raw === "") {
        log.debug("unwrap target rejected — empty capture", { url });
        return { matched: true, target: null, reason: "invalid-target" };
    }

    let decoded: string;
    try {
        decoded = decodeURIComponent(raw);
    } catch {
        log.debug("unwrap target rejected — invalid escape", { url });
        return { matched: true, target: null, reason: "invalid-target" };
    }

    // * sec: never hand a non-http(s) scheme to the watcher's location.replace.
    if (!HTTP_TARGET_RE.test(decoded)) {
        log.debug("unwrap target rejected — unsupported scheme", { url });
        return { matched: true, target: null, reason: "invalid-target" };
    }

    return { matched: true, target: decoded };
}
