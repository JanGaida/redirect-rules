<script lang="ts">
    /**
     * InfoPopover — shared field trigger + anchored reference popover.
     *
     * * Trigger sits in the field's trailing affix; the popover is a non-modal
     *   dialog in the browser's TOP LAYER (native Popover API), so the tab panel's
     *   `contain`/`transform` and the explorer scroll cannot clip it.
     * * Placement: two-column layout (> 1100px) anchors to the preview column's
     *   left edge, top-aligned to the trigger; the stacked layout opens below the
     *   trigger and flips above when space runs out.
     * * `uiState.popover` stays the single-slot truth. Identity is `popoverKey`,
     *   not the visual `variant`: every folded site group keeps its gate trigger
     *   in the DOM, so site keys are unique (`siteManual:<index>`). A shared key
     *   would make all gates call `showPopover()` and auto-close each other.
     * * The native `toggle` event syncs the slot, so ESC/light-dismiss and App's
     *   close order stay coherent.
     * * Direct switches (rule manual → site manual) keep the newcomer open: the
     *   old close never clears a slot whose newcomer is already open, and the
     *   hide effect defers one frame.
     * * The trigger is SHOW-only (`popovertargetaction="show"`): a second click
     *   keeps an open panel open instead of toggling it closed. Close via the
     *   header button, ESC, or light dismiss.
     * * The click handler OWNS the open: the native invoker shows the panel
     *   before its queued `toggle` event runs, which paints one frame at the
     *   static position. Placing it while still closed avoids that jump; the
     *   entry/exit fade lives in CSS (`@starting-style` + `allow-discrete`).
     * * The WHOLE header is the drag surface (mouse/touch/pen; buttons excluded);
     *   the grip is a visual affordance. The bottom-right corner stretches the
     *   panel from a per-variant minimum width up to the viewport. Drag position
     *   and stretched size stick for this open session and reset on close.
     * * The body is caller-supplied (`children`) — token rows or the manual.
     */
    import { tick, type Snippet } from "svelte";
    import { t } from "../i18n.svelte";
    import { uiState, type PopoverKey } from "../ui-state.svelte";
    import Icon from "./Icon.svelte";

    /** Visual family (width/padding). Identity is `popoverKey`. */
    type PopoverVariant = "tokens" | "manual";

    interface Props {
        popoverKey: PopoverKey;
        variant: PopoverVariant;
        triggerLabel: string;
        triggerHint: string;
        title: string;
        lead?: string;
        maxWidth?: number;
        children: Snippet;
    }

    let { popoverKey, variant, triggerLabel, triggerHint, title, lead, maxWidth = 460, children }: Props = $props();

    // * Mirrors `.rr-master-detail`'s @media (max-width: 1100px) breakpoint.
    const STACKED_QUERY = "(max-width: 1100px)";
    const GAP = 8;
    const MARGIN = 8;
    const MIN_SIDE_WIDTH = 320;
    // * Large-enough stretch floor: the manual keeps its dense two-column table.
    const MIN_WIDTH = $derived(variant === "manual" ? 640 : 420);
    const MIN_HEIGHT = 240;

    // * ! Random salt per instance: if a Vite dashboard and an installed
    //   userscript both run, each bundle restarts `$props.id()` at the same
    //   counter → identical popover ids would cross-wire `popovertarget`.
    const idSalt = Math.random().toString(36).slice(2, 8);
    const uid = $props.id();
    const popId = `rr-info-popover-${idSalt}-${uid}`;
    const titleId = `${popId}-title`;
    const leadId = `${popId}-lead`;

    const open = $derived(uiState.popover === popoverKey);

    // * Lazy body: folded groups keep their trigger, not a full manual table.
    let bodyMounted = $state(false);

    let triggerEl = $state<HTMLElement | null>(null);
    let popEl = $state<HTMLElement | null>(null);

    // * Drag-to-move: null = anchored placement; set while the user drags.
    let dragPos = $state<{ left: number; top: number } | null>(null);
    let dragStart: { x: number; y: number; left: number; top: number } | null = null;
    let dragging = $state(false);

    // * Stretch-to-resize: null = variant default width/height.
    let size = $state<{ width: number; height: number } | null>(null);
    let resizeStart: { x: number; y: number; width: number; height: number; left: number; top: number } | null = null;
    let resizing = $state(false);

    function close(): void {
        dragPos = null;
        size = null;
        uiState.popover = null;
        triggerEl?.focus();
    }

    function onDragStart(event: PointerEvent): void {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        // * Close (and any future header control) keeps its own click.
        const target = event.target as Element | null;
        if (target?.closest("button, a, input, select, textarea")) return;

        const el = popEl;
        if (!el) return;
        event.preventDefault();
        // * Synthetic pointers (tests) are not "active" — capture is best-effort.
        try {
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        } catch {
            // * No active pointer — the header listeners still work.
        }
        const rect = el.getBoundingClientRect();
        dragStart = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
        dragging = true;
    }

    function onDragMove(event: PointerEvent): void {
        const el = popEl;
        if (!dragging || dragStart === null || !el) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const left = Math.min(
            Math.max(dragStart.left + event.clientX - dragStart.x, MARGIN),
            vw - el.offsetWidth - MARGIN,
        );
        const top = Math.min(
            Math.max(dragStart.top + event.clientY - dragStart.y, MARGIN),
            vh - el.offsetHeight - MARGIN,
        );
        dragPos = { left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) };
        el.style.left = `${dragPos.left}px`;
        el.style.top = `${dragPos.top}px`;
    }

    function onDragEnd(event: PointerEvent): void {
        if (!dragging) return;
        dragging = false;
        dragStart = null;
        const handle = event.currentTarget as HTMLElement;
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    }

    function onResizeStart(event: PointerEvent): void {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const el = popEl;
        if (!el) return;
        event.preventDefault();
        try {
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        } catch {
            // * No active pointer — the grip listeners still work.
        }
        const rect = el.getBoundingClientRect();
        resizeStart = {
            x: event.clientX,
            y: event.clientY,
            width: rect.width,
            height: rect.height,
            left: rect.left,
            top: rect.top,
        };
        resizing = true;
    }

    function onResizeMove(event: PointerEvent): void {
        const el = popEl;
        if (!resizing || resizeStart === null || !el) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const minW = Math.min(MIN_WIDTH, vw - 2 * MARGIN);
        const minH = Math.min(MIN_HEIGHT, vh - 2 * MARGIN);
        const maxW = Math.max(minW, vw - resizeStart.left - MARGIN);
        const maxH = Math.max(minH, vh - resizeStart.top - MARGIN);
        const width = Math.min(Math.max(resizeStart.width + event.clientX - resizeStart.x, minW), maxW);
        const height = Math.min(Math.max(resizeStart.height + event.clientY - resizeStart.y, minH), maxH);
        size = { width, height };
        el.style.width = `${width}px`;
        el.style.height = `${height}px`;
    }

    function onResizeEnd(event: PointerEvent): void {
        if (!resizing) return;
        resizing = false;
        resizeStart = null;
        const grip = event.currentTarget as HTMLElement;
        if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
    }

    /**
     * Opens after placement — never let the UA paint the panel at its static
     * position first. The native invoker is cancelled; `showPopover()` follows
     * through the shared slot effect so ESC/light-dismiss state stays coherent.
     */
    async function onTriggerClick(event: MouseEvent): Promise<void> {
        const el = popEl;
        if (!el) return;
        event.preventDefault();
        // * SHOW-only contract: re-clicking an open panel never closes it.
        if (el.matches(":popover-open")) return;
        dragPos = null;
        size = null;
        // * First open: mount the body before placement measures the panel.
        if (!bodyMounted) {
            bodyMounted = true;
            await tick();
        }
        if (!el.isConnected) return;
        position();
        if (uiState.popover === popoverKey) {
            // * Slot already owns it (e.g. after a remount) — no effect rerun.
            try {
                el.showPopover();
            } catch {
                // * Detached/unmounting element — nothing to show.
            }
            return;
        }
        uiState.popover = popoverKey;
    }

    /** Native popover state → the shared single-slot flag (and back). */
    function onToggle(event: Event): void {
        const el = event.currentTarget as HTMLElement;
        if (el.matches(":popover-open")) {
            bodyMounted = true;
            uiState.popover = popoverKey;
            // * Fallback for a browser-driven open (invoker not cancelled).
            position();
        } else {
            const otherOpen = document.querySelector(":popover-open");
            if (uiState.popover === popoverKey) {
                // * Direct switch (e.g. rule manual → site manual): the UA opens the
                //   newcomer BEFORE the old toggle fires. Keep the newcomer's slot —
                //   clearing it here would make the new popover hide immediately.
                if (otherOpen !== null) return;
                dragPos = null;
                size = null;
                uiState.popover = null;
            }
        }
    }

    // * ESC must not reach App's dashboard-close flow after we clear the slot.
    function onKeydown(event: KeyboardEvent): void {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
    }

    /** Places the popover next to the trigger (preview column or below it). */
    function position(): void {
        const el = popEl;
        const trigger = triggerEl;
        if (!el || !trigger) return;

        // * A closed popover is `display:none` and unmeasurable. Lay it out
        //   invisibly in this task so width/height/flip math runs before
        //   `showPopover()`; the hidden box never paints.
        const wasOpen = el.matches(":popover-open");
        if (!wasOpen) {
            el.style.display = "block";
            el.style.visibility = "hidden";
        }

        try {
            const rect = trigger.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const stacked = window.matchMedia(STACKED_QUERY).matches;
            const preview = stacked
                ? null
                : trigger.closest(".rr-master-detail")?.querySelector<HTMLElement>(".rr-preview-zone");
            const previewRect = preview?.getBoundingClientRect();
            const sideBySide = previewRect !== undefined && previewRect.width - 2 * MARGIN >= MIN_SIDE_WIDTH;
            const previewWidth = previewRect?.width ?? 0;

            // * Width first — the height depends on the resulting line wrap.
            const minWidth = Math.min(MIN_WIDTH, vw - 2 * MARGIN);
            const initialWidth = sideBySide
                ? Math.min(maxWidth, previewWidth - 2 * MARGIN)
                : Math.min(maxWidth, vw - 2 * MARGIN);
            const anchorLeft =
                dragPos !== null ? dragPos.left : sideBySide && previewRect ? previewRect.left + MARGIN : rect.left;
            // * A stretched panel stops at the viewport edge, never below the floor.
            const maxWidthHere = Math.max(MIN_SIDE_WIDTH, vw - Math.max(MARGIN, anchorLeft) - MARGIN);
            const width = Math.min(
                Math.max(size?.width ?? initialWidth, Math.min(minWidth, maxWidthHere)),
                maxWidthHere,
            );
            el.style.width = `${width}px`;

            if (size) {
                const minHeight = Math.min(MIN_HEIGHT, vh - 2 * MARGIN);
                el.style.height = `${Math.min(Math.max(size.height, minHeight), vh - 2 * MARGIN)}px`;
            } else {
                el.style.height = "";
            }

            // * A user-dragged panel keeps its position across scroll/resize.
            if (dragPos !== null) {
                const left = Math.min(Math.max(dragPos.left, MARGIN), vw - width - MARGIN);
                const top = Math.min(Math.max(dragPos.top, MARGIN), vh - el.offsetHeight - MARGIN);
                el.style.left = `${Math.max(MARGIN, left)}px`;
                el.style.top = `${Math.max(MARGIN, top)}px`;
                return;
            }

            const left =
                sideBySide && previewRect
                    ? previewRect.left + MARGIN
                    : Math.min(Math.max(rect.left, MARGIN), vw - width - MARGIN);

            let top = sideBySide ? Math.max(MARGIN, rect.top) : rect.bottom + GAP;
            const height = el.offsetHeight;
            if (top + height > vh - MARGIN) {
                top = sideBySide ? Math.max(MARGIN, vh - height - MARGIN) : Math.max(MARGIN, rect.top - height - GAP);
            }
            top = Math.max(MARGIN, top);

            el.style.left = `${left}px`;
            el.style.top = `${top}px`;
        } finally {
            if (!wasOpen) {
                el.style.display = "";
                el.style.visibility = "";
            }
        }
    }

    // * Keep the top-layer state and the shared slot in sync. Native invoker and
    //   external slot changes (tab switch, locale menu) both land here.
    $effect(() => {
        const el = popEl;
        if (!el) return;
        const want = uiState.popover === popoverKey;
        const isOpen = el.matches(":popover-open");
        if (want && !isOpen) {
            bodyMounted = true;
            try {
                el.showPopover();
            } catch {
                // * Detached/unmounting element — nothing to show.
            }
        } else if (!want && isOpen) {
            dragPos = null;
            size = null;
            // * Defer the hide: a direct switch (rule → site manual) lets the UA
            //   open the newcomer BEFORE the old close event lands. Hiding in
            //   this effect would make the new panel flicker and close.
            requestAnimationFrame(() => {
                if (!el.isConnected || !el.matches(":popover-open")) return;
                if (uiState.popover === popoverKey) return;
                el.hidePopover();
            });
        }
    });

    // * Open UI: measure (width → height → offsets), then take focus once.
    $effect(() => {
        const el = popEl;
        if (!el || !open) return;
        requestAnimationFrame(() => {
            if (!el.isConnected || uiState.popover !== popoverKey) return;
            position();
            el.focus({ preventScroll: true });
        });
    });

    // * Reposition while open: capture-phase scroll catches `.rr-master`, and the
    //   observer tracks the split grip (CSS-variable drag fires no window resize).
    $effect(() => {
        if (!open) return;
        const trigger = triggerEl;
        if (!trigger) return;
        const reposition = () => position();
        window.addEventListener("scroll", reposition, true);
        window.addEventListener("resize", reposition);
        const observer = new ResizeObserver(reposition);
        const detail = trigger.closest(".rr-master-detail");
        const preview = detail?.querySelector<HTMLElement>(".rr-preview-zone");
        if (detail) observer.observe(detail);
        if (preview) observer.observe(preview);
        return () => {
            window.removeEventListener("scroll", reposition, true);
            window.removeEventListener("resize", reposition);
            observer.disconnect();
        };
    });

    // * A collapsed/switched rule removes the trigger — never leave a ghost slot.
    $effect(() => () => {
        if (uiState.popover === popoverKey) uiState.popover = null;
    });
