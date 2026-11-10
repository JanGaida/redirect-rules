// ─────────────────────────────────────────────────────────────────────────────
// MARK: Settings — types, defaults, persistence
// ─────────────────────────────────────────────────────────────────────────────
// * Typed rule model (ADR 0002); single GM key, no legacy migration (ADR 0003).
// * Fail-soft load: corrupt storage degrades to defaults + `Log.error`, never a
//   boot crash. A FAILED read returns defaults + `ok: false` WITHOUT writing —
//   the store then refuses to save, so intact storage is never overwritten.
// * Defaults are written ONLY when the key is absent (legacy rewrote every load).

import { isLocaleSetting, type LocaleSetting } from "./locale";
import { createLogger, isSettingsLogLevel, type SettingsLogLevel } from "./log";
import { storageGetResult, storageSet, STORAGE_KEY } from "./storage";
const log = createLogger("settings");

/** Generic literal-union guard — one source of truth per enum. */
function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
    return typeof value === "string" && (values as readonly string[]).includes(value);
}

/**
 * Dashboard theme (ADR 0013): `auto` follows the OS via
 * `prefers-color-scheme` (scoped to `data-theme="auto"`), `dark`/`light` force
 * the token set via `data-theme` on the takeover document's `<html>`.
 */
const THEME_VALUES = ["auto", "dark", "light"] as const;
export type ThemeSetting = (typeof THEME_VALUES)[number];

/** Type guard for a stored theme value (fail-soft normalization). */
export function isThemeSetting(value: unknown): value is ThemeSetting {
    return isOneOf(value, THEME_VALUES);
}

/** Motion level: four presets map to CSS duration tokens (ADR 0034). */
const MOTION_VALUES = ["aus", "schnell", "normal", "langsam"] as const;
export type MotionLevel = (typeof MOTION_VALUES)[number];

/** Type guard for a stored motion level (fail-soft normalization). */
export function isMotionLevel(value: unknown): value is MotionLevel {
    return isOneOf(value, MOTION_VALUES);
}

/** Legacy 8-step values → canonical preset (silent, one-way migration). */
const LEGACY_MOTION: Record<string, MotionLevel> = {
    aus: "aus",
    sofort: "schnell",
    sehrSchnell: "schnell",
    schnell: "schnell",
    normal: "normal",
    moderat: "normal",
    langsam: "langsam",
    sehrLangsam: "langsam",
};

/**
 * Strict motion normalizer for import validation — canonical value or a known
 * legacy key, otherwise null (no silent default).
 *
 * @param value - Raw `motion` field from storage/import.
 */
export function normalizeMotionStrict(value: unknown): MotionLevel | null {
    if (isMotionLevel(value)) return value;
    if (typeof value === "string" && Object.hasOwn(LEGACY_MOTION, value)) return LEGACY_MOTION[value];
    return null;
}

/**
 * Normalizes a stored motion value — silent for absent/legacy, warn for junk.
 *
 * @param value - Raw `motion` field from storage/import.
 */
export function normalizeMotion(value: unknown): MotionLevel {
    if (value === undefined) return "normal";
    const strict = normalizeMotionStrict(value);
    if (strict !== null) return strict;
    log.warn(`unknown motion "${String(value)}" — keeping "normal"`);
    return "normal";
}

/**
 * Dashboard host selection (ADR 0012+): `fixed` uses the raw.githubusercontent
 * stub, `aboutblank` uses about:blank (experimental).
 */
const HOST_VALUES = ["fixed", "aboutblank"] as const;
export type DashboardHostSetting = (typeof HOST_VALUES)[number];
/** Type guard for a stored dashboard-host value (fail-soft normalization). */
export function isDashboardHostSetting(value: unknown): value is DashboardHostSetting {
    return isOneOf(value, HOST_VALUES);
}

/** Rule kind: standard `String.replace` semantics (`$&`, `$1`, …). */
export interface ReplaceRule {
    kind: "replace";
    /** Regex in `/pattern/flags` notation, else literal. */
    regex: string;
    /** Replacement template — standard JS replace semantics. */
    substitution: string;
}

/** Rule kind: append/overwrite query params (see `append-query.ts`). */
export interface AppendQueryRule {
    kind: "appendQuery";
    /** Optional match gate — the rule applies only when the URL matches. */
    regex?: string;
    /** Params in `k=v&k2=v2` form. */
    params: string;
}

/** Rule kind: remove query params by key (see `append-query.ts`). */
export interface RemoveQueryRule {
    kind: "removeQuery";
    /** Optional match gate — the rule applies only when the URL matches. */
    regex?: string;
    /** `&`-separated key patterns; a trailing `*` is a prefix wildcard. */
    keys: string;
}

