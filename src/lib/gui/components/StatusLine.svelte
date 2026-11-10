<script lang="ts">
    /**
     * StatusLine — the status strip: ● ready + settings shape + the
     * autosave state.
     *
     * * Header segment (rail redesign): App renders it once, in the header
     *   between the brand and the actions — no bottom strip, no RulesTab row.
     * * Self-contained: derives from the store + autosave singletons.
     * * States: pending (debounce armed — ring + "saving N changes…"), paused
     *   (invalid regex / empty row / failed GM write — persisting waits, rows
     *   stay visible), applied (check + clock), the boot default "saved", plus the
     *   multi-dashboard conflict hint (remote write while this tab was dirty —
     *   local wins on the next apply).
     * * The leading glyph slot is `AutosaveIndicator`: ring while pending/paused,
     *   checkmark after apply — exactly one of the two is visible.
     */
    import { t, tPlural, resolveLocale } from "../i18n.svelte";
    import { store } from "../../stores/settings.svelte";
    import { autosave, type PauseReason } from "../autosave.svelte";
    import { countChanges } from "../../core/settings-diff";
    import AutosaveIndicator from "./AutosaveIndicator.svelte";

    /** Label + hint keys per pause reason — the glyph stays shared. */
    const PAUSED_COPY: Record<PauseReason, { label: string; hint: string }> = {
        invalid: { label: "autosave.paused.invalid", hint: "autosave.paused.invalid.hint" },
        empty: { label: "autosave.paused.empty", hint: "autosave.paused.empty.hint" },
        write: { label: "autosave.paused.write", hint: "autosave.paused.write.hint" },
    };

    /** Current paused copy (the reason is always set while the phase is paused). */
    const pausedCopy = $derived(
        autosave.pausedReason === null ? PAUSED_COPY.empty : PAUSED_COPY[autosave.pausedReason],
    );

    const totalRules = $derived.by(() => store.settings.rules.reduce((sum, site) => sum + site.rules.length, 0));
    const shapeText = $derived.by(
        () =>
            `${tPlural("system.stats.shape.sites", store.settings.rules.length)} · ${tPlural("system.stats.shape.rules", totalRules)}`,
    );

    /** Row-granular pending-change count (0 = clean or settings-only change). */
    const changesCount = $derived(store.dirty ? countChanges(store.savedSettings, store.settings) : 0);

    /** Pending label: count 0 = theme/locale/speed change (no rule rows). */
    const pendingText = $derived(
        changesCount === 0
            ? t("autosave.pending")
            : changesCount === 1
              ? t("autosave.pending.one")
              : t("autosave.pending.other", { count: changesCount }),
    );

    /** Locale-aware clock (autosave applied / conflict hint timestamps). */
    function clock(ts: number): string {
        return new Intl.DateTimeFormat(resolveLocale(store.settings.locale), {
            hour: "2-digit",
            minute: "2-digit",
        }).format(ts);
    }
</script>

<div class="rr-status" aria-live="polite" aria-atomic="false">
    <span class="rr-status-ready" title={t("status.ready")}
        ><span class="rr-status-dot" aria-hidden="true">●</span> {t("status.ready")}</span
    >
    <span class="rr-status-shape" title={shapeText}>{shapeText}</span>
    {#if autosave.phase === "pending"}
        <span class="rr-status-state rr-status-pending" title={pendingText}>
            <AutosaveIndicator />
            <span class="rr-status-label">{pendingText}</span>
        </span>
    {:else if autosave.phase === "paused"}
        <span class="rr-status-state rr-status-paused" title={t(pausedCopy.hint)}>
            <AutosaveIndicator />
            <span class="rr-status-label">{t(pausedCopy.label)}</span>
        </span>
    {:else if autosave.lastAppliedAt !== null}
        <span
            class="rr-status-state rr-status-applied"
            title={t("autosave.applied", { time: clock(autosave.lastAppliedAt) })}
        >
            <AutosaveIndicator />
            <span class="rr-status-label">{t("autosave.applied", { time: clock(autosave.lastAppliedAt) })}</span>
        </span>
    {:else}
        <span class="rr-status-state" title={t("status.saved")}>
            <span class="rr-status-label">{t("status.saved")}</span>
        </span>
    {/if}
    {#if autosave.remoteConflict}
        <span class="rr-status-state rr-status-conflict" title={t("autosave.remoteConflict.hint")}
            >{t("autosave.remoteConflict")}</span
        >
    {/if}
</div>
