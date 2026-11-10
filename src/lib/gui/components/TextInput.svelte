<script lang="ts">
    import type { Snippet } from "svelte";
    import { tokenizeRegex } from "../highlight";

    /**
     * TextInput — labeled single-line text input with optional invalid state.
     *
     * * Value is `$bindable` — parents bind into the live store state:
     *   `<TextInput bind:value={site.siteRegex} {invalid} />`.
     * * `value` may be undefined (the appendQuery gate regex is optional) — the
     *   input renders it as empty; the first keystroke writes a real string.
     * * `data-invalid` drives the red border via `dashboard.css`.
     * * `leading` / `trailing` snippets render INSIDE the field's
     *   visual box as absolute affixes: leading = decorative marker (regex
     *   indicator), trailing = interactive actions (escape toggle + manual
     *   trigger). The input reserves the space via the `has-lead`/`has-trail`
     *   modifiers.
     * * Highlight mirror: `highlight="regex"` renders the tokenized
     *   value in a mirror layer BEHIND the transparent input text — same
     *   technique as TextArea, PLUS scroll sync: a single-line input scrolls
     *   horizontally when its content overflows, and the (non-wrapping)
     *   mirror follows via `scrollLeft` on scroll/input events.
     * * `onValueChange` is the bind-free path for optional fields: pass
     *   `value={maybe ?? ""}` and write the raw keystroke value back yourself.
     *   `bind:value` cannot target an `undefined` value (Svelte throws when the
     *   prop has a fallback).
     */
    interface Props {
        value?: string;
        label?: string;
        title?: string;
        placeholder?: string;
        invalid?: boolean;
        leading?: Snippet;
        trailing?: Snippet;
        highlight?: "regex";
        /** Raw field value per keystroke (bind-free usage). */
        onValueChange?: (value: string) => void;
    }

    let {
        value = $bindable(""),
        label = "",
        title = "",
        placeholder = "",
        invalid = false,
        leading = undefined,
        trailing = undefined,
        highlight = undefined,
        onValueChange = undefined,
    }: Props = $props();

    const uid = $props.id();
    let inputEl = $state<HTMLInputElement | null>(null);
    let mirrorEl = $state<HTMLDivElement | null>(null);

    const tokens = $derived(highlight === "regex" ? tokenizeRegex(value ?? "") : null);

    // * Mirror follows the input's internal horizontal scroll (single-line has
    //   no soft wrap — pre in the mirror).
    function syncMirrorScroll(): void {
        if (inputEl && mirrorEl) mirrorEl.scrollLeft = inputEl.scrollLeft;
    }
</script>

<div class="rr-field">
    {#if label}
        <label class="rr-row-label" for={uid} {title}>{label}</label>
    {/if}
    <div class="rr-field-control" class:has-lead={leading} class:has-trail={trailing}>
        {#if leading}
            <span class="rr-input-affix rr-input-affix-lead" aria-hidden="true">{@render leading()}</span>
        {/if}
        {#if tokens}
            <div class="rr-mirror rr-mirror--single" aria-hidden="true" bind:this={mirrorEl}>
                {#each tokens as tok, k (k)}<span class="rh-{tok.kind}">{tok.text}</span>{/each}
            </div>
        {/if}
        <input
            id={uid}
            class="rr-input"
            class:rr-hl={tokens !== null}
            type="text"
            autocomplete="off"
            data-bwignore="true"
            data-1p-ignore="true"
            data-lpignore="true"
            data-protonpass-ignore="true"
            data-form-type="other"
            bind:value
            bind:this={inputEl}
            onscroll={syncMirrorScroll}
            oninput={(event) => {
                syncMirrorScroll();
                onValueChange?.(event.currentTarget.value);
            }}
            title={title || undefined}
            placeholder={placeholder || undefined}
            aria-label={label || title || undefined}
            data-invalid={invalid}
            aria-invalid={invalid}
        />
        {#if trailing}
            <div class="rr-input-affix rr-input-affix-trail">{@render trailing()}</div>
        {/if}
    </div>
</div>
