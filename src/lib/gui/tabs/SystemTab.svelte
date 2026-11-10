<script lang="ts">
    /**
     * SystemTab — Settings as hero + three full-width cards.
     *
     * * Each card body is a stack of label-left/control-right rows.
     * * No native `<select>` here; enum fields are segmented/radio controls.
     * * Writes only `store.settings` — persistence stays reactive (autosave).
     * * Import is two-step: validate → confirm banner → replace; motion: ADR 0034.
     */
    import { tick } from "svelte";
    import { LOCALE_OPTIONS, t } from "../i18n.svelte";
    import { store } from "../../stores/settings.svelte";
    import { isMotionLevel, SETTINGS_DEFAULTS, type Settings } from "../../core/settings";
    import { parseSettingsTransfer, type ParsedTransfer, type TransferErrorCode } from "../../core/settings-transfer";
    import { LOG_LEVEL_LABELS, effectiveLogLevel, setLogLevel } from "../../core/log";
    import { AUTOSAVE_SPEEDS, nearestAutosaveSpeed, type AutosaveSpeedId } from "../autosave-speed";
    import { autosave, flush } from "../autosave.svelte";
    import { showToast, uiState, UNDO_TOAST_MS } from "../ui-state.svelte";
    import SettingsChoiceRow from "../components/SettingsChoiceRow.svelte";
    import SettingsTransferDialog from "../components/SettingsTransferDialog.svelte";
    import Icon from "../components/Icon.svelte";
    import type { IconName } from "../icon";
    import { createLogger } from "../../core/log";

    const log = createLogger("system");

    type IconOption = { value: string; label: string; icon: IconName; title?: string };

    const AUTOSAVE_ICONS: Record<AutosaveSpeedId, IconName> = {
        fast: "bolt",
        normal: "timer",
        slow: "hourglassTop",
    };
    const LOG_ICONS: Record<(typeof LOG_LEVEL_LABELS)[number], IconName> = {
        debug: "bugReport",
        info: "info",
        warn: "warning",
        error: "error",
        silent: "notificationsOff",
    };

    const themeOptions = $derived([
        { value: "auto", label: t("theme.auto"), icon: "brightnessAuto" },
        { value: "dark", label: t("theme.dark"), icon: "darkMode" },
        { value: "light", label: t("theme.light"), icon: "lightMode" },
    ] satisfies IconOption[]);
    const motionOptions = $derived([
        { value: "aus", label: t("motion.aus"), icon: "motionPhotosOff" },
        { value: "schnell", label: t("motion.schnell"), icon: "fastForward" },
        { value: "normal", label: t("motion.normal"), icon: "playArrow" },
        { value: "langsam", label: t("motion.langsam"), icon: "slowMotionVideo" },
    ] satisfies IconOption[]);
    const logLevelOptions = $derived(
        LOG_LEVEL_LABELS.map((level) => ({
            value: level,
            label: t(`system.logLevel.${level}`),
            icon: LOG_ICONS[level],
        })),
    );
    const performanceModeOptions = $derived([
        { value: "on", label: t("system.performanceMode.on"), icon: "toggleOn" },
        { value: "off", label: t("system.performanceMode.off"), icon: "toggleOff" },
    ] satisfies IconOption[]);
    const performanceModeValue = $derived(store.settings.performanceMode ? "on" : "off");
    const hostOptions = $derived([
        {
            value: "fixed",
            label: t("system.dashboardHost.fixedShort"),
            title: t("system.dashboardHost.fixed"),
            icon: "link",
        },
        {
            value: "aboutblank",
            label: t("system.dashboardHost.aboutblankShort"),
            title: t("system.dashboardHost.aboutblank"),
            icon: "tab",
        },
    ] satisfies IconOption[]);
    const autosaveOptions = $derived(
        AUTOSAVE_SPEEDS.map((step) => ({
            value: step.id,
            label: t(`autosave.speed.${step.id}`),
            icon: AUTOSAVE_ICONS[step.id],
        })),
    );

    const autosaveSpeed = $derived(nearestAutosaveSpeed(store.settings.autosaveDelayMs));

    const generalAtDefaults = $derived(
        store.settings.locale === SETTINGS_DEFAULTS.locale &&
            store.settings.autosaveDelayMs === SETTINGS_DEFAULTS.autosaveDelayMs,
    );
    const appearanceAtDefaults = $derived(
        store.settings.theme === SETTINGS_DEFAULTS.theme && store.settings.motion === SETTINGS_DEFAULTS.motion,
    );
    const advancedAtDefaults = $derived(
        store.settings.logLevel === SETTINGS_DEFAULTS.logLevel &&
            store.settings.performanceMode === SETTINGS_DEFAULTS.performanceMode &&
            store.settings.dashboardHost === SETTINGS_DEFAULTS.dashboardHost,
    );

    function onLocaleChange(value: string): void {
        if (value === "auto" || value === "de" || value === "en") store.settings.locale = value;
    }
    function onThemeChange(value: string): void {
        store.settings.theme = value === "dark" || value === "light" ? value : "auto";
    }
    function onMotionChange(value: string): void {
        if (isMotionLevel(value)) store.settings.motion = value;
    }
    function onAutosaveChange(value: string): void {
        const step = AUTOSAVE_SPEEDS.find((candidate) => candidate.id === (value as AutosaveSpeedId));
        if (step) store.settings.autosaveDelayMs = step.ms;
    }
    function onLogLevelChange(level: string): void {
        if (!LOG_LEVEL_LABELS.includes(level as (typeof LOG_LEVEL_LABELS)[number])) return;
        store.settings.logLevel = level as (typeof LOG_LEVEL_LABELS)[number];
        setLogLevel(effectiveLogLevel(store.settings));
    }
    function onPerformanceModeChange(value: string): void {
        store.settings.performanceMode = value === "on";
        // * Performance mode only derives the effective level — never writes
        //   "silent" into the stored preference (ADR 0041).
        setLogLevel(effectiveLogLevel(store.settings));
    }
    function onDashboardHostChange(value: string): void {
        store.settings.dashboardHost = value === "aboutblank" ? "aboutblank" : "fixed";
    }

    /** Card reset receipt with a session undo (ADR 0039 pattern). */
    function showResetToast(cardKey: string, undo: () => void): void {
        log.debug("settings card reset", { card: cardKey });
        showToast(t("system.reset.toast", { card: t(cardKey) }), {
            durationMs: UNDO_TOAST_MS,
            action: {
                label: t("common.undo"),
                run: () => {
                    log.debug("settings card reset undone", { card: cardKey });
                    undo();
                },
            },
        });
    }

    function resetGeneral(): void {
        const before = { locale: store.settings.locale, autosaveDelayMs: store.settings.autosaveDelayMs };
        store.settings.locale = SETTINGS_DEFAULTS.locale;
        store.settings.autosaveDelayMs = SETTINGS_DEFAULTS.autosaveDelayMs;
        showResetToast("system.group.settings", () => {
            store.settings.locale = before.locale;
            store.settings.autosaveDelayMs = before.autosaveDelayMs;
        });
    }
    function resetAppearance(): void {
        const before = { theme: store.settings.theme, motion: store.settings.motion };
        store.settings.theme = SETTINGS_DEFAULTS.theme;
        store.settings.motion = SETTINGS_DEFAULTS.motion;
        showResetToast("system.group.appearance", () => {
            store.settings.theme = before.theme;
            store.settings.motion = before.motion;
        });
    }
    function resetAdvanced(): void {
        const before = {
            logLevel: store.settings.logLevel,
            performanceMode: store.settings.performanceMode,
            dashboardHost: store.settings.dashboardHost,
        };
        store.settings.logLevel = SETTINGS_DEFAULTS.logLevel;
        store.settings.performanceMode = SETTINGS_DEFAULTS.performanceMode;
        store.settings.dashboardHost = SETTINGS_DEFAULTS.dashboardHost;
        // * Restore both inputs first, then apply the effective level once.
        setLogLevel(effectiveLogLevel(store.settings));
        showResetToast("system.group.advanced", () => {
            store.settings.logLevel = before.logLevel;
            store.settings.performanceMode = before.performanceMode;
            store.settings.dashboardHost = before.dashboardHost;
            setLogLevel(effectiveLogLevel(store.settings));
        });
    }

    interface TransferState {
        mode: "export" | "import";
        parsed: ParsedTransfer | null;
        fileName: string;
        error: TransferErrorCode | "read" | null;
    }

    let transfer = $state<TransferState | null>(null);
    let transferTrigger = $state<HTMLElement | null>(null);
    let fileInput = $state<HTMLInputElement | null>(null);

    function openTransfer(next: TransferState, trigger: HTMLElement): void {
        log.debug("transfer opened", {
            mode: next.mode,
            fileName: next.fileName,
            error: next.error,
            hasParsed: next.parsed !== null,
        });
        uiState.popover = null;
        uiState.modal = "transfer";
        transferTrigger = trigger;
        transfer = next;
    }

    function openExport(trigger: HTMLElement): void {
        openTransfer({ mode: "export", parsed: null, fileName: "", error: null }, trigger);
    }

    function triggerImport(trigger: HTMLElement): void {
        transferTrigger = trigger;
        fileInput?.click();
    }

    async function onImportFile(event: Event): Promise<void> {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        // * Reset so choosing the same file again fires another change event.
        input.value = "";
        if (!file) return;
        const trigger = transferTrigger ?? input;

        let text: string;
        try {
            text = await file.text();
        } catch (e) {
            log.warn("transfer file read failed", { fileName: file.name, error: String(e) });
            openTransfer({ mode: "import", parsed: null, fileName: file.name, error: "read" }, trigger);
            return;
        }

        const result = parseSettingsTransfer(text);
        if (result.ok) {
            log.debug("transfer file parsed", {
                fileName: file.name,
                groups: result.parsed.siteGroups.length,
                fields: Object.keys(result.parsed.fields).length,
            });
            openTransfer({ mode: "import", parsed: result.parsed, fileName: file.name, error: null }, trigger);
        } else {
            log.warn("transfer file rejected", { fileName: file.name, code: result.error.code });
            openTransfer({ mode: "import", parsed: null, fileName: file.name, error: result.error.code }, trigger);
        }
    }

    function closeTransfer(): void {
        const trigger = transferTrigger;
        transfer = null;
        uiState.modal = null;
        transferTrigger = null;
        void tick().then(() => trigger?.focus());
    }

    function onTransferApply(next: Settings, kind: "merge" | "replace"): void {
        // * Existing gate policy: replace normalizes, then the immediate flush
        //   persists only when the live state is valid (no silent pruning).
        log.debug("transfer applied", {
            kind,
            groups: next.rules.length,
            rules: next.rules.reduce((total, site) => total + site.rules.length, 0),
        });
        store.replace(next);
        setLogLevel(effectiveLogLevel(store.settings));
        if (!flush()) {
            log.warn("transfer applied but autosave paused", {
                pausedReason: autosave.pausedReason,
            });
            showToast(t("transfer.toast.paused"));
        } else {
            showToast(t(kind === "merge" ? "transfer.toast.merged" : "transfer.toast.replaced"));
        }
        closeTransfer();
    }
