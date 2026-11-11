<script lang="ts">
    /**
     * App — dashboard root: fullscreen layout, header (brand, status segment,
     * actions), navigation (vertical rail on desktop, bottom bar on phones)
     * with the tab list, dev chips + utilities + version (rail footer on
     * desktop, header actions on phones), tab body, toast. Lives in the
     * hash-takeover tab mounted by `dashboard.ts` (ADR 0011).
     *
     * * Window wiring targets the DASHBOARD window (`win` prop) — `svelte:window`
     *   would bind the OPENER (the app code runs in the opener's context).
     * * Close policy: ESC + close button FLUSH the
     *   pending autosave first — the unsaved-changes confirm only remains for
     *   changes that CANNOT persist (autosave paused: invalid regex / empty
     *   row); a tab close hits the `beforeunload` guard on the dashboard
     *   window (flush + confirm only while paused-dirty). ESC closes an OPEN
     *   token/locale popover FIRST.
     * * Autosave (ADR 0024): every settings change re-arms the debounce; the
     *   rail stopwatch pill cycles fast (1 s) → normal (2 s) → slow (5 s) and
     *   draws the countdown ring. There is NO save button — Close/ESC are the
     *   synchronous flush paths (GM writes are sync).
     * * Undo: session snapshot — the undo button restores
     *   the dashboard's OPENING state (timestamped title; confirm while dirty).
     *   NO ctrl+z stack, tab-local by design.
     * * Changes counter: row granularity — StatusLine
     *   shows the count (hidden at 0), computed against the store's saved
     *   mirror (settings-diff).
     * * Theme (ADR 0013): tri-state auto|dark|light, cycled by the rail pill
     *   or the `T` key; PERSISTS via the autosave flow (like locale). The
     *   reactive effect mirrors the setting onto the takeover document's
     *   `<html>` data-theme (the CSS tokens are scoped to it).
     * * Restyle port (A9): rail tab icons + aria-label (accessible name stays
     *   the plain label for the E2E role selectors), bordered ghost buttons
     *   (close = danger text), status line — App renders it once in the header
     *   (component StatusLine).
     */
    import { onDestroy, tick, untrack } from "svelte";
    import { t, LOCALE_OPTIONS, resolveLocale } from "./i18n.svelte";
    import appIconRaw from "../../../assets/icons/app/icon.svg?raw";
    import { store } from "../stores/settings.svelte";
    import { uiState, pauseToast, resumeToast, runToastAction, dismissToast } from "./ui-state.svelte";
    import { toggleGlobalHideSkipped } from "./preview-visibility.svelte";
    import {
        autosave,
        restoreSnapshot,
        schedule,
        flush,
        isSnapshotCurrent,
        refreshFromStorage,
    } from "./autosave.svelte";
    import Icon from "./components/Icon.svelte";
    import type { IconName } from "./icon";
    import RulesTab from "./tabs/RulesTab.svelte";
    import AssistantTab from "./tabs/AssistantTab.svelte";
    import SystemTab from "./tabs/SystemTab.svelte";
    import StatsTab from "./tabs/StatsTab.svelte";
    import InfoTab from "./tabs/InfoTab.svelte";
    import StatusLine from "./components/StatusLine.svelte";
    import AutosavePill from "./components/AutosavePill.svelte";
    import type { DashboardTab } from "./dashboard";
    import { DASHBOARD_HASH } from "./dashboard-protocol";
    import type { ThemeSetting } from "../core/settings";
    import type { LocaleSetting } from "../core/locale";
    import { createLogger } from "../core/log";

    const log = createLogger("dashboard");

    /** Rail tab registry — icon glyph + label (icons are visual only). */
    const TABS: Array<{ id: DashboardTab; icon: IconName; label: () => string }> = [
        { id: "rules", icon: "gavel", label: () => t("tabs.rules") },
        { id: "assistant", icon: "smartToy", label: () => t("tabs.assistant") },
        { id: "stats", icon: "queryStats", label: () => t("tabs.stats") },
        { id: "info", icon: "info", label: () => t("tabs.info") },
        { id: "system", icon: "tune", label: () => t("tabs.system") },
    ];

    /** Theme cycle order: Auto → dunkel → hell. */
    const THEME_ORDER: ThemeSetting[] = ["auto", "dark", "light"];

    /** Rail footer version — same source as the About tab (GM_info may be absent). */
    const VERSION = typeof GM_info === "undefined" ? "unknown" : GM_info.script.version;

    let localeMenuEl = $state<HTMLDivElement | null>(null);
    let localePillEl = $state<HTMLButtonElement | null>(null);
    let railTabsEl = $state<HTMLDivElement | null>(null);

    // * Phone layout: the rail becomes a bottom bar and the utilities move into
    //   the header. MUST match the `(max-width: 760px)` breakpoint in
    //   dashboard.css — both sides are the single source of the switch.
    let phoneLayout = $state(false);
    let wasPhoneLayout = false;

    /** Current toast payload (null = hidden) — single-slot receipt/undo (ADR 0039). */
    const toast = $derived(uiState.toast);

    /** Current theme glyph for the rail pill. */
    const themeIcon = $derived<IconName>(
        store.settings.theme === "dark"
            ? "darkMode"
            : store.settings.theme === "light"
              ? "lightMode"
              : "brightnessAuto",
    );

    /** Resolved language label for the rail pill (auto shows the detected one). */
    const localeLabel = $derived(resolveLocale(store.settings.locale).toUpperCase());

    interface Props {
        /** The dashboard window (about:blank tab) — for key/beforeunload wiring. */
        win: Window;
        initialTab: DashboardTab;
        initialUrl: string;
        createRule: boolean;
        onClose: () => void;
    }

    let { win, initialTab, initialUrl, createRule, onClose }: Props = $props();

    // * Phone breakpoint watcher (CSS counterpart lives in dashboard.css).
    $effect(() => {
        const query = win.matchMedia("(max-width: 760px)");
        const update = (): void => {
            phoneLayout = query.matches;
        };
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    });

    // * A layout flip moves the locale trigger — an open popover would stay
    //   anchored to the old spot, so close it (rules-tab popovers are separate).
    $effect(() => {
        if (phoneLayout === wasPhoneLayout) return;
        wasPhoneLayout = phoneLayout;
        if (uiState.popover === "locale") uiState.popover = null;
    });

    /** Refresh animation gate — keeps the spin to at least one full turn. */
    let refreshing = $state(false);
    let refreshTimer: number | null = null;

    /**
     * Reloads site rules/settings from storage. Dirty state asks first — a
     * refresh discards unsaved/paused work, so it must be explicit.
     */
    function refresh(): void {
        if (refreshing) return;
        if (store.dirty && !win.confirm(t("common.refreshConfirm"))) {
            log.debug("refresh cancelled — unsaved changes kept");
            return;
        }
        refreshing = true;
        log.debug("dashboard refresh requested");
        refreshFromStorage();
        if (refreshTimer !== null) window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => {
            refreshing = false;
            refreshTimer = null;
        }, 700);
    }

    onDestroy(() => {
        if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    });

    // * TAB_ORDER mirrors src/lib/gui/App.svelte TABS registry (index drives slide direction).
    const TAB_ORDER: Record<DashboardTab, number> = {
        rules: 0,
        assistant: 1,
        stats: 2,
        info: 3,
        system: 4,
    };

    // * Intentionally captures only the INITIAL tab (the prop never changes after
    // mount) — hence the ignore instead of a closure.
    // svelte-ignore state_referenced_locally
    let activeTab: DashboardTab = $state(initialTab);
    // svelte-ignore state_referenced_locally
    let lastTab = $state(initialTab);
    const activeTabIndex = $derived(TAB_ORDER[activeTab]);
    // * Keep-alive: mount each tab once on first activation, then toggle visibility
    // instead of destroying/recreating it on every switch (micro-jank fix).
    // svelte-ignore state_referenced_locally
    let mountedTabs = $state<Record<DashboardTab, boolean>>({
        rules: initialTab === "rules",
        assistant: initialTab === "assistant",
        stats: initialTab === "stats",
        info: initialTab === "info",
        system: initialTab === "system",
    });
    $effect(() => {
        mountedTabs[activeTab] = true;
    });
    // * Rules-tab token reference popover: close it when leaving the tab. The
    //   keep-alive panel would otherwise hide an open dialog that still owns
    //   ESC (uiState.popover is checked before the dashboard close flow).
    $effect(() => {
        if (activeTab !== "rules") uiState.popover = null;
    });
    $effect(() => {
        if (activeTab === lastTab) return;
        log.debug("tab changed", { from: lastTab, to: activeTab });
        lastTab = activeTab;
        const next = `#${DASHBOARD_HASH}/${activeTab}`;
        if (win.location.hash === next) return;
        try {
            win.history.replaceState(null, "", next);
        } catch (error) {
            // * Opaque documents (about:blank) may refuse the rewrite — the tab
            //   just falls back to the rules tab on reload.
            log.debug("history.replaceState failed", { error: String(error) });
        }
    });
    // * Autogrow textareas in a freshly shown tab were measured while hidden (or
    // before layout settled) — re-run them on activation so heights match content.
    $effect(() => {
        const tab = activeTab;
        if (!tab) return;
        const frame = requestAnimationFrame(() => {
            document
                .querySelectorAll<HTMLElement>(".rr-tab-panel.rr-tab-panel--active textarea")
                .forEach((node) => node.dispatchEvent(new Event("input", { bubbles: true })));
        });
        return () => cancelAnimationFrame(frame);
    });

    // * "Create new Rule" requests as a state OBJECT with a sequence id — a new
    // id re-triggers the RulesTab effect exactly once (module-level consume
    // marker there survives tab-switch remounts).
    let createRuleSeq = 0;
    // svelte-ignore state_referenced_locally
    let createRuleRequest = $state<{ id: number; url: string } | null>(
        createRule ? { id: ++createRuleSeq, url: initialUrl } : null,
    );

    // * Assistant → Rules hand-off: the imported rule is revealed only after the
    //   user follows the "Open in Rules" link. A new id re-triggers RulesTab once.
    let revealRuleSeq = 0;
    let revealRuleRequest = $state<{ id: number; siteIndex: number; ruleIndex: number } | null>(null);

    /** Switches to the Rules tab and reveals one rule (assistant import link). */
    function openRule(siteIndex: number, ruleIndex: number): void {
        log.debug("open rule requested", { siteIndex, ruleIndex });
        revealRuleRequest = { id: ++revealRuleSeq, siteIndex, ruleIndex };
        activeTab = "rules";
    }

    /**
     * Stats → Settings hand-off (performance-mode banner). Focus moves after the
     * tick, because the Stats panel becomes inert on the tab switch.
     */
    function openPerformanceSettings(): void {
        log.debug("performance settings requested");
        activeTab = "system";
        void tick().then(() => {
            document.querySelector<HTMLInputElement>('input[name="performance-mode"]')?.focus();
        });
    }

    /** Locale-aware clock for the undo button's snapshot timestamp. */
    const snapshotTime = $derived.by(() =>
        new Intl.DateTimeFormat(resolveLocale(store.settings.locale), { hour: "2-digit", minute: "2-digit" }).format(
            autosave.snapshotAt,
        ),
    );

    /**
     * Close path (X/ESC): flush the pending autosave FIRST — GM writes are
     * synchronous, so everything the gate allows is on disk before the close.
     * The confirm remains only for paused-dirty state (invalid regex / empty
     * row cannot persist).
     */
    function requestClose(): void {
        log.debug("close requested", { dirty: store.dirty, pausedReason: autosave.pausedReason });
        flush();
        if (autosave.pausedReason !== null && store.dirty && !win.confirm(t("common.unsavedConfirm"))) {
            log.debug("close cancelled — paused dirty state kept");
            return;
        }
        onClose();
    }

    /** Undo: restore the session snapshot (confirm whenever it changes anything). */
    function undo(): void {
        const changed = !isSnapshotCurrent();
        if (changed && !win.confirm(t("common.undo.confirm"))) {
            log.debug("undo cancelled by user");
            return;
        }
        log.debug("undo requested", { changed });
        restoreSnapshot();
    }

    /** Cycles the persisted theme (auto → dark → light; ADR 0013). */
    function cycleTheme(): void {
        const next = THEME_ORDER[(THEME_ORDER.indexOf(store.settings.theme) + 1) % THEME_ORDER.length];
        store.settings.theme = next;
    }

    /** Toggles the rail language popup and moves focus into it. */
    function toggleLocaleMenu(): void {
        if (uiState.popover === "locale") {
            log.debug("locale menu closed");
            uiState.popover = null;
            localePillEl?.focus();
            return;
        }
        log.debug("locale menu opened");
        uiState.popover = "locale";
        void tick().then(() => {
            const menu = localeMenuEl;
            (
                menu?.querySelector<HTMLButtonElement>("[aria-pressed='true']") ??
                menu?.querySelector<HTMLButtonElement>("button")
            )?.focus();
        });
    }

    /** Applies a locale setting and closes the popup back onto the pill. */
    function selectLocale(value: LocaleSetting): void {
        store.settings.locale = value;
        uiState.popover = null;
        void tick().then(() => localePillEl?.focus());
    }

    /** Whether a keydown happened inside an editable control (hotkey guard). */
    function isEditableTarget(target: EventTarget | null): boolean {
        const el = target as HTMLElement | null;
        if (!el) return false;
        return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
    }

    /**
     * Roving-tabindex navigation for the rail tablist. Both axis pairs move
     * (the rail is vertical on desktop and a bottom bar on phones).
     */
    function onTabKeydown(event: KeyboardEvent): void {
        const current = TABS.findIndex((tab) => tab.id === activeTab);
        if (current === -1) return;
        let next = current;
        switch (event.key) {
            case "ArrowDown":
            case "ArrowRight":
                next = (current + 1) % TABS.length;
                break;
            case "ArrowUp":
            case "ArrowLeft":
                next = (current - 1 + TABS.length) % TABS.length;
                break;
            case "Home":
                next = 0;
                break;
            case "End":
                next = TABS.length - 1;
                break;
            default:
                return;
        }
        event.preventDefault();
        const target = TABS[next];
        activeTab = target.id;
        uiState.popover = null;
        railTabsEl?.querySelector<HTMLButtonElement>(`#rr-tab-${target.id}`)?.focus();
    }

    // * Theme mirror onto the takeover document (data-theme drives the CSS
    // token tri-state — see dashboard.css). `document` here IS the dashboard's.
    $effect(() => {
        document.documentElement.dataset.theme = store.settings.theme;
    });

    // * Motion mirror onto the takeover document (data-motion drives CSS durations).
    $effect(() => {
        document.documentElement.dataset.motion = store.settings.motion;
    });

    // * Screen-reader language follows the resolved UI locale — the takeover
    //   document otherwise keeps the host page's lang attribute.
    $effect(() => {
        document.documentElement.lang = resolveLocale(store.settings.locale);
    });

    // * Autosave (ADR 0024): every settings deep change re-arms the configured
    //   debounce. CLEAN states (boot, close flush, remote adoption) schedule
    //   nothing — a remote reload cannot ping-pong (store stays clean).
    // ! `schedule()` reads AND writes `autosave.*` — call it UNTRACKED, so the
    //   effect only depends on the dirty comparison (a tracked call self-runs
    //   forever and trips Svelte's effect depth guard).
    $effect(() => {
        if (store.settingsJson !== store.savedSnapshot) untrack(schedule);
    });

    // * Preference debug trail — one effect instead of scattered handler logs.
    // * Plain variable (not $state): changing it must not retrigger the effect.
    const readTrackedSettings = () => ({
        locale: store.settings.locale,
        theme: store.settings.theme,
        motion: store.settings.motion,
        logLevel: store.settings.logLevel,
        performanceMode: store.settings.performanceMode,
        dashboardHost: store.settings.dashboardHost,
        autosaveDelayMs: store.settings.autosaveDelayMs,
        hideSkipped: store.settings.hideSkipped,
    });
    let previousSettings = readTrackedSettings();
    $effect(() => {
        const next = readTrackedSettings();
        const changed: Record<string, { from: unknown; to: unknown }> = {};
        for (const key of Object.keys(next) as Array<keyof typeof next>) {
            if (next[key] !== previousSettings[key]) {
                changed[key] = { from: previousSettings[key], to: next[key] };
            }
        }
        if (Object.keys(changed).length === 0) return;
        previousSettings = next;
        log.debug("preference changed", { changed });
    });

    // * All dashboard-window wiring in ONE effect — cleanup on unmount.
    $effect(() => {
        const onKeydown = (event: KeyboardEvent): void => {
            // * A child control that already handled the key owns it — never
            //   close the dashboard behind an editable target or an active drag.
            if (event.defaultPrevented) return;
            // * An open native dialog owns ESC (cancel) and the theme hotkey —
            //   never let the dashboard close underneath it.
            if (uiState.modal !== null) return;
            // * An open popover swallows ESC — close IT, not the dashboard.
            if (event.key === "Escape") {
                if (uiState.popover === "locale") {
                    uiState.popover = null;
                    localePillEl?.focus();
                    return;
                }
                if (uiState.popover !== null) {
                    uiState.popover = null;
                    return;
                }
                if (isEditableTarget(event.target)) return;
                if (document.body.classList.contains("rr-dragging")) return;
                requestClose();
                return;
            }
            // * Theme hotkey — never while typing in a field
            // and never with modifiers (Ctrl+T must stay the browser's).
            if (event.key.toLowerCase() !== "t" || event.ctrlKey || event.metaKey || event.altKey) return;
            if (isEditableTarget(event.target)) return;
            cycleTheme();
        };
        const onBeforeUnload = (event: BeforeUnloadEvent): void => {
            // * Autosave: flush the pending debounce (GM writes are sync) —
            // the native guard only remains for paused-dirty state (changes
            // that CANNOT persist: invalid regex / empty row).
            flush();
            if (!store.dirty) return;
            event.preventDefault();
            event.returnValue = "";
        };
        // * Locale popup: a pointerdown outside the menu/pill closes it. The
        // * pill itself stays clickable (its own click handler toggles).
        const onPointerDown = (event: PointerEvent): void => {
            if (uiState.popover !== "locale") return;
            const target = event.target as Node | null;
            if (target && (localeMenuEl?.contains(target) || localePillEl?.contains(target))) return;
            uiState.popover = null;
        };
        win.addEventListener("keydown", onKeydown);
        win.addEventListener("pointerdown", onPointerDown);
        win.addEventListener("beforeunload", onBeforeUnload);
        return () => {
            win.removeEventListener("keydown", onKeydown);
            win.removeEventListener("pointerdown", onPointerDown);
            win.removeEventListener("beforeunload", onBeforeUnload);
        };
    });
