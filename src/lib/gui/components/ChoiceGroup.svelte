<script lang="ts">
    /**
     * ChoiceGroup — segmented control or stacked radio cards.
     *
     * * Real radios in a fieldset: native arrow-key navigation and an
     *   accessible group name, no custom ARIA.
     * * Callback style (`onchange`) — enum writes stay in the parent.
     * * `describedById` links an external hint (row layouts) while the
     *   internal `hint` keeps its own id.
     */
    import Icon from "./Icon.svelte";
    import type { IconName } from "../icon";

    interface ChoiceOption {
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
        options: ReadonlyArray<ChoiceOption>;
        layout?: "segmented" | "stacked";
        /** Optional decorative glyph beside the legend text. */
        groupIcon?: IconName;
        /** Keep the legend in the DOM but visually hidden (caller renders its own label). */
        legendHidden?: boolean;
        /** External hint element id (row layouts); merged with the internal hint. */
        describedById?: string;
        /** Disables every radio (native semantics); the hint stays visible. */
        disabled?: boolean;
        onchange: (value: string) => void;
    }

    let {
        name,
        label,
        hint = "",
        value,
        options,
        layout = "segmented",
        groupIcon,
        legendHidden = false,
        describedById,
        disabled = false,
        onchange,
    }: Props = $props();

    const hintId = $derived(`${name}-hint`);
    const describedBy = $derived([hint ? hintId : "", describedById ?? ""].filter(Boolean).join(" ") || undefined);
</script>

<fieldset
    class="rr-choice rr-choice--{layout}"
    class:rr-choice--legend-hidden={legendHidden}
    class:rr-choice--disabled={disabled}
    aria-describedby={describedBy}
>
    <legend class="rr-choice-label">
        <span class="rr-choice-legend">
            {#if groupIcon}<Icon name={groupIcon} />{/if}
            {label}
        </span>
    </legend>
    <div class="rr-choice-options">
        {#each options as option (option.value)}
            <label class="rr-choice-option">
                <input
                    class="rr-choice-input"
                    type="radio"
                    {name}
                    value={option.value}
                    checked={value === option.value}
                    {disabled}
                    aria-label={option.title || undefined}
                    onchange={() => onchange(option.value)}
                />
                <span class="rr-choice-surface" title={option.title}>
                    {#if option.icon}<Icon name={option.icon} />{/if}
                    <span class="rr-choice-text">{option.label}</span>
                    {#if layout === "stacked"}<Icon name="check" class="rr-choice-check" />{/if}
                </span>
            </label>
        {/each}
    </div>
    {#if hint}
        <p id={hintId} class="rr-hint">{hint}</p>
    {/if}
</fieldset>