/** Rule kind: flow-control checkpoint — tests a regex and aborts (or continues) the rest of the chain. */
export interface CheckpointRule {
    kind: "checkpoint";
    /** Regex in `/pattern/flags` notation, else literal. Tested against the current URL. */
    regex: string;
    /** `continue`: proceed only when the regex matches. `stop`: stop when the regex matches. */
    mode: "continue" | "stop";
}

/** A URL rule — discriminated by `kind`. */
export type UrlRule = ReplaceRule | AppendQueryRule | RemoveQueryRule | CheckpointRule;

/** Type guard for a preview entry shape (fail-soft normalization). */
export interface PreviewEntry {
    /** Preview input URL fed to the group chain. */
    url: string;
    /** Expected final URL; empty = preview-only (no test). */
    testOutputUri: string;
    /** Optional freeform note for the preview block. */
    description?: string;
}

/** A site rule: the gate regex plus the ordered rules applied when it matches. */
export interface SiteRule {
    siteRegex: string;
    /**
     * Optional explorer label. Empty/absent = the readable site regex is shown.
     * Display-only — never used by the redirect engine.
     */
    description?: string;
    /**
     * Group-level off switch (sparse): `true` = the engine skips the whole
     * group; absent = active. No per-rule equivalent by design.
     */
    disabled?: boolean;
    rules: UrlRule[];
    /**
     * Persisted preview/test entries. Each entry feeds the group chain
     * independently; `testOutputUri` empty = preview only.
     */
    previewEntries?: PreviewEntry[];
}

/**
 * Whether a site group participates in the redirect engine.
 *
 * @param site - The site group to inspect.
 */
export function isSiteEnabled(site: SiteRule): boolean {
    return site.disabled !== true;
}

/** The whole settings object — exactly what lives under the single GM key. */
export interface Settings {
    locale: LocaleSetting;
    /** Console verbosity — persisted (system tab); applied at boot via `setLogLevel`. */
    logLevel: SettingsLogLevel;
    /**
     * Performance mode (ADR 0041): stops redirect-stat recording and forces
     * silent console logging. The stored `logLevel` is preserved, not overwritten.
     */
    performanceMode: boolean;
    /** Dashboard theme — applied at dashboard mount, persisted on save (ADR 0013). */
    theme: ThemeSetting;
    /** Motion level — controls global CSS duration tokens. */
    motion: MotionLevel;
    /**
     * Dashboard preview default (ADR 0040): hide skipped chain steps.
     * Per-group overrides are session-only GUI state — never persisted here.
     */
    hideSkipped: boolean;
    /** Dashboard host — fixed stub (ADR 0012) vs experimental about:blank. */
    dashboardHost: DashboardHostSetting;
    /** Autosave debounce delay in milliseconds — persisted (Settings tab). */
    autosaveDelayMs: number;
    rules: SiteRule[];
    /**
     * Persisted UI position (cached, optional): the last opened site group (+ its
     * selected rule) — restored on the next dashboard open so the explorer does not
     * start fully folded. Absent = "no selection remembered" (first boot).
     */
    lastSelection?: { siteIndex: number; ruleIndex: number };
}

/**
 * First-boot rule set: fifteen real-world groups — media, search, shopping,
 * social and tracking cleanup. Each group carries a gate (host-anchored except
 * the content-gated tracking group), an idempotent rule chain, a use-case
 * `description`, and pinned test entries (`testOutputUri`) with their own
 * descriptions, so the engine is verifiable on a fresh install.
 * ! All groups ship DISABLED (opt-in, ADR 0038): first boot never rewrites URLs
 *   until the user activates a group. Existing stored groups stay active.
 * ! Site gates are host-anchored (`^https?://`): wrapper URLs that merely CONTAIN
 *   a gated host (share/redirect links) must never be rewritten in place. The
 *   tracking group is the exception — it deliberately matches tracking params
 *   anywhere in the URL and only edits the query, never the host.
 */
