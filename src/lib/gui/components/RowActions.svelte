<script lang="ts">
    /**
     * RowActions — the compact delete/clone button strip for BOTH site and rule
     * rows (site rows may prepend the group on/off toggle). Icons are decorative
     * — aria-label/title carry the accessible name.
     * Clicks never bubble: the strip lives inside `<summary>` elements, so an
     * unguarded click would toggle the surrounding disclosure.
     */
    import Icon from "./Icon.svelte";
    import { t } from "../i18n.svelte";

    interface Props {
        onDelete: () => void;
        onClone: () => void;
        /** Optional group-level toggle (site rows only — never rule/test rows). */
        onToggle?: () => void;
        /** Current enabled state for the optional toggle. */
        togglePressed?: boolean;
        /** Accessible/tooltip label for the optional toggle. */
        toggleLabel?: string;
    }

    let { onDelete, onClone, onToggle, togglePressed = false, toggleLabel = "" }: Props = $props();
</script>

<div class="rr-actions">
    {#if onToggle}
        <button
            type="button"
            class="rr-btn rr-btn--toggle"
            aria-pressed={togglePressed}
            aria-label={toggleLabel}
            title={toggleLabel}
            onclick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggle();
            }}
        >
            <Icon name={togglePressed ? "toggleOn" : "toggleOff"} />
        </button>
    {/if}
    <button
        type="button"
        class="rr-btn rr-danger-hover"
        aria-label={t("a11y.delete")}
        title={t("a11y.delete")}
        onclick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
        }}
    >
        <Icon name="delete" />
    </button>
    <button
        type="button"
        class="rr-btn rr-btn--add"
        aria-label={t("a11y.clone")}
        title={t("a11y.clone")}
        onclick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClone();
        }}
    >
        <Icon name="contentCopy" />
    </button>
</div>
