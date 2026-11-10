// ─────────────────────────────────────────────────────────────────────────────
// MARK: Dashboard protocol — hash marker + cross-tab GM signaling (pure)
// ─────────────────────────────────────────────────────────────────────────────
// * ADR 0012 (mechanism ADR 0011): dashboard = hash-takeover page on a host
//   stub URL + `#rr-dashboard`; the userscript in that tab takes over.
// * Pure protocol pieces: URL marker/builder + boot request shape/normalizer.
// * Multi-dashboard: no heartbeat/forwarding; each menu click opens
//   its own tab and the request feeds only that boot.
// * Cross-tab delivery: GM storage + GM_addValueChangeListener.
// * `window.open` is popup-blocked (menu callbacks lack user activation).

import { createLogger } from "../core/log";

const log = createLogger("protocol");

/** The URL fragment that switches the userscript into dashboard mode. */
export const DASHBOARD_HASH = "rr-dashboard";

/** The dashboard tabs that can be encoded in the hash fragment. */
export const DASHBOARD_TABS = ["rules", "assistant", "stats", "info", "system"] as const;

/** A dashboard tab identifier. */
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

/** A dashboard boot request under its GM key (open + createRule). */
export interface DashboardRequest {
    /** Monotonic id — consumed exactly once by the dashboard tab. */
    id: number;
    /** The opener's page url (preview input + create-rule prefill source). */
    url: string;
    /** "Create new Rule" prefill requested. */
    createRule: boolean;
}

/**
 * Whether the current page url carries the dashboard marker.
 *
 * * Checked at document-start by `main.ts` — dashboard mode skips the engine,
 *   the watcher, and the GM menu entirely.
 */
export function isDashboardUrl(url: string): boolean {
    const hashIndex = url.indexOf("#");
    if (hashIndex < 0) return false;
    const fragment = url.slice(hashIndex + 1);
    return fragment === DASHBOARD_HASH || fragment.startsWith(`${DASHBOARD_HASH}/`);
}

/**
 * The host document the dashboard tab opens on — a `raw.githubusercontent.com`
 * file served as `text/plain` (ADR 0012): no site CSS/JS to fight, the takeover
 * wipes at document-start, and the existing all-urls match pattern already
 * covers the URL.
 *
 * * ! The path is a FROZEN public contract pinned to `refs/heads/main`: every
 *   published userscript fetches it, so renaming or moving it breaks all
 *   dashboards. The file stays deliberately inert (no scripts/styles/fonts).
 *   A version tag pin was rejected — old installs would never get stub fixes.
 * * warn Offline caveat: GitHub unreachable → the menu click opens a dead
 *   tab (no committed document → no injection) — accepted in ADR 0012.
 */
export const DASHBOARD_HOST_URL =
    "https://raw.githubusercontent.com/JanGaida/redirect-rules/refs/heads/main/dashboard-host.html";

/**
 * Builds the dashboard tab URL: the host document with the dashboard marker
 * appended.
 *
 * @param host - The host document URL (defaults to {@link DASHBOARD_HOST_URL};
 * the e2e polyfill passes a same-origin fixture path so the takeover tab keeps
 * sharing the fixture origin for storage-event signaling — ADR 0012).
 */
export function dashboardUrl(host: string = DASHBOARD_HOST_URL): string {
    return `${host}#${DASHBOARD_HASH}`;
}

/**
 * Reads the dashboard tab encoded in the url fragment (path segment after the
 * marker). Returns null when absent or unknown.
 */
export function readDashboardTab(url: string): DashboardTab | null {
    const hashIndex = url.indexOf("#");
    if (hashIndex < 0) return null;
    const fragment = url.slice(hashIndex + 1);
    if (fragment !== DASHBOARD_HASH && !fragment.startsWith(`${DASHBOARD_HASH}/`)) return null;
    const suffix = fragment.slice(DASHBOARD_HASH.length);
    if (suffix === "") return null;
    if (!suffix.startsWith("/")) return null;
    const segment = suffix.slice(1).split("/")[0]?.split("?")[0];
    if (segment === undefined || segment === "") return null;
    return (DASHBOARD_TABS as readonly string[]).includes(segment) ? (segment as DashboardTab) : null;
}

/**
 * Normalizes a dashboard boot request — fail-soft for corrupt values (null).
 *
 * @param raw - Whatever is stored under the request GM key.
 */
export function normalizeRequest(raw: unknown): DashboardRequest | null {
    if (typeof raw !== "object" || raw === null) {
        if (raw !== null && raw !== undefined) log.debug("boot request rejected", { type: typeof raw });
        return null;
    }
    const record = raw as Record<string, unknown>;
    if (typeof record.id !== "number" || typeof record.url !== "string") {
        log.debug("boot request rejected", { id: typeof record.id, url: typeof record.url });
        return null;
    }
    return { id: record.id, url: record.url, createRule: record.createRule === true };
}