export const EXAMPLE_RULES: SiteRule[] = [
    {
        siteRegex: "/^https?:\\/\\/[a-z-]+\\.m\\.wikipedia\\.org\\//",
        description: "Wikipedia: send mobile article links to the desktop site",
        disabled: true,
        previewEntries: [
            {
                url: "https://de.m.wikipedia.org/wiki/Beispiel",
                testOutputUri: "https://de.wikipedia.org/wiki/Beispiel",
                description: "Mobile article URL becomes the desktop URL.",
            },
            {
                url: "https://en.m.wikipedia.org/wiki/Example",
                testOutputUri: "https://en.wikipedia.org/wiki/Example",
                description: "The language subdomain is preserved while m. is removed.",
            },
        ],
        rules: [
            {
                kind: "replace",
                regex: "/^(https?:\\/\\/)([a-z-]+)\\.m\\.wikipedia\\.org\\//",
                substitution: "$1$2.wikipedia.org/",
            },
        ],
    },
    {
        siteRegex: "/^https?:\\/\\/(?:www\\.|m\\.)?youtube\\.com\\//",
        description: "YouTube: normalize mobile, Shorts, embed and share links to desktop watch pages",
        disabled: true,
        previewEntries: [
            {
                url: "https://m.youtube.com/shorts/abc123?si=xyz",
                testOutputUri: "https://www.youtube.com/watch?v=abc123",
                description: "Mobile Shorts URL becomes a desktop watch URL; the si tracking is dropped.",
            },
            {
                url: "https://www.youtube.com/shorts/abc123?list=PL123",
                testOutputUri: "https://www.youtube.com/watch?v=abc123&list=PL123",
                description: "Playlist params survive the Shorts rewrite.",
            },
            {
                url: "https://youtube.com/embed/abc123?start=5",
                testOutputUri: "https://www.youtube.com/watch?v=abc123&start=5",
                description: "Bare-host embed URLs normalize to a www watch URL.",
            },
            {
                url: "https://www.youtube.com/watch?v=abc123",
                testOutputUri: "https://www.youtube.com/watch?v=abc123",
                description: "Canonical watch URLs exit early through the checkpoint.",
            },
            {
                url: "https://www.youtube.com/watch?v=abc123&si=xyz",
                testOutputUri: "https://www.youtube.com/watch?v=abc123",
                description: "si is also removed from canonical watch URLs.",
            },
        ],
        rules: [
            // * `si` is share tracking on every YouTube surface — strip it before the
            //   host/checkpoint chain so canonical watch URLs get cleaned too.
            { kind: "removeQuery", regex: "", keys: "si" },
            // * Host first — the checkpoint below covers bare/www/m uniformly.
            {
                kind: "replace",
                regex: "/^(https?:\\/\\/)(?:m\\.|www\\.)?youtube\\.com\\//",
                substitution: "$1www.youtube.com/",
            },
            { kind: "checkpoint", regex: "/^https?:\\/\\/www\\.youtube\\.com\\/watch\\?/", mode: "stop" },
            // * Query form first: `?` becomes the watch-query separator.
            { kind: "replace", regex: "/\\/shorts\\/([A-Za-z0-9_-]+)\\/?\\?/", substitution: "/watch?v=$1&" },
            { kind: "replace", regex: "/\\/embed\\/([A-Za-z0-9_-]+)\\/?\\?/", substitution: "/watch?v=$1&" },
            // * Bare form keeps the fragment.
            {
                kind: "replace",
                regex: "/\\/(?:shorts|embed)\\/([A-Za-z0-9_-]+)\\/?(#.*)?$/",
                substitution: "/watch?v=$1$2",
            },
        ],
    },
    {
        siteRegex: "/^https?:\\/\\/youtu\\.be\\//",
        description: "YouTube: expand short youtu.be links to canonical watch URLs",
        disabled: true,
        previewEntries: [
            {
                url: "https://youtu.be/abc123",
                testOutputUri: "https://www.youtube.com/watch?v=abc123",
                description: "Bare short link becomes a www watch URL.",
            },
            {
                url: "https://youtu.be/abc123?t=42",
                testOutputUri: "https://www.youtube.com/watch?v=abc123&t=42",
                description: "The start-time query survives the expansion.",
            },
            {
                url: "https://youtu.be/abc123?si=xyz&t=42",
                testOutputUri: "https://www.youtube.com/watch?v=abc123&t=42",
                description: "The share si parameter is dropped; the start time stays.",
            },
        ],
        rules: [
            // * Share tracking lives on the short link too.
            { kind: "removeQuery", regex: "", keys: "si" },
            {
                kind: "replace",
                regex: "/^(https?:\\/\\/)youtu\\.be\\/([A-Za-z0-9_-]+)\\?/",
                substitution: "$1www.youtube.com/watch?v=$2&",
            },
            {
                kind: "replace",
                regex: "/^(https?:\\/\\/)youtu\\.be\\/([A-Za-z0-9_-]+)\\/?(#.*)?$/",
                substitution: "$1www.youtube.com/watch?v=$2$3",
            },
            { kind: "replace", regex: "/[?&](#|$)/", substitution: "$1" },
        ],
    },
    {
        siteRegex: "/^https?:\\/\\/(?:old|new|i|np)\\.reddit\\.com\\//",
        description: "Reddit: open legacy and mobile variants on the current site",
        disabled: true,
        previewEntries: [
            {
                url: "https://old.reddit.com/r/test/",
                testOutputUri: "https://www.reddit.com/r/test/",
                description: "Legacy old.reddit.com URL becomes the www host.",
            },
            {
                url: "https://new.reddit.com/r/test/",
                testOutputUri: "https://www.reddit.com/r/test/",
                description: "The new-reddit host becomes www.",
            },
            {
                url: "https://i.reddit.com/r/test/",
                testOutputUri: "https://www.reddit.com/r/test/",
                description: "The mobile i.reddit.com host becomes www.",
            },
            {
                url: "https://np.reddit.com/r/test/",
                testOutputUri: "https://www.reddit.com/r/test/",
                description: "No-participation np.reddit.com becomes www.",
            },
        ],
        rules: [
            {
                kind: "replace",
                regex: "/^(https?:\\/\\/)(?:old|new|i|np)\\.reddit\\.com\\//",
                substitution: "$1www.reddit.com/",
            },
        ],
    },
    {
        // * TLD shape: com/de/co.uk/com.au — `[a-z]{2,3}` rejects lookalike hosts.
        siteRegex: "/^https?:\\/\\/(?:www\\.)?google\\.[a-z]{2,3}(?:\\.[a-z]{2,3})?\\/search\\?/",
        description: "Google Search: force 100 results with the Web filter",
        disabled: true,
        previewEntries: [
            {
                url: "https://www.google.com/search?q=redirect+rules",
                testOutputUri: "https://www.google.com/search?q=redirect+rules&num=100&udm=14",
                description: "Appends num=100 and udm=14 to a search URL.",
            },
            {
                url: "https://google.com/search?q=x",
                testOutputUri: "https://google.com/search?q=x&num=100&udm=14",
                description: "Bare google.com search URLs are covered too.",
            },
            {
                url: "https://www.google.com/search?q=x&num=50&udm=48",
                testOutputUri: "https://www.google.com/search?q=x&num=100&udm=14",
                description: "Existing values are overwritten in place.",
            },
            {
                url: "https://www.google.com/search?q=x&num=100&udm=14",
                testOutputUri: "https://www.google.com/search?q=x&num=100&udm=14",
                description: "Already-normalized search URLs stay unchanged.",
            },
        ],
        rules: [{ kind: "appendQuery", regex: "", params: "num=100&udm=14" }],
    },
    {
        siteRegex: "/^https?:\\/\\/(?:www\\.)?google\\.[a-z]{2,3}(?:\\.[a-z]{2,3})?\\/amp\\//",
        description: "Google AMP: rewrite AMP links to the canonical article URL",
        disabled: true,
        previewEntries: [
            {
                url: "https://www.google.com/amp/s/example.com/article/amp",
                testOutputUri: "https://example.com/article",
                description: "AMP wrapper and trailing /amp marker are removed.",
            },
            {
                url: "https://www.google.com/amp/s/example.com/article?amp=1",
                testOutputUri: "https://example.com/article",
                description: "A trailing amp query is removed with the wrapper.",
            },
            {
                url: "https://www.google.com/amp/s/example.com/article?amp=1&foo=2",
                testOutputUri: "https://example.com/article?foo=2",
                description: "A mid-list amp query keeps the remaining params.",
            },
            {
                url: "https://www.google.com/amp/s/example.com/article/amp?amp=1#top",
                testOutputUri: "https://example.com/article#top",
                description: "Path and query forms are cleaned while the fragment survives.",
            },
        ],
        rules: [
            {
                kind: "replace",
                regex: "/^(https?:\\/\\/)(?:www\\.)?google\\.[a-z]{2,3}(?:\\.[a-z]{2,3})?\\/amp\\/s\\//",
                substitution: "$1",
            },
            // * Query form: mid-list (`?a&b`) and last/pre-fragment (`?a#x`).
            { kind: "replace", regex: "/([?&])amp(?:=1)?&/g", substitution: "$1" },
            { kind: "replace", regex: "/([?&])amp(?:=1)?(?=$|#)/g", substitution: "" },
            // * Path form: `/amp` as trailing segment, before query/fragment.
            { kind: "replace", regex: "/\\/amp\\/?(?=$|[?#])/g", substitution: "" },
        ],
    },
    {
        siteRegex: "/^https?:\\/\\/(?:www\\.)?amazon\\.[a-z]{2,3}(?:\\.[a-z]{2,3})?\\//",
        description: "Amazon: strip affiliate and session tracking from product links",
        disabled: true,
        previewEntries: [
            {
                url: "https://www.amazon.de/dp/B08N5WRWNW/ref=sr_1_1?tag=foo&pd_rd_w=abc&pf_rd_p=def&qid=123&sr=8-1&psc=1",
                testOutputUri: "https://www.amazon.de/dp/B08N5WRWNW?psc=1",
                description: "The /ref path and tracking parameters are removed; the psc variant selection stays.",
            },
        ],
        rules: [
            // * Path `/ref=…` sits outside the query — removeQuery cannot see it.
            { kind: "replace", regex: "/\\/ref=[^/?#]*/g", substitution: "" },
            {
                kind: "removeQuery",
                regex: "",
                keys: "tag&ref&ref_&pd_rd_*&pf_rd_*&qid&sr&sprefix&crid&content-id&_encoding",
            },
        ],
    },
    {
        siteRegex: "/^https?:\\/\\/open\\.spotify\\.com\\//",
        description: "Spotify: strip the si share-tracking parameter from track and album links",
        disabled: true,
        previewEntries: [
            {
                url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123",
                testOutputUri: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
                description: "The si parameter from the share dialog is removed.",
            },
        ],
        rules: [{ kind: "removeQuery", regex: "", keys: "si" }],
    },
    {
        siteRegex: "/^https?:\\/\\/(?:[a-z]{2,3}\\.)?linkedin\\.com\\//",
        description: "LinkedIn: strip share and e-mail tracking from post links",
        disabled: true,
        previewEntries: [
            {
                url: "https://www.linkedin.com/posts/foo-activity-123?utm_source=share&utm_medium=member_desktop&rcm=abc",
                testOutputUri: "https://www.linkedin.com/posts/foo-activity-123",
                description: "Share parameters and rcm tracking are removed.",
            },
        ],
        rules: [
            {
                kind: "removeQuery",
                regex: "",
                keys: "trk&trackingId&refId&rcm&lipi&midToken&midSig&utm_*",
            },
        ],
    },
    {
        siteRegex: "/^https?:\\/\\/(?:www\\.)?instagram\\.com\\//",
        description: "Instagram: strip igsh share tracking from post and reel links",
        disabled: true,
        previewEntries: [
            {
                url: "https://www.instagram.com/p/Cabc123/?igsh=xyz&utm_source=copy_link",
                testOutputUri: "https://www.instagram.com/p/Cabc123/",
                description: "igsh and UTM parameters are removed; img_index stays untouched.",
            },
        ],
        rules: [{ kind: "removeQuery", regex: "", keys: "igsh&igshid&utm_*&fbclid" }],
    },
    {
        siteRegex: "/^https?:\\/\\/(?:www\\.|m\\.|web\\.)?facebook\\.com\\//",
        description: "Facebook: strip share tracking (fbclid, mibextid) from links",
        disabled: true,
        previewEntries: [
            {
                url: "https://www.facebook.com/share/p/abc/?mibextid=xyz&fbclid=def",
                testOutputUri: "https://www.facebook.com/share/p/abc/",
                description: "Share and click tracking are removed; story_fbid/id stay.",
            },
        ],
        rules: [{ kind: "removeQuery", regex: "", keys: "fbclid&mibextid&rdid&utm_*" }],
    },
    {
        siteRegex: "/^https?:\\/\\/(?:www\\.)?tiktok\\.com\\//",
        description: "TikTok: strip share and app tracking from video links",
        disabled: true,
        previewEntries: [
            {
                url: "https://www.tiktok.com/@user/video/123?_t=8abc&_r=1&is_from_webapp=1",
                testOutputUri: "https://www.tiktok.com/@user/video/123",
                description: "App and share parameters from mobile links are removed.",
            },
        ],
        rules: [
            {
                kind: "removeQuery",
                regex: "",
                keys: "_t&_r&is_from_webapp&sender_device&share_app_id&share_link_id&utm_*",
            },
        ],
    },
    {
        siteRegex: "/^https?:\\/\\/(?:www\\.)?ebay\\.[a-z]{2,3}(?:\\.[a-z]{2,3})?\\//",
        description: "eBay: strip marketing and affiliate tracking from item links",
        disabled: true,
        previewEntries: [
            {
                url: "https://www.ebay.de/itm/123456789?_trkparms=abc&_trksid=p123&campid=456&hash=item1",
                testOutputUri: "https://www.ebay.de/itm/123456789?hash=item1",
                description: "Marketing parameters are removed; the item hash stays.",
            },
        ],
        rules: [
            {
                kind: "removeQuery",
                regex: "",
                keys: "_trkparms&_trksid&amdata&mkevt&mkcid&mkrid&campid&customid&toolid&utm_*",
            },
        ],
    },
    {
        // * Variant subdomains are included so share params are cleaned after the
        //   host-rewrite group above.
        siteRegex: "/^https?:\\/\\/(?:[a-z]{1,3}\\.)?reddit\\.com\\//",
        description: "Reddit: strip share tracking from comment links",
        disabled: true,
        previewEntries: [
            {
                url: "https://www.reddit.com/r/test/comments/abc/title/?share_id=xyz&utm_source=share&correlation_id=def",
                testOutputUri: "https://www.reddit.com/r/test/comments/abc/title/",
                description: "Share parameters are removed; the host rewrite group stays separate.",
            },
        ],
        rules: [
            {
                kind: "removeQuery",
                regex: "",
                keys: "share_id&correlation_id&utm_*&ref&ref_source",
            },
        ],
    },
    {
        // * Content gate (not host-anchored): the group only runs when tracking params exist.
        siteRegex:
            "/[?&](?:utm_|fbclid|gclid|gbraid|wbraid|dclid|msclkid|yclid|mc_cid|mc_eid|mkt_tok|igshid|twclid|srsltid|_openstat|ref_src|ref_url)/",
        description: "Tracking: remove UTM, ad-click and share identifiers from any URL",
        disabled: true,
        previewEntries: [
            {
                url: "https://example.com/p?utm_source=a&utm_medium=b&id=1&fbclid=xyz",
                testOutputUri: "https://example.com/p?id=1",
                description: "All utm_* and fbclid params are removed; real params stay.",
            },
            {
                url: "https://example.com/p?utm_source=a",
                testOutputUri: "https://example.com/p",
                description: "An emptied query drops the question mark.",
            },
            {
                url: "https://example.com/p?id=1&utm_source=a#frag",
                testOutputUri: "https://example.com/p?id=1#frag",
                description: "The fragment is never touched.",
            },
            {
                url: "https://example.com/p?id=1&gbraid=x&srsltid=y&ref_src=z",
                testOutputUri: "https://example.com/p?id=1",
                description: "Ad-click and share identifiers beyond UTM are removed too.",
            },
        ],
        rules: [
            {
                kind: "removeQuery",
                regex: "/[?&](?:utm_|fbclid|gclid|gbraid|wbraid|dclid|msclkid|yclid|mc_cid|mc_eid|mkt_tok|igshid|twclid|srsltid|_openstat|ref_src|ref_url)/",
                keys: "utm_*&fbclid&gclid&gbraid&wbraid&dclid&msclkid&yclid&mc_cid&mc_eid&mkt_tok&igshid&twclid&srsltid&_openstat&ref_src&ref_url",
            },
        ],
    },
];