</script>

<div class="rr-tab-root rr-tab-root--lane">
    <div class="rr-info-body rr-centered-root">
        <section class="rr-hero rr-settings-hero" aria-labelledby="rr-settings-hero-title">
            <div class="rr-settings-hero-copy">
                <h3 id="rr-settings-hero-title" class="rr-settings-hero-title">{t("tabs.system")}</h3>
                <p class="rr-settings-hero-intro">{t("system.intro")}</p>
            </div>
            <div class="rr-info-hero-actions">
                <button
                    class="rr-btn"
                    type="button"
                    title={t("system.backup.hint")}
                    onclick={(event) => openExport(event.currentTarget)}
                >
                    <Icon name="download" />
                    {t("system.export")}
                </button>
                <button
                    class="rr-btn"
                    type="button"
                    title={t("system.backup.hint")}
                    onclick={(event) => triggerImport(event.currentTarget)}
                >
                    <Icon name="upload" />
                    {t("system.import")}
                </button>
                <input
                    bind:this={fileInput}
                    class="rr-settings-import-input"
                    type="file"
                    accept="application/json,.json"
                    onchange={onImportFile}
                />
            </div>
        </section>

        <section class="rr-card" aria-labelledby="rr-settings-general-title">
            <header class="rr-card-head">
                <Icon name="settings" class="rr-card-icon" />
                <h3 id="rr-settings-general-title" class="rr-card-title">{t("system.group.settings")}</h3>
                <button
                    class="rr-settings-reset"
                    type="button"
                    title={t("system.reset.title")}
                    aria-label={t("system.reset.card", { card: t("system.group.settings") })}
                    disabled={generalAtDefaults}
                    onclick={resetGeneral}
                >
                    <Icon name="settingsBackupRestore" />
                    {t("system.reset")}
                </button>
            </header>
            <div class="rr-settings-rows">
                <SettingsChoiceRow
                    name="locale"
                    label={t("system.locale")}
                    hint={t("system.locale.hint")}
                    value={store.settings.locale}
                    options={LOCALE_OPTIONS}
                    groupIcon="translate"
                    onchange={onLocaleChange}
                />
                <SettingsChoiceRow
                    name="autosave-speed"
                    label={t("autosave.speed")}
                    hint={t("system.autosave.hint")}
                    value={autosaveSpeed.id}
                    options={autosaveOptions}
                    onchange={onAutosaveChange}
                />
            </div>
        </section>

        <section class="rr-card" aria-labelledby="rr-settings-appearance-title">
            <header class="rr-card-head">
                <Icon name="dashboard" class="rr-card-icon" />
                <h3 id="rr-settings-appearance-title" class="rr-card-title">{t("system.group.appearance")}</h3>
                <button
                    class="rr-settings-reset"
                    type="button"
                    title={t("system.reset.title")}
                    aria-label={t("system.reset.card", { card: t("system.group.appearance") })}
                    disabled={appearanceAtDefaults}
                    onclick={resetAppearance}
                >
                    <Icon name="settingsBackupRestore" />
                    {t("system.reset")}
                </button>
            </header>
            <div class="rr-settings-rows">
                <SettingsChoiceRow
                    name="theme"
                    label={t("system.theme")}
                    hint={t("system.theme.hint")}
                    value={store.settings.theme}
                    options={themeOptions}
                    onchange={onThemeChange}
                />
                <SettingsChoiceRow
                    name="motion"
                    label={t("system.motion")}
                    hint={t("system.motion.hint")}
                    value={store.settings.motion}
                    options={motionOptions}
                    onchange={onMotionChange}
                />
            </div>
        </section>

        <section class="rr-card" aria-labelledby="rr-settings-advanced-title">
            <header class="rr-card-head">
                <Icon name="build" class="rr-card-icon" />
                <h3 id="rr-settings-advanced-title" class="rr-card-title">{t("system.group.advanced")}</h3>
                <button
                    class="rr-settings-reset"
                    type="button"
                    title={t("system.reset.title")}
                    aria-label={t("system.reset.card", { card: t("system.group.advanced") })}
                    disabled={advancedAtDefaults}
                    onclick={resetAdvanced}
                >
                    <Icon name="settingsBackupRestore" />
                    {t("system.reset")}
                </button>
            </header>
            <div class="rr-settings-rows">
                <SettingsChoiceRow
                    name="performance-mode"
                    label={t("system.performanceMode")}
                    hint={t("system.performanceMode.hint")}
                    value={performanceModeValue}
                    options={performanceModeOptions}
                    onchange={onPerformanceModeChange}
                />
                <SettingsChoiceRow
                    name="log-level"
                    label={t("system.logLevel")}
                    hint={store.settings.performanceMode
                        ? t("system.logLevel.performanceHint")
                        : t("system.logLevel.hint")}
                    value={store.settings.logLevel}
                    options={logLevelOptions}
                    disabled={store.settings.performanceMode}
                    onchange={onLogLevelChange}
                />
                <SettingsChoiceRow
                    name="dashboard-host"
                    label={t("system.dashboardHost")}
                    hint={t("system.dashboardHost.hint")}
                    value={store.settings.dashboardHost}
                    options={hostOptions}
                    onchange={onDashboardHostChange}
                />
            </div>
        </section>
    </div>
</div>

{#if transfer}
    <SettingsTransferDialog
        mode={transfer.mode}
        current={store.settings}
        parsed={transfer.parsed}
        fileName={transfer.fileName}
        error={transfer.error}
        onclose={closeTransfer}
        onapply={onTransferApply}
    />
{/if}
