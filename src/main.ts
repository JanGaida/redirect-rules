// ─────────────────────────────────────────────────────────────────────────────
// MARK: Boot — @run-at document-start
// ─────────────────────────────────────────────────────────────────────────────
// * Two boot modes (ADR 0011):
//   DASHBOARD (#rr-dashboard): takeover, no engine/watcher/menu.
//   NORMAL: settings -> logLevel -> compile -> watcher -> menu.
// * Menu labels are locale-aware and registered once at boot.

import { isDashboardUrl } from "./lib/gui/dashboard-protocol";
import { openDashboard, startDashboardMode } from "./lib/gui/dashboard";
import { loadSettingsResult } from "./lib/core/settings";
import { compileRules } from "./lib/core/redirect-engine";
import { startWatcher } from "./lib/core/watcher";
import { getStatsSink } from "./lib/core/stats";
import { drainPendingStats, clearStatsDeltaStash } from "./lib/core/stats-drain";
import { createLogger, effectiveLogLevel, setLogLevel } from "./lib/core/log";
import { STORAGE_KEY, storageDelete } from "./lib/core/storage";
import { t } from "./lib/gui/i18n.svelte";

const log = createLogger("boot");

/** The full boot decision — dashboard takeover vs normal (engine + menu) mode. */
function boot(): void {
    // * DEV URL: defer from ANY bundled userscript (dev or prod, no Vite HMR
    // * context), so the Vite dashboard owns the tab. Otherwise a stale user
    // * script mounts a second app with duplicate popover ids.
    const isDevHost = location.port === "5173";
    const underViteDev = isDevHost && !import.meta.hot;
    if (underViteDev && isDashboardUrl(location.href)) {
        log.debug("deferring to Vite dev bundle (HMR path)", { url: location.href });
        return;
    }

    if (isDashboardUrl(location.href)) {
        // * The hash marker on the host stub url — this tab was opened by
        //   openDashboard() via GM_openInTab (popup-blocker-proof; the raw
        //   host: ADR 0011 + 0012).
        log.debug("dashboard mode selected", { url: location.href });
        startDashboardMode();
        return;
    }

    const load = loadSettingsResult();
    const settings = load.settings;
    if (!load.ok) {
        // * Defaults are used; the stored settings stay untouched (loadSettingsResult).
        log.warn("settings read failed — booting with defaults; stored settings preserved");
    }
    // * Persisted verbosity (system tab): applied BEFORE any compile/watcher
    //   logs so the boot output already honors the configured level.
    //   Performance mode silences WITHOUT overwriting the stored level.
    setLogLevel(effectiveLogLevel(settings));

    // * Migrate any stats that were stashed in `window.name` by a redirect whose
    //   GM write was truncated — runs at document-start, before any watcher.
    // * A non-null result is the un-drained delta (read/write still failing); it
    //   seeds the sink so a later redirect cannot overwrite and lose it.
    const statsSeed = drainPendingStats();

    log.debug("settings loaded", {
        version: typeof GM_info === "undefined" ? "unknown" : GM_info.script.version,
        locale: settings.locale,
        logLevel: settings.logLevel,
        effectiveLogLevel: effectiveLogLevel(settings),
        performanceMode: settings.performanceMode,
        groups: settings.rules.length,
        rules: settings.rules.reduce((total, site) => total + site.rules.length, 0),
    });

    const compiled = compileRules(settings.rules);
    // * Performance mode (ADR 0041): skip the stats sink entirely — no GM
    //   read-modify-write and no `window.name` stash for new redirects. The
    //   pending-delta drain above stays unconditional (data recovery).
    const statsSink = settings.performanceMode ? undefined : getStatsSink(statsSeed ?? undefined);
    log.debug("stats sink", { enabled: statsSink !== undefined, performanceMode: settings.performanceMode });
    // * Register the flush hook BEFORE the watcher runs its initial redirect so
    //   an early `location.replace` cannot strand an unflushed counter.
    if (statsSink !== undefined) {
        window.addEventListener("beforeunload", () => {
            // * Only a PERSISTED flush may clear the delta stash (idle/failed keep it).
            if (statsSink.flush() === "persisted") clearStatsDeltaStash();
        });
    }
    startWatcher(compiled, statsSink);

    // ─── GM menu — the GUI entry points (lazy dashboard tab) ──────────────────

    GM_registerMenuCommand(t("menu.openDashboard"), () => openDashboard({ url: location.href }));
    GM_registerMenuCommand(t("menu.createRule"), () => openDashboard({ url: location.href, createRule: true }));
    log.debug("menu commands registered", { locale: settings.locale });

    // ─── Dev-only TM-menu entries (build:dev, stripped in prod) ───────────────
    // * Gated by __DEV__ (compile-time, set in vite.config.ts via RR_DEV): in
    //   prod this block is dead-code-eliminated. Debug affordances for
    //   Tampermonkey sessions — flipping the log level + wiping the stored
    //   settings.
    // * ! Tampermonkey can't update existing command labels — the debug label
    //   reflects the level at registration time; reload to flip it back.

    const isDev = __DEV__ || import.meta.env.DEV;

    if (isDev) {
        let debugLoggingOn = false;
        GM_registerMenuCommand("DEV: Toggle debug logging", () => {
            debugLoggingOn = !debugLoggingOn;
            setLogLevel(debugLoggingOn ? "debug" : "info");
            log.info("dev debug logging toggled", { enabled: debugLoggingOn });
            alert(`Debug logging ${debugLoggingOn ? "enabled" : "disabled"}. Reload the page to flip the menu label.`);
        });

        GM_registerMenuCommand("DEV: Reset settings", () => {
            if (!confirm("Delete the stored settings? All rules will be lost.")) return;
            storageDelete(STORAGE_KEY);
            alert("Settings deleted. Reload the page — first boot writes fresh defaults.");
        });
    }
}

/**
 * Runs `boot` guarded — a GM menu/registration/import failure must surface,
 * never abort boot silently (document-start has no other error surface).
 */
function bootSafely(): void {
    try {
        boot();
    } catch (e) {
        log.error("boot failed — normal page mode aborted", {
            message: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack : undefined,
        });
    }
}

// * ! Popup-provisional documents: window.open'ed tabs commit their REAL url
// *   AFTER the userscript ran on the provisional about:blank document —
// *   location.href still reads "about:blank" at document-start (verified via
// *   e2e init probe). Tampermonkey itself injects into the COMMITTED document
// *   (correct href → immediate boot); the deferral only serves non-TM
// *   injection environments (e.g. Playwright addInitScript). Capped by WALL
// *   CLOCK (background-tab timer clamping can stretch tick counts), never
// *   hangs; a never-navigating provisional tab boots as normal-mode about:blank.
if (location.href === "about:blank") {
    log.debug("provisional about:blank document — waiting for url commit");
    const startedAt = Date.now();
    const commitPoll = window.setInterval(() => {
        const waitedMs = Date.now() - startedAt;
        if (location.href === "about:blank" && waitedMs < 2000) return;
        window.clearInterval(commitPoll);
        log.debug("about:blank wait finished", { waitedMs, url: location.href });
        bootSafely();
    }, 5);
} else {
    bootSafely();
}
