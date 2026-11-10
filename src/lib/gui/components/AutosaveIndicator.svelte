<script lang="ts">
    /**
     * AutosaveIndicator — the header's autosave glyph slot.
     *
     * * Occupies the same leading position as the success checkmark: pending
     *   draws a small clockwise ring, paused a full amber ring, applied a ✓.
     * * `{#key pendingSeq}` restarts the CSS animation on every re-arm; the
     *   rail speed pill deliberately carries NO progress animation.
     */
    import { autosave } from "../autosave.svelte";

    const paused = $derived(autosave.phase === "paused");
    const pending = $derived(autosave.phase === "pending");

    /** Ring geometry — 14px box, 1.5px stroke. */
    const RING_RADIUS = 5.5;
    const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
</script>

<span class="rr-status-indicator" class:rr-status-indicator--paused={paused} aria-hidden="true">
    {#if pending || paused}
        {#key autosave.pendingSeq}
            <svg
                class="rr-status-ring"
                viewBox="0 0 14 14"
                style={`--rr-autosave-duration:${autosave.pendingDelayMs}ms;--rr-autosave-circumference:${RING_CIRCUMFERENCE}`}
            >
                <circle class="rr-status-ring-track" cx="7" cy="7" r={RING_RADIUS} />
                <circle class="rr-status-ring-progress" cx="7" cy="7" r={RING_RADIUS} />
            </svg>
        {/key}
    {:else}
        <span class="rr-status-check">✓</span>
    {/if}
</span>