</script>

<!-- * Utility cluster (theme, locale, skipped-step switch, autosave speed):
       rendered ONCE — in the rail footer on desktop, in the header actions on
       phones. Duplicating it would duplicate `id="rr-locale-menu"` and the
       popover refs. -->
{#snippet railTools()}
    <button
        class="rr-theme-toggle"
        type="button"
        onclick={cycleTheme}
        title={t("theme.title")}
        aria-label={t(`theme.${store.settings.theme}`)}
    >
        <Icon name={themeIcon} />
    </button>
    <button
        class="rr-lang-toggle"
        type="button"
        bind:this={localePillEl}
        aria-label={`${t("system.locale")}: ${localeLabel}`}
        title={`${t("system.locale")}: ${localeLabel}`}
        aria-expanded={uiState.popover === "locale"}
        aria-controls="rr-locale-menu"
        onclick={toggleLocaleMenu}
    >
        {localeLabel}
    </button>
    {#if uiState.popover === "locale"}
        <div
            class="rr-locale-menu"
            id="rr-locale-menu"
            role="group"
            aria-label={t("system.locale")}
            bind:this={localeMenuEl}
        >
            {#each LOCALE_OPTIONS as option (option.value)}
                <button
                    class="rr-locale-option"
                    type="button"
                    aria-pressed={store.settings.locale === option.value}
                    onclick={() => selectLocale(option.value)}
                >
                    {option.label}
                </button>
            {/each}
        </div>
    {/if}
    <button
        class="rr-visibility-toggle"
        type="button"
        aria-pressed={store.settings.hideSkipped}
        aria-label={t("rail.hideSkipped")}
        title={t("rail.hideSkipped")}
        onclick={toggleGlobalHideSkipped}
    >
        <Icon name={store.settings.hideSkipped ? "visibilityOff" : "visibility"} />
    </button>
    <AutosavePill />
{/snippet}

<div class="rr-dashboard">
    <header class="rr-header">
        <div class="rr-header-left">
            <span class="rr-app-icon" aria-hidden="true">{@html appIconRaw}</span>
            <div class="rr-header-title-cluster">
                <h2 class="rr-title">{t("dashboard.title")}</h2>
            </div>
        </div>
        <!-- * Status line (rail redesign): one instance in the header, between
               the brand and the actions. -->
        <div class="rr-header-status">
            <StatusLine />
        </div>
        <div class="rr-header-actions">
            {#if phoneLayout}
                <div class="rr-rail-tools rr-rail-tools--header">{@render railTools()}</div>
            {/if}
            <!-- * Refresh: reload site rules/settings from storage and re-evaluate previews. -->
            <button
                class="rr-btn"
                class:rr-btn--spinning={refreshing}
                aria-label={t("common.refresh")}
                title={t("common.refresh")}
                onclick={refresh}
            >
                <Icon name="autorenew" />
            </button>
            <!-- * Undo: session snapshot — restores the dashboard's
                   OPENING state (timestamp in the title; confirm whenever the
                   session differs from it). Enabled AFTER autosave commits too —
                   the undo IS the safety net for automatic saves. -->
            <button
                class="rr-btn"
                aria-label={t("common.undo")}
                title={t("common.undo.title", { time: snapshotTime })}
                onclick={undo}
                disabled={isSnapshotCurrent()}
            >
                <Icon name="undo" />
            </button>
            <!-- * Close: danger ghost; icon-only, label via aria-label/title.
                   Flushes synchronously before closing (no save button, ADR 0024). -->
            <button
                class="rr-btn rr-btn--close"
                aria-label={t("common.close")}
                title={t("common.close")}
                onclick={requestClose}
            >
                <Icon name="close" />
            </button>
        </div>
    </header>

    <div class="rr-body" style={`--rr-active-tab-index:${activeTabIndex}`}>
        <aside class="rr-rail" aria-label={t("rail.caption")}>
            <span class="rr-rail-caption" aria-hidden="true">{t("rail.caption")}</span>
            <div
                class="rr-rail-tabs"
                role="tablist"
                aria-orientation={phoneLayout ? "horizontal" : "vertical"}
                aria-label={t("rail.caption")}
                bind:this={railTabsEl}
            >
                {#each TABS as tab (tab.id)}
                    <button
                        class="rr-rail-tab"
                        type="button"
                        role="tab"
                        id={`rr-tab-${tab.id}`}
                        aria-controls={`rr-panel-${tab.id}`}
                        aria-label={tab.label()}
                        aria-selected={activeTab === tab.id}
                        tabindex={activeTab === tab.id ? 0 : -1}
                        onkeydown={onTabKeydown}
                        onclick={() => {
                            activeTab = tab.id;
                            uiState.popover = null;
                        }}
                    >
                        <span class="rr-rail-icon"><Icon name={tab.icon} /></span>
                        <span class="rr-rail-label">{tab.label()}</span>
                    </button>
                {/each}
            </div>
            <span class="rr-rail-spacer"></span>
            <div class="rr-rail-foot">
                {#if __DEV__ || import.meta.env.DEV || import.meta.hot}
                    <!-- * Dev/disclaimer chips live in the rail foot, stacked vertically. -->
                    <div class="rr-rail-chips">
                        {#if __DEV__ || import.meta.env.DEV}
                            <span class="rr-chip rr-chip--disclaimer rr-chip--dev" title={t("disclaimer.dev")}>
                                <Icon name="terminalAdd" /><span>{t("disclaimer.dev")}</span>
                            </span>
                        {/if}
                        {#if import.meta.hot}
                            <span
                                class="rr-chip rr-chip--disclaimer rr-chip--hotreload"
                                title={t("disclaimer.hotreload")}
                            >
                                <Icon name="modeHeat" /><span>{t("disclaimer.hotreload")}</span>
                            </span>
                        {/if}
                    </div>
                {/if}
                <div class="rr-rail-tools">
                    {#if !phoneLayout}
                        {@render railTools()}
                    {/if}
                </div>
                <span class="rr-rail-version" title={VERSION}>v{VERSION}</span>
            </div>
        </aside>
        <div class="rr-main">
            <div
                class="rr-tab-panel"
                class:rr-tab-panel--active={activeTab === "rules"}
                style="--rr-tab-order:0"
                id="rr-panel-rules"
                role="tabpanel"
                aria-labelledby="rr-tab-rules"
                aria-hidden={activeTab !== "rules"}
                inert={activeTab !== "rules"}
            >
                {#if mountedTabs.rules}
                    <RulesTab {createRuleRequest} {revealRuleRequest} />
                {/if}
            </div>
            <div
                class="rr-tab-panel"
                class:rr-tab-panel--active={activeTab === "assistant"}
                style="--rr-tab-order:1"
                id="rr-panel-assistant"
                role="tabpanel"
                aria-labelledby="rr-tab-assistant"
                aria-hidden={activeTab !== "assistant"}
                inert={activeTab !== "assistant"}
            >
                {#if mountedTabs.assistant}
                    <AssistantTab onOpenRule={openRule} />
                {/if}
            </div>
            <div
                class="rr-tab-panel"
                class:rr-tab-panel--active={activeTab === "system"}
                style="--rr-tab-order:4"
                id="rr-panel-system"
                role="tabpanel"
                aria-labelledby="rr-tab-system"
                aria-hidden={activeTab !== "system"}
                inert={activeTab !== "system"}
            >
                {#if mountedTabs.system}
                    <SystemTab />
                {/if}
            </div>
            <div
                class="rr-tab-panel"
                class:rr-tab-panel--active={activeTab === "stats"}
                style="--rr-tab-order:2"
                id="rr-panel-stats"
                role="tabpanel"
                aria-labelledby="rr-tab-stats"
                aria-hidden={activeTab !== "stats"}
                inert={activeTab !== "stats"}
            >
                {#if mountedTabs.stats}
                    <StatsTab onsettings={openPerformanceSettings} active={activeTab === "stats"} />
                {/if}
            </div>
            <div
                class="rr-tab-panel"
                class:rr-tab-panel--active={activeTab === "info"}
                style="--rr-tab-order:3"
                id="rr-panel-info"
                role="tabpanel"
                aria-labelledby="rr-tab-info"
                aria-hidden={activeTab !== "info"}
                inert={activeTab !== "info"}
            >
                {#if mountedTabs.info}
                    <InfoTab />
                {/if}
            </div>
        </div>
    </div>

    <!-- * Toast (receipt + undo action + dismiss) — fixed, at the dashboard root.
         Single slot: a new toast replaces the pending one (ADR 0039). -->
    {#if toast}
        {#key toast}
            <div
                class="rr-toast"
                role="group"
                onmouseenter={pauseToast}
                onmouseleave={resumeToast}
                onfocusin={pauseToast}
                onfocusout={resumeToast}
            >
                <!-- * Countdown ring: drains over the toast duration and pauses
                     with the JS timer (hover/focus). aria-hidden — the message
                     itself is the status. -->
                <span class="rr-toast-timer" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                        <circle class="rr-toast-timer-track" cx="12" cy="12" r="9" />
                        <circle
                            class="rr-toast-timer-progress"
                            cx="12"
                            cy="12"
                            r="9"
                            style={`animation-duration:${toast.durationMs}ms;animation-play-state:${
                                uiState.toastPaused ? "paused" : "running"
                            }`}
                        />
                    </svg>
                </span>
                <span role="status">{toast.message}</span>
                {#if toast.action}
                    <button class="rr-toast-action" type="button" onclick={runToastAction}>
                        <Icon name="undo" />
                        {toast.action.label}
                    </button>
                {/if}
                <button
                    class="rr-toast-close"
                    type="button"
                    aria-label={t("toast.dismiss")}
                    title={t("toast.dismiss")}
                    onclick={dismissToast}
                >
                    <Icon name="close" />
                </button>
            </div>
        {/key}
    {/if}
</div>