/**
 * Non-rule defaults — one source for first boot and the card reset buttons.
 * ! Never call defaultSettings() to derive these (see recursion note below).
 */
export const SETTINGS_DEFAULTS = {
    locale: "auto",
    logLevel: "info",
    performanceMode: false,
    theme: "auto",
    motion: "normal",
    hideSkipped: false,
    dashboardHost: "fixed",
    autosaveDelayMs: 2000,
} as const satisfies Omit<Settings, "rules" | "lastSelection">;

/**
 * The RAW first-boot shape (authored constants only, pre-normalization).
 * ! normalizeSettings and defaultSettings both derive from this — NEVER call
 *   defaultSettings from inside normalizeSettings (recursion!).
 */
function rawDefaults(): {
    locale: LocaleSetting;
    logLevel: SettingsLogLevel;
    performanceMode: boolean;
    theme: ThemeSetting;
    motion: MotionLevel;
    hideSkipped: boolean;
    dashboardHost: DashboardHostSetting;
    autosaveDelayMs: number;
    rules: SiteRule[];
} {
    return { ...SETTINGS_DEFAULTS, rules: EXAMPLE_RULES };
}

/** Fresh DEEP copy of the example rule list — the constant never leaks (store mutates). */
function exampleRulesCopy(): SiteRule[] {
    return EXAMPLE_RULES.map((site) => ({
        siteRegex: site.siteRegex,
        ...(site.description !== undefined ? { description: site.description } : {}),
        ...(site.disabled === true ? { disabled: true } : {}),
        previewEntries: site.previewEntries ? site.previewEntries.map((entry) => ({ ...entry })) : [],
        rules: site.rules.map((r) => ({ ...r })),
    }));
}

