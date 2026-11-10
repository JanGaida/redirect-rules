// ─────────────────────────────────────────────────────────────────────────────
// MARK: Dashboard — hash-takeover page (open + takeover orchestration)
// ─────────────────────────────────────────────────────────────────────────────
// * ADR 0011 + 0012: GM_openInTab opens a host stub + `#rr-dashboard`; the
//   userscript in that tab stops rendering and mounts the Svelte dashboard.
// * No document handoff, no opener lifetime — the tab owns its GM context.
// * Multi-dashboard: every click opens its own tab; no heartbeat and
//   no request forwarding — the request feeds only its boot.
// * Remote settings writes adopt while clean, else a conflict hint is shown.
// * Styles via adoptedStyleSheets (CSP-exempt), `<style>` fallback.

import { mount, unmount } from "svelte";
import appIconRaw from "../../../assets/icons/app/icon.svg?raw";
import App from "./App.svelte";
import dashboardCss from "./dashboard.css?inline";
import { ensureViewportMeta } from "./dashboard-meta";
import { t } from "./i18n.svelte";
import { store } from "../stores/settings.svelte";
import { getStatsSink } from "../core/stats";
import { STORAGE_KEY, STORAGE_KEY_DASHBOARD_REQUEST, storageDelete, storageGet, storageSet } from "../core/storage";
import { createLogger, effectiveLogLevel, setLogLevel } from "../core/log";
import { autosave, flush, onRemoteSettingsChange } from "./autosave.svelte";
import {
    DASHBOARD_HOST_URL,
    dashboardUrl,
    normalizeRequest,
    readDashboardTab,
    type DashboardRequest,
    type DashboardTab,
} from "./dashboard-protocol";
const log = createLogger("dashboard");

/** Options for opening/focusing the dashboard. */
export interface DashboardOptions {
    /** The preview URL (the opener's page url at menu-click time). */
    url?: string;
    /** "Create new Rule": prefill a new site rule from `url`. */
    createRule?: boolean;
}

/** The tab the dashboard opens with. */
export type { DashboardTab } from "./dashboard-protocol";

/** Monotonic request id source (module scope — one per userscript context). */
let requestSeq = 0;

// ─── Opener side — open the dashboard tab ───────────────────────────────────────

/**
 * Opens a NEW dashboard tab.
 *
 * * Every menu click opens its own tab — the single-instance heartbeat and
 *   request forwarding are gone. The request value is written
 *   BEFORE the tab opens and is consumed by the NEW tab at boot (createRule
 *   prefill); a living dashboard does not listen for it anymore.
 *
 * @param options - Menu-click payload: preview url + createRule flag.
 */
export function openDashboard(options: DashboardOptions = {}): void {
    const request: DashboardRequest = {
        id: ++requestSeq,
        url: options.url ?? location.href,
        createRule: options.createRule ?? false,
    };
    storageSet(STORAGE_KEY_DASHBOARD_REQUEST, request);
    log.debug("dashboard request stored", { request });

    // * e2e seam (ADR 0012): the GM polyfill overrides the host with a
    //   fixture-origin path so the takeover tab stays same-origin (the
    //   forwarding relies on storage events). Honor it ONLY in dev or under the
    //   Playwright polyfill (`scriptHandler: "playwright"`); real Tampermonkey
    //   and Violentmonkey fall back to the persisted dashboardHost setting.
    const isDev = __DEV__ || import.meta.env.DEV;
    const isPlaywright = GM_info?.scriptHandler === "playwright";
    const hostOverride =
        isDev || isPlaywright ? (window as { __RR_DASHBOARD_HOST__?: string }).__RR_DASHBOARD_HOST__ : undefined;
    const hostFromSetting = store.settings.dashboardHost === "aboutblank" ? "about:blank" : DASHBOARD_HOST_URL;
    const host =
        isDev && hostOverride === undefined
            ? "https://127.0.0.1:5173/dashboard.html"
            : (hostOverride ?? hostFromSetting);
    const url = dashboardUrl(host);
    // * GM_openInTab bypasses popup blockers (extension API). The window.open
    // fallback only serves non-Tampermonkey contexts (e2e polyfill provides its
    // own GM_openInTab, so this fallback is a last resort). `noopener` severs the
    // opener but per spec makes window.open return null — no handle to validate,
    // so only GM_openInTab can report a blocked popup.
    const usesGmOpenInTab = typeof GM_openInTab === "function";
    const handle = usesGmOpenInTab ? GM_openInTab(url, { active: true }) : window.open(url, "_blank", "noopener");
    if (usesGmOpenInTab && !handle) {
        log.error("dashboard popup blocked — GM_openInTab returned no handle", { url, request });
        alert(t("dashboard.popupBlocked"));
        return;
    }
    log.debug("dashboard tab opening", { url, request, host });
}

