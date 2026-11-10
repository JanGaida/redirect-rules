<script lang="ts">
    /**
     * SettingsChoiceRow — one settings line: label/hint left, controls right.
     *
     * * Insight layout: the visible label lives in the row; `ChoiceGroup` keeps its
     *   legend in the DOM but visually hidden for the accessible group name.
     * * The row hint owns the id and reaches the group via `describedById`.
     * * Presentation only — value writes stay in the tab.
     */
    import ChoiceGroup from "./ChoiceGroup.svelte";
    import type { IconName } from "../icon";

    interface RowOption {
        value: string;
        label: string;
        icon?: IconName;
        /** Fuller wording for short visible labels — tooltip + accessible name. */
        title?: string;
    }

    interface Props {
        /** Unique radio group name. */
        name: string;
        label: string;
        hint?: string;
        value: string;
        options: ReadonlyArray<RowOption>;
        layout?: "segmented" | "stacked";
        /** Optional decorative glyph beside the hidden legend text. */
        groupIcon?: IconName;
        disabled?: boolean;
        onchange: (value: string) => void;
    }

    let { name, label, hint = "", value, options, layout, groupIcon, disabled = false, onchange }: Props = $props();

    const hintId = $derived(`${name}-row-hint`);
</script>

<div class="rr-settings-row">
    <div class="rr-settings-row-copy">
        <span class="rr-settings-row-label">{label}</span>
        {#if hint}<p id={hintId} class="rr-hint">{hint}</p>{/if}
    </div>
    <div class="rr-settings-row-control">
        <ChoiceGroup
            {name}
            {label}
            {value}
            {options}
            {layout}
            {groupIcon}
            {disabled}
            legendHidden
            describedById={hint ? hintId : undefined}
            {onchange}
        />
    </div>
</div>
