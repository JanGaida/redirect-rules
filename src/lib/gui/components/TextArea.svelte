<script lang="ts">
    import type { Snippet } from "svelte";
    import { autogrow } from "./autogrow";
    import { tokenizeRegex, tokenizeSubstitution } from "../highlight";

    /**
     * TextArea — labeled multiline field with progressive autogrow.
     *
     * * Regex/substitution/params in the inline rule editor become
     *     multiline-capable: long patterns wrap instead of overflowing. Height
     *     follows the content (autogrow action); the explorer column owns the
     *     scrollbar.
     * * Class keeps `rr-input` so the `.rr-master-rule[open] .rr-input` E2E
     *     order contract survives the input→textarea swap (`fill()` works on
     *     textareas).
     * * Value is `$bindable` — parents bind into the live store state, exactly
     *     like TextInput. `value` may be undefined (appendQuery gate regex).
     * * `leading` / `trailing` snippets render INSIDE the field (affix
     *     overlays) — multiline variant: both align with the FIRST line
     *     (`rr-field-control-multi`), so autogrow never drifts them vertically.
     * * Highlight mirror: `highlight="regex"` tokenizes the value as
     *     /pattern/flags regex, `"substitution"` as a getSubstitution template.
     *     The colored tokens render in an absolutely positioned mirror BEHIND
     *     the input (`pointer-events: none`), whose own text turns transparent
     *     (`rr-hl`) — the mirror's padding/font/wrap metrics match the field
     *     exactly (see `.rr-mirror` in dashboard.css). Autogrow fields never
     *     scroll internally, so NO scroll sync is needed here.
     */
    interface Props {
        value?: string;
        label?: string;
        title?: string;
        placeholder?: string;
        invalid?: boolean;
        /** Id of an externally rendered visible label (grid label column). */
        ariaLabelledby?: string;
        leading?: Snippet;
        trailing?: Snippet;
        highlight?: "regex" | "substitution";
    }

    let {
        value = $bindable(""),
        label = "",
        title = "",
        placeholder = "",
        invalid = false,
        ariaLabelledby = undefined,
        leading = undefined,
        trailing = undefined,
        highlight = undefined,
    }: Props = $props();

    const uid = $props.id();

    // * Tokens recompute on every keystroke ($derived over $bindable) — the
    //   tokenizer is linear and throw-free, so the dock stays snappy.
    const tokens = $derived.by(() => {
        if (highlight === "regex") return tokenizeRegex(value ?? "");
        if (highlight === "substitution") return tokenizeSubstitution(value ?? "");
        return null;
    });
</script>

<div class="rr-field">
    {#if label}
        <label class="rr-row-label" for={uid} {title}>{label}</label>
    {/if}
    <div class="rr-field-control rr-field-control-multi" class:has-lead={leading} class:has-trail={trailing}>
        {#if leading}
            <span class="rr-input-affix rr-input-affix-lead" aria-hidden="true">{@render leading()}</span>
        {/if}
        {#if tokens}
            <!-- * Highlight mirror: renders the SAME text (round-trip-pinned by
                 tests) split into colored spans. aria-hidden + pointer-events
                 none — decoration only, the textarea keeps full semantics. -->
            <div class="rr-mirror" aria-hidden="true">
                {#each tokens as tok, k (k)}<span class="rh-{tok.kind}">{tok.text}</span>{/each}
            </div>
        {/if}
        <textarea
            id={uid}
            class="rr-input rr-textarea"
            class:rr-hl={tokens !== null}
            rows="1"
            spellcheck="false"
            wrap="soft"
            autocomplete="off"
            data-bwignore="true"
            data-1p-ignore="true"
            data-lpignore="true"
            data-protonpass-ignore="true"
            data-form-type="other"
            bind:value
            title={title || undefined}
            placeholder={placeholder || undefined}
            aria-label={ariaLabelledby ? undefined : label || title || undefined}
            aria-labelledby={ariaLabelledby || undefined}
            data-invalid={invalid}
            aria-invalid={invalid}
            use:autogrow></textarea>
        {#if trailing}
            <div class="rr-input-affix rr-input-affix-trail">{@render trailing()}</div>
        {/if}
    </div>
</div>