// ─── Dashboard side — take over the tab + mount ─────────────────────────────────

/**
 * Boots DASHBOARD MODE in the takeover tab (called from main.ts when the url
 * carries the marker — engine, watcher, and GM menu are skipped entirely).
 *
 * Sequence: stop the site's loads → wipe the DOM (before the site's scripts
 * render — we run at document-start) → styles → store/logLevel init → stats
 * housekeeping → mount → remote-sync listener → close wiring.
 */
export function startDashboardMode(): void {
    // * !! Guard lifecycle: reserve BEFORE the wipe/mount so a synchronous second
    // *   boot (HMR, double injection) cannot double-mount; release on any failure
    // *   so a later retry (remount) can attempt the takeover again.
    const guard = window as Window & { __rrDashboardMounted?: boolean };
    if (guard.__rrDashboardMounted === true) {
        log.debug("dashboard mount skipped — already mounted");
        return;
    }
    guard.__rrDashboardMounted = true;

    try {
        takeoverDashboard();
    } catch (e) {
        // * Fail-soft: a permanently blank tab with no diagnostic is the worst
        // *   outcome — release the guard, report, and never rethrow.
        guard.__rrDashboardMounted = false;
        log.error("dashboard takeover failed — guard released for retry", {
            message: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack : null,
        });
    }
}

/** Runs the synchronous takeover under the pre-reserved mount guard. */
function takeoverDashboard(): void {
    // * Apply the persisted verbosity FIRST — every takeover log below honors it.
    setLogLevel(effectiveLogLevel(store.settings));
    log.debug("dashboard takeover starting", { url: location.href });

    // * 1. Kill the site: stop pending loads, then wipe whatever the parser
    // already built. DOM API only — CSP-safe (no inline markup ever written).
    // Restyle port: childNodes wipe does NOT touch attributes — site pages can
    // carry class/style on <html> (theme classes) which would bleed into the
    // dashboard frame → strip them explicitly.
    // * ! Vite-HMR: a dev server injecting @vite/client must not be window.stop()'d —
    // *   window.stop() tears down the HMR socket and forces the reload loop in dev mode.
    // *   In production/takeover tabs (no import.meta.hot) we keep the original behavior.
    if (!import.meta.hot) {
        window.stop?.();
        document.documentElement.innerHTML = "";
        if (document.documentElement.hasAttribute("class")) document.documentElement.removeAttribute("class");
        if (document.documentElement.hasAttribute("style")) document.documentElement.removeAttribute("style");
        if (document.body !== null) {
            if (document.body.hasAttribute("class")) document.body.removeAttribute("class");
            if (document.body.hasAttribute("style")) document.body.removeAttribute("style");
        }
        if (document.head === null) document.documentElement.appendChild(document.createElement("head"));
        if (document.body === null) document.documentElement.appendChild(document.createElement("body"));
    }
    document.title = t("dashboard.title");

    // * The wipe above removed the host stub's viewport meta — re-install it
    //   before layout runs, otherwise tablets use the ~980px fallback viewport.
    ensureViewportMeta(document);

    // * Use the app icon as the dashboard tab's favicon (browser tab icon).
    document.querySelectorAll('link[rel*="icon"]').forEach((el) => el.remove());
    const favicon = document.createElement("link");
    favicon.rel = "icon";
    favicon.type = "image/svg+xml";
    favicon.sizes = "any";
    favicon.href = "data:image/svg+xml," + encodeURIComponent(appIconRaw);
    document.head.appendChild(favicon);

    // * Hack webfont lives in dashboard.css as @font-face (font-display:
    // *   optional) — a late CDN stylesheet would swap the whole UI's metrics.

    // * 2. Styles — same-realm construction; adoptedStyleSheets is CSP-exempt.
    injectStyles(document);
    log.debug("dashboard styles injected");

    // * 3. Flush pending stats (pruning stays disabled: orphaned counters are
    //   harmless and `StatsSink.prune` remains covered by unit tests).
    const sink = getStatsSink();
    sink.flush();

    // * 4. Consume the request that OPENED this tab (if any).
    const rawBootRequest = storageGet<unknown>(STORAGE_KEY_DASHBOARD_REQUEST, null);
    const bootRequest = normalizeRequest(rawBootRequest);
    log.debug("dashboard boot request", {
        hasRaw: rawBootRequest !== null,
        requestId: bootRequest?.id ?? null,
        createRule: bootRequest?.createRule ?? false,
    });
    if (bootRequest !== null) {
        // * Delete only if no newer menu click overwrote the request meanwhile.
        const latest = normalizeRequest(storageGet<unknown>(STORAGE_KEY_DASHBOARD_REQUEST, null));
        if (latest?.id === bootRequest.id) storageDelete(STORAGE_KEY_DASHBOARD_REQUEST);
    }

    // * 5. Mount the fullscreen dashboard — win is THIS tab's window.
    const host = document.createElement("div");
    host.className = "rr-dashboard-host";
    document.body.appendChild(host);

    const close = (): void => {
        // * window.close() is allowed for history-free tabs in Firefox; some
        // engines refuse — degrade to an honest close-it-manually hint.
        window.close();
        window.setTimeout(() => {
            if (!window.closed) {
                log.warn("dashboard window.close refused — manual close required");
                alert(t("dashboard.closeManually"));
            }
        }, 150);
    };

    const app = mount(App, {
        target: host,
        props: {
            win: window,
            initialTab: (readDashboardTab(location.href) ?? "rules") as DashboardTab,
            initialUrl:
                bootRequest?.url ??
                // * The host stub carries no page context (ADR 0012) — menu
                //   opens always ship the opener's url via the boot request;
                //   only a hand-bookmarked dashboard starts with an empty
                //   preview field.
                "",
            createRule: bootRequest?.createRule ?? false,
            onClose: () => {
                unmount(app);
                close();
            },
        },
    });

    startRemoteSettingsSync();
    log.debug("dashboard remote sync listening");

    // * 6. Shutdown: autosave flush + stats flush (pagehide covers back-button
    // bfcache cases; beforeunload covers tab close). A pending debounce MUST
    // not die with the tab — flush() persists what the gate allows.
    const shutdown = (): void => {
        flush();
        getStatsSink().flush();
    };
    window.addEventListener("pagehide", shutdown);
    window.addEventListener("beforeunload", shutdown);

    log.debug("dashboard mode mounted (hash-takeover)", {
        url: location.href,
        bootRequest: bootRequest?.id ?? null,
    });
}