/**
 * Returns the default settings: `locale: "auto"` (the browser resolves it at
 * runtime), default log level, the first-boot example rule list.
 *
 * * Computed per call (not a frozen constant) — the rule list must be a FRESH
 *   DEEP COPY (callers mutate the returned settings — the module constant must
 *   never leak by reference into the store). Built THROUGH normalizeSettings so
 *   the uniform field shape applies on the very boot.
 */
export function defaultSettings(): Settings {
    return normalizeSettings(rawDefaults());
}

// ─── Normalization — shape validation, fail-soft ──────────────────────────────

/** Minimal `Record<string, unknown>` view used by the guard helpers below. */
function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Fail-soft enum field: unknown values warn and keep the fallback. */
function normalizeEnum<T extends string>(
    record: Record<string, unknown>,
    key: string,
    guard: (value: unknown) => value is T,
    fallback: T,
): T {
    const value = record[key];
    if (guard(value)) return value;
    if (value !== undefined) {
        log.warn(`unknown ${key} "${String(value)}" — keeping "${fallback}"`);
    }
    return fallback;
}

/**
 * Normalizes one raw rule object into a `UrlRule` — or null when unusable.
 *
 * Shape-only validation (regex COMPILATION validity is the engine's fail-soft
 * concern — invalid regexes survive normalization and get skipped at compile).
 */
