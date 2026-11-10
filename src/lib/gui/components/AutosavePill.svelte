<script lang="ts">
    /**
     * AutosavePill — rail stopwatch: the speed cycle only.
     *
     * * Click cycles fast → normal → slow (ADR 0024); the persisted value stays
     *   `autosaveDelayMs` so old profiles keep working.
     * * The pending countdown lives in the HEADER status line
     *   (`AutosaveIndicator.svelte`), not on this pill — speed and progress are
     *   deliberately separate signals.
     */
    import { t } from "../i18n.svelte";
    import { store } from "../../stores/settings.svelte";
    import { nearestAutosaveSpeed, nextAutosaveDelay } from "../autosave-speed";
    import Icon from "./Icon.svelte";
    import type { IconName } from "../icon";

    const speed = $derived(nearestAutosaveSpeed(store.settings.autosaveDelayMs));
    const iconName = $derived<IconName>(speed.id === "fast" ? "bolt" : speed.id === "slow" ? "hourglassTop" : "timer");
    const label = $derived(t(`autosave.speed.${speed.id}`));
    const ariaLabel = $derived(`${t("autosave.speed")}: ${label}`);
    const title = $derived(`${ariaLabel} — ${t("autosave.speed.hint")}`);

    /** Advances to the next canonical autosave delay. */
    function cycle(): void {
        store.settings.autosaveDelayMs = nextAutosaveDelay(store.settings.autosaveDelayMs);
    }
</script>

<button class="rr-autosave-toggle" type="button" aria-label={ariaLabel} {title} data-speed={speed.id} onclick={cycle}>
    <Icon name={iconName} />
</button>