</script>

<button
    bind:this={triggerEl}
    type="button"
    class="rr-btn rr-btn-compact rr-info-trigger"
    aria-label={triggerLabel}
    title={triggerHint}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls={popId}
    popovertarget={popId}
    popovertargetaction="show"
    onclick={onTriggerClick}
>
    <Icon name="info" />
</button>

<div
    bind:this={popEl}
    id={popId}
    class="rr-pop rr-info-pop rr-info-pop--{variant}"
    class:has-size={size !== null}
    popover="auto"
    role="dialog"
    aria-modal="false"
    aria-labelledby={titleId}
    aria-describedby={lead ? leadId : undefined}
    tabindex="-1"
    ontoggle={onToggle}
    onkeydown={onKeydown}
>
    <!-- svelte-ignore a11y_no_static_element_interactions -- pointer-only drag surface; the close button keeps its own click -->
    <div
        class="rr-info-pop-head"
        class:is-dragging={dragging}
        onpointerdown={onDragStart}
        onpointermove={onDragMove}
        onpointerup={onDragEnd}
        onpointercancel={onDragEnd}
    >
        <span class="rr-info-pop-drag" aria-hidden="true"><Icon name="dragIndicator" /></span>
        <span class="rr-info-pop-icon"><Icon name="info" /></span>
        <p class="rr-info-pop-title" id={titleId}>{title}</p>
        <button
            class="rr-info-pop-close"
            type="button"
            aria-label={t("common.close")}
            title={t("common.close")}
            onclick={close}
        >
            <Icon name="close" />
        </button>
    </div>
    {#if lead}<p class="rr-info-pop-lead" id={leadId}>{lead}</p>{/if}
    {#if bodyMounted}
        <div class="rr-info-pop-body">{@render children()}</div>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -- pointer-only stretch grip -->
    <span
        class="rr-info-pop-resize"
        class:is-resizing={resizing}
        aria-hidden="true"
        onpointerdown={onResizeStart}
        onpointermove={onResizeMove}
        onpointerup={onResizeEnd}
        onpointercancel={onResizeEnd}
    ></span>
</div>