export function normalizeRule(raw: unknown): UrlRule | null {
    const record = asRecord(raw);
    if (!record) return null;
    // * ! UNIFORM FIELD SHAPE: regex/substitution/
    //   params are ALWAYS plain strings ("" = unset) — the GUI binds them into
    //   $bindable props, which THROW on undefined. An empty replace regex is
    //   INERT (compile skips it); an empty appendQuery gate means "no gate".
    //   Tests pin the normalize output exactly. (Preview inputs live on the
    //   SITE group as `previewEntries` — a rule-level `testUrl` is dropped.)
    if (record.kind === "replace") {
        if (typeof record.regex !== "string" || typeof record.substitution !== "string") return null;
        return {
            kind: "replace",
            regex: record.regex,
            substitution: record.substitution,
        };
    }
    if (record.kind === "appendQuery") {
        if (typeof record.params !== "string") return null;
        return {
            kind: "appendQuery",
            regex: typeof record.regex === "string" ? record.regex : "",
            params: record.params,
        };
    }
    if (record.kind === "removeQuery") {
        if (typeof record.keys !== "string") return null;
        return {
            kind: "removeQuery",
            regex: typeof record.regex === "string" ? record.regex : "",
            keys: record.keys,
        };
    }
    if (record.kind === "checkpoint") {
        if (typeof record.regex !== "string") return null;
        const mode = record.mode === "continue" || record.mode === "stop" ? record.mode : "continue";
        return {
            kind: "checkpoint",
            regex: record.regex,
            mode,
        };
    }
    return null;
}