// ─── Remote sync — dashboard ↔ dashboard settings adoption ─────────────────────

/**
 * Listens for REMOTE settings writes (another dashboard's autosave/close flush)
 * — registered once per dashboard tab (tab lifetime, no removal needed).
 *
 * * The store stays the single source of truth: a remote write is adopted ONLY
 *   through {@link onRemoteSettingsChange} (remote reload while clean,
 *   conflict hint while dirty — see autosave.svelte.ts).
 */
function startRemoteSettingsSync(): void {
    try {
        GM_addValueChangeListener(STORAGE_KEY, (_name, _oldValue, newValue, remote) => {
            if (!remote) {
                log.debug("local settings write ignored");
                return;
            }
            onRemoteSettingsChange(newValue);
            log.debug("remote settings write received", { conflict: autosave.remoteConflict });
        });
    } catch (e) {
        // * Remote sync is a bonus — a missing GM listener must not block mounting.
        log.warn("remote settings sync unavailable — GM_addValueChangeListener failed", {
            error: e instanceof Error ? e.message : String(e),
        });
    }
}

// ─── Styles ──────────────────────────────────────────────────────────────────

/** Ref to the adopted sheet for HMR updates. */
let dashboardSheet: CSSStyleSheet | null = null;
/** Ref to the fallback `<style>` for HMR updates. */
let dashboardStyleEl: HTMLStyleElement | null = null;
function injectStyles(doc: Document): void {
    try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(dashboardCss);
        dashboardSheet = sheet;
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
        return;
    } catch (e) {
        log.warn("adoptedStyleSheets failed — falling back to <style>", { error: String(e) });
    }
    const style = doc.createElement("style");
    style.textContent = dashboardCss;
    dashboardStyleEl = style;
    doc.head.appendChild(style);
}

if (import.meta.hot) {
    import.meta.hot.accept("./dashboard.css?inline", (newModule) => {
        const nextCss = (newModule as { default?: string } | undefined)?.default ?? dashboardCss;
        if (dashboardSheet) {
            dashboardSheet.replaceSync(nextCss);
            return;
        }
        if (dashboardStyleEl) dashboardStyleEl.textContent = nextCss;
    });
}
