<script lang="ts">
    /**
     * DragHandle — the explicit reorder grip for one list row.
     *
     * * ONLY drag origin: rows are no longer draggable as a whole (ADR 0029).
     * * Pointer-based: the controller owns capture, ghost and autoscroll, so
     *   mouse, touch and pen share one path.
     * * Clicks never bubble: the grip lives inside `<summary>`, so an unguarded
     *   click would toggle the surrounding disclosure.
     * * Keyboard: ArrowUp / ArrowDown move the row one visible position.
     */
    import Icon from "./Icon.svelte";

    interface Props {
        /** Accessible action name, e.g. "Reorder rule". */
        label: string;
        /** Short usage hint appended to the native tooltip. */
        hint: string;
        onPointerDown: (e: PointerEvent) => void;
        onMove: (delta: -1 | 1) => void;
    }

    let { label, hint, onPointerDown, onMove }: Props = $props();
</script>

<button
    type="button"
    class="rr-drag-handle"
    aria-label={label}
    aria-keyshortcuts="ArrowUp ArrowDown"
    title={`${label} — ${hint}`}
    onclick={(e) => {
        e.preventDefault();
        e.stopPropagation();
    }}
    onmousedown={(e) => e.stopPropagation()}
    onpointerdown={(e) => onPointerDown(e)}
    onkeydown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        e.stopPropagation();
        onMove(e.key === "ArrowUp" ? -1 : 1);
    }}
>
    <Icon name="dragIndicator" />
</button>