/**
 * Normalizes an unknown (possibly corrupt, possibly legacy-shaped) value into
 * valid `Settings` — unusable entries are logged and skipped, never thrown.
 *
 * @param raw - Whatever was stored under the GM key (`unknown` by design).
 * @returns Valid settings — defaults when `raw` is unusable at the top level.
 */
export function normalizeSettings(raw: unknown): Settings {
    const record = asRecord(raw);
    if (!record) {
        if (raw !== null && raw !== undefined) {
            log.error("stored settings are not an object — using defaults", { type: typeof raw });
        }
        // * Degrade to the DEFAULTS (example rules included) — safe: defaultSettings
        // feeds the EXISTING-record path, no recursion.
        return defaultSettings();
    }

    // * Fresh start from the raw defaults but with an EMPTY rule list — the
    // rules below replace it (the constant must never leak by reference).
    const result: Settings = { ...rawDefaults(), rules: [] };

    result.locale = normalizeEnum(record, "locale", isLocaleSetting, result.locale);
    result.logLevel = normalizeEnum(record, "logLevel", isSettingsLogLevel, result.logLevel);
    // * performanceMode (ADR 0041): boolean-only, fail-soft; malformed values
    //   warn and keep the "off" default.
    if (typeof record.performanceMode === "boolean") {
        result.performanceMode = record.performanceMode;
    } else if (record.performanceMode !== undefined) {
        log.warn(`unknown performanceMode "${String(record.performanceMode)}" — keeping false`);
    }
    result.theme = normalizeEnum(record, "theme", isThemeSetting, result.theme);
    result.motion = normalizeMotion(record.motion);
    result.dashboardHost = normalizeEnum(record, "dashboardHost", isDashboardHostSetting, result.dashboardHost);

    // * hideSkipped: preview display default (ADR 0040). Boolean-only, fail-soft;
    //   malformed values warn and keep the "show skipped" default.
    if (typeof record.hideSkipped === "boolean") {
        result.hideSkipped = record.hideSkipped;
    } else if (record.hideSkipped !== undefined) {
        log.warn(`unknown hideSkipped "${String(record.hideSkipped)}" — keeping false`);
    }

    // * autosaveDelayMs: persisted autosave debounce delay (ms). Fail-soft to
    //   2000 ms when missing/invalid/out of range.
    if (
        typeof record.autosaveDelayMs === "number" &&
        Number.isFinite(record.autosaveDelayMs) &&
        record.autosaveDelayMs >= 250 &&
        record.autosaveDelayMs <= 30000
    ) {
        result.autosaveDelayMs = record.autosaveDelayMs;
    } else if (record.autosaveDelayMs !== undefined) {
        log.warn(`unknown autosaveDelayMs "${String(record.autosaveDelayMs)}" — keeping default`);
    }

    // * lastSelection: persisted dashboard position (optional, fail-soft). Malformed
    //   entries are dropped silently — the GUI just starts folded.
    if (record.lastSelection !== undefined) {
        const raw = asRecord(record.lastSelection);
        if (
            raw &&
            typeof raw.siteIndex === "number" &&
            Number.isInteger(raw.siteIndex) &&
            typeof raw.ruleIndex === "number" &&
            Number.isInteger(raw.ruleIndex) &&
            raw.siteIndex >= 0 &&
            raw.ruleIndex >= 0
        ) {
            result.lastSelection = { siteIndex: raw.siteIndex, ruleIndex: raw.ruleIndex };
        } else if (record.lastSelection !== null) {
            log.warn("dropping malformed lastSelection", { lastSelection: record.lastSelection });
        }
    }

    if (Array.isArray(record.rules)) {
        // * Stored rules REPLACE the first-boot example list (result starts empty).
        for (const rawSite of record.rules) {
            const site = asRecord(rawSite);
            if (!site || typeof site.siteRegex !== "string" || !Array.isArray(site.rules)) {
                log.warn("skipping malformed site rule", { siteRule: rawSite });
                continue;
            }
            const rules: UrlRule[] = [];
            for (const rawRule of site.rules) {
                const rule = normalizeRule(rawRule);
                if (rule) rules.push(rule);
                else log.warn("skipping malformed url rule", { rule: rawRule });
            }
            const rawPreviewSource = Array.isArray(site.previewEntries)
                ? site.previewEntries
                : Array.isArray(site.previewUrls)
                  ? site.previewUrls
                  : [];
            const previewEntries: PreviewEntry[] = rawPreviewSource
                .map((value): PreviewEntry | null => {
                    if (typeof value === "string") return { url: value, testOutputUri: "" };
                    const record = asRecord(value);
                    if (!record) return null;
                    if (typeof record.url !== "string") {
                        // * Legacy single-field object or malformed: coerce best-effort.
                        if (typeof record.testUrl === "string")
                            // * not used anymore, but accept
                            return {
                                url: record.testUrl,
                                testOutputUri: typeof record.testOutputUri === "string" ? record.testOutputUri : "",
                            };
                        return null;
                    }
                    return {
                        url: record.url,
                        testOutputUri: typeof record.testOutputUri === "string" ? record.testOutputUri : "",
                        description: typeof record.description === "string" ? record.description : "",
                    };
                })
                .filter((value): value is PreviewEntry => value !== null);
            const description = typeof site.description === "string" ? site.description.trim() : "";
            let disabled: true | undefined;
            if (site.disabled === true) disabled = true;
            else if (site.disabled !== undefined && site.disabled !== false) {
                log.warn("ignoring non-boolean disabled flag", { disabled: site.disabled });
            }
            result.rules.push({
                siteRegex: site.siteRegex,
                ...(description !== "" ? { description } : {}),
                ...(disabled === true ? { disabled: true } : {}),
                rules,
                previewEntries,
            });
        }
    } else {
        // * Rules missing or not an array — fail-soft to the example list as the
        // default (a fresh copy: never the module constant).
        if (record.rules !== undefined) {
            log.warn("settings.rules is not an array — keeping the first-boot example rule list");
        }
        result.rules = exampleRulesCopy();
    }

    return result;
}

