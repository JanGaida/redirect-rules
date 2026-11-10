<script lang="ts">
    /**
     * InlineCaption — the shared summary caption with a quick description edit.
     *
     * * CONTROLLED: the parent owns which row is editing (`editing` + the
     *   `onEditingChange` callback), so only one caption edits at a time.
     * * Renders `.rr-summary-caption` itself — callers must not wrap it again.
     * * The overlay `<input>` is absolutely positioned by `.rr-summary-desc`
     *   (outward-expanded box), so mounting it never changes the row height.
     * * The draft is seeded ONLY on the false → true transition: typing in a
     *   second editor bound to the same value must not reset an open overlay.
     * * Focus restore: Enter/Escape return focus to the opener row; the blur
     *   commit never does (clicking another row keeps that click's focus).
     * * Clicks/keys never bubble: the caption lives inside `<summary>`, so an
     *   unguarded event would toggle the surrounding disclosure.
     * * Optional `children` render rich content (URL spans); without it the
     *   plain `caption` text is shown.
     */
    import { tick, type Snippet } from "svelte";
    import Icon from "./Icon.svelte";

    interface Props {
        /** Plain label — tooltip and fallback when no `children` are passed. */
        caption: string;
        /** Current description; the overlay seeds its draft from it. */
        value: string;
        /** Open state, owned by the parent. */
        editing: boolean;
        /** Placeholder for an empty description. */
        placeholder?: string;
        /** Tooltip/hint for the overlay field. */
        hint?: string;
        /** Accessible name for the overlay field. */
        ariaLabel?: string;
        /** Accessible name for the caption pencil; omit to hide the pencil. */
        editLabel?: string;
        onEditingChange: (editing: boolean) => void;
        /** Fires with the TRIMMED draft — only when it differs from `value`. */
        onCommit: (value: string) => void;
        /** Optional rich content — replaces the plain caption text when set. */
        children?: Snippet;
    }

    let {
        caption,
        value,
        editing,
        placeholder = "",
        hint = "",
        ariaLabel = "",
        editLabel = "",
        onEditingChange,
        onCommit,
        children,
    }: Props = $props();

    let draft = $state("");
    let inputEl = $state<HTMLInputElement | null>(null);
    let editButtonEl = $state<HTMLButtonElement | null>(null);
    // * Plain flags (not reactive): they only guard the event handlers.
    let wasEditing = false;
    // * Finished overlay (commit/cancel) — the unmount blur must not re-commit.
    let finished = false;
    // * Opener element + restore flag (plain: the effect must not re-subscribe).
    let openerEl: HTMLElement | null = null;
    let restoreFocus = false;

    $effect(() => {
        if (editing && !wasEditing) {
            draft = value;
            finished = false;
            const active = document.activeElement;
            openerEl = active instanceof HTMLElement && active !== document.body ? active : null;
        }
        if (!editing && wasEditing && restoreFocus) {
            restoreFocus = false;
            // * Read `editButtonEl` inside then() to stay out of the tracking.
            void tick().then(() => {
                const target = openerEl?.isConnected ? openerEl : editButtonEl;
                openerEl = null;
                target?.focus();
            });
        }
        wasEditing = editing;
    });

    // * Separate focus effect: it re-runs when the input mounts, but NOT when
    //   `value` changes — a body-editor keystroke must keep the selection.
    // * `tick()` flushes the draft render first, so select() targets the value.
    $effect(() => {
        if (editing && inputEl) {
            const el = inputEl;
            void tick().then(() => {
                el.focus();
                el.select();
            });
        }
    });

    function commit(restore = false): void {
        if (finished) return;
        finished = true;
        restoreFocus = restore;
        const next = draft.trim();
        if (next !== value) onCommit(next);
        onEditingChange(false);
    }

    function cancel(): void {
        if (finished) return;
        finished = true;
        restoreFocus = true;
        onEditingChange(false);
    }
</script>

<span class="rr-summary-caption">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
        class="rr-summary-host"
        title={caption}
        ondblclick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!editing) onEditingChange(true);
        }}
    >
        {#if children}{@render children()}{:else}{caption}{/if}
    </span>
    {#if editLabel}
        <!-- * Touch route: one tap opens the same overlay (dblclick/F2 stay). -->
        <button
            type="button"
            class="rr-caption-edit"
            bind:this={editButtonEl}
            aria-label={editLabel}
            title={editLabel}
            tabindex={editing ? -1 : 0}
            onclick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEditingChange(true);
            }}
        >
            <Icon name="edit" />
        </button>
    {/if}
    {#if editing}
        <!-- * Overlay field: absolute over the caption (height never changes). -->
        <input
            class="rr-input rr-summary-desc"
            autocomplete="off"
            data-bwignore="true"
            data-1p-ignore="true"
            data-lpignore="true"
            data-protonpass-ignore="true"
            data-form-type="other"
            bind:this={inputEl}
            bind:value={draft}
            {placeholder}
            title={hint}
            aria-label={ariaLabel}
            onclick={(e) => e.stopPropagation()}
            ondblclick={(e) => e.stopPropagation()}
            onmousedown={(e) => e.stopPropagation()}
            onkeydown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    commit(true);
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    cancel();
                }
            }}
            onblur={() => commit()}
        />
    {/if}
</span>