/** Load outcome: `ok: false` means the GM read FAILED (not "key absent"). */
export interface SettingsLoad {
    settings: Settings;
    ok: boolean;
}

/**
 * Loads settings from GM storage and reports whether the read succeeded.
 *
 * First boot (read ok + key absent) writes the defaults; otherwise the stored
 * object is normalized fail-soft. A FAILED read returns defaults + `ok: false`
 * WITHOUT writing — callers MUST treat the settings as non-persistable so the
 * intact stored value is never overwritten (data loss).
 */
export function loadSettingsResult(): SettingsLoad {
    const read = storageGetResult<unknown>(STORAGE_KEY, null);
    if (!read.ok) {
        // * ! Read failure is NOT "key absent": keep stored rules untouched.
        log.error("settings read failed — using defaults without overwriting storage");
        return { settings: defaultSettings(), ok: false };
    }
    const stored = read.value;
    if (stored === null || stored === undefined) {
        const defaults = defaultSettings();
        log.info("no stored settings — writing defaults (first boot)", {
            groups: defaults.rules.length,
            rules: defaults.rules.reduce((total, site) => total + site.rules.length, 0),
        });
        saveSettings(defaults);
        return { settings: defaults, ok: true };
    }
    const normalized = normalizeSettings(stored);
    log.debug("settings normalized", {
        groups: normalized.rules.length,
        rules: normalized.rules.reduce((total, site) => total + site.rules.length, 0),
        locale: normalized.locale,
        logLevel: normalized.logLevel,
        performanceMode: normalized.performanceMode,
    });
    return { settings: normalized, ok: true };
}

/**
 * Loads settings from GM storage — thin wrapper for callers that cannot act on
 * a failed read (boot page context, tests). Prefer {@link loadSettingsResult}
 * where a write may follow: it surfaces the failure so saving can be refused.
 */
export function loadSettings(): Settings {
    return loadSettingsResult().settings;
}

/**
 * Persists the whole settings object under the single GM key.
 *
 * @param settings - The settings object to write.
 * @returns True when the GM write succeeded.
 */
export function saveSettings(settings: Settings): boolean {
    return storageSet(STORAGE_KEY, settings);
}
