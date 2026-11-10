// ─────────────────────────────────────────────────────────────────────────────
// MARK: Pointer-based list reordering (mouse + touch + pen)
// ─────────────────────────────────────────────────────────────────────────────
// * One controller per list: the row grip starts the drag, the controller owns
//   pointer capture, the floating ghost, autoscroll and the commit callback.
// * Rows keep their DOM order while dragging — the ghost moves, the target row
//   gets the ring. The commit uses the existing `moveIndex` math per surface.
// * Pure geometry lives in `resolveDropPos` (unit-tested).

export interface DropTarget {
    /** Visual position of the hovered row. */
    pos: number;
    /** Drop below the row's midpoint? */
    insertAfter: boolean;
}

export interface ListDragOptions {
    /** Rendered rows in visual order; MUST stay stable for the drag duration. */
    getItems: () => HTMLElement[];
    /** Any element inside the list — the controller walks up to the scroller. */
    getAnchor: () => HTMLElement | null;
    /** Hover target changed (null = no drag / drag ended). */
    onHover: (target: DropTarget | null) => void;
    /** Commit a drop; `fromPos` and `target.pos` are visual positions. */
    onDrop: (fromPos: number, target: DropTarget) => void;
    /** Aborted (Escape, pointercancel, lost capture). */
    onCancel: () => void;
    /** Always fires after a drag gesture, committed or not. */
    onEnd: () => void;
}

export interface ListDragController {
    start: (event: PointerEvent, fromPos: number) => void;
    /** Aborts an in-flight gesture and removes listeners (component unmount). */
    destroy: () => void;
}

const THRESHOLD = 4;
const EDGE = 48;
const MAX_SCROLL = 14;

/** Nearest vertical scroll container (overflow-y auto/scroll), including `from`. */
export function nearestScrollParent(from: HTMLElement | null): HTMLElement | null {
    let node = from;
    while (node) {
        const overflowY = getComputedStyle(node).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") return node;
        node = node.parentElement;
    }
    return null;
}

/**
 * Maps a pointer Y onto a row slot.
 *
 * * Empty list → null; above the first row → before it; below the last → after it.
 * * `insertAfter` flips at the hovered row's vertical midpoint.
 */
export function resolveDropPos(rects: readonly { top: number; bottom: number }[], y: number): DropTarget | null {
    if (rects.length === 0) return null;
    if (y < rects[0].top) return { pos: 0, insertAfter: false };
    for (let pos = 0; pos < rects.length; pos += 1) {
        const rect = rects[pos];
        if (y <= rect.bottom) {
            const midpoint = rect.top + (rect.bottom - rect.top) / 2;
            return { pos, insertAfter: y > midpoint };
        }
    }
    return { pos: rects.length - 1, insertAfter: true };
}

/** Creates the pointer controller for one list surface. */
export function createListDrag(options: ListDragOptions): ListDragController {
    let handle: HTMLElement | null = null;
    let pointerId = -1;
    let startY = 0;
    let pointerY = 0;
    let fromPos = -1;
    let active = false;
    let current: DropTarget | null = null;
    let ghost: HTMLElement | null = null;
    let scroller: HTMLElement | null = null;
    let frame = 0;

    /** Rows in visual order — queried live so a commit re-render cannot stale. */
    function items(): HTMLElement[] {
        return options.getItems();
    }

    /** Recomputes the hovered slot; fires `onHover` only on change. */
    function updateTarget(): void {
        // * Use the visible header row (`summary`), never an open rule's editor
        //   body — otherwise its height would skew the midpoint.
        const rects = items().map((item) => (item.querySelector(":scope > summary") ?? item).getBoundingClientRect());
        const next = resolveDropPos(rects, pointerY);
        if (!next) return;
        if (current?.pos === next.pos && current?.insertAfter === next.insertAfter) return;
        current = next;
        options.onHover(next);
    }

    /** Builds the floating ghost from the dragged row and starts autoscroll. */
    function activate(): void {
        const source = items()[fromPos];
        if (!source) {
            active = false;
            return;
        }
        active = true;
        const anchor = source.querySelector(":scope > summary") ?? source;
        const rect = anchor.getBoundingClientRect();
        scroller = nearestScrollParent(options.getAnchor() ?? source);
        document.body.classList.add("rr-dragging");

        // * Clone the row, force it folded (an open rule would drag its editor),
        //   and pin it to the row's box; `tick` only translates Y.
        const clone = source.cloneNode(true) as HTMLElement;
        if (clone instanceof HTMLDetailsElement) clone.open = false;
        clone.classList.add("rr-drag-floating");
        clone.removeAttribute("data-site");
        clone.removeAttribute("data-rule");
        clone.style.left = `${rect.left}px`;
        clone.style.top = `${rect.top}px`;
        clone.style.width = `${rect.width}px`;
        ghost = clone;
        document.body.append(ghost);
        updateTarget();
        frame = requestAnimationFrame(tick);
    }

    /** Ghost follow + edge autoscroll; re-evaluates the hover after scrolling. */
    function tick(): void {
        if (!active) return;
        if (ghost) ghost.style.transform = `translateY(${pointerY - startY}px)`;
        if (scroller) {
            const rect = scroller.getBoundingClientRect();
            let delta = 0;
            if (pointerY < rect.top + EDGE) {
                delta = -MAX_SCROLL * Math.min(1, (rect.top + EDGE - pointerY) / EDGE);
            } else if (pointerY > rect.bottom - EDGE) {
                delta = MAX_SCROLL * Math.min(1, (pointerY - (rect.bottom - EDGE)) / EDGE);
            }
            if (delta !== 0) {
                scroller.scrollTop += delta;
                updateTarget();
            }
        }
        frame = requestAnimationFrame(tick);
    }

    function onPointerMove(event: PointerEvent): void {
        if (event.pointerId !== pointerId) return;
        pointerY = event.clientY;
        if (!active) {
            if (Math.abs(pointerY - startY) < THRESHOLD) return;
            activate();
        }
        updateTarget();
    }

    /** Removes drag chrome; callbacks run afterwards in `finish`. */
    function teardown(): void {
        if (frame !== 0) cancelAnimationFrame(frame);
        frame = 0;
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("blur", onAbort);
        ghost?.remove();
        ghost = null;
        document.body.classList.remove("rr-dragging");
        scroller = null;
        active = false;
        current = null;
    }

    function finish(commit: boolean): void {
        if (pointerId === -1) return;
        const id = pointerId;
        const from = fromPos;
        const drop = current;
        const wasActive = active;
        const node = handle;
        pointerId = -1;
        if (node) {
            node.removeEventListener("pointermove", onPointerMove);
            node.removeEventListener("pointerup", onPointerUp);
            node.removeEventListener("pointercancel", onAbort);
            node.removeEventListener("lostpointercapture", onAbort);
            if (node.hasPointerCapture(id)) node.releasePointerCapture(id);
        }
        handle = null;
        fromPos = -1;
        teardown();
        if (wasActive && commit && drop) options.onDrop(from, drop);
        else if (wasActive) options.onCancel();
        options.onHover(null);
        options.onEnd();
    }

    function onPointerUp(event: PointerEvent): void {
        if (event.pointerId !== pointerId) return;
        finish(true);
    }

    function onAbort(): void {
        finish(false);
    }

    function onKeyDown(event: KeyboardEvent): void {
        if (event.key === "Escape") finish(false);
    }

    function start(event: PointerEvent, pos: number): void {
        if (pointerId !== -1) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        handle = event.currentTarget as HTMLElement;
        pointerId = event.pointerId;
        startY = event.clientY;
        pointerY = event.clientY;
        fromPos = pos;
        // * Touch/pen must not start a scroll or a compatibility mouse event;
        //   mouse keeps focus behavior.
        if (event.pointerType !== "mouse") event.preventDefault();
        // * Synthetic pointers (tests) are not "active" — capture is best-effort.
        try {
            handle.setPointerCapture(pointerId);
        } catch {
            // * No active pointer (synthetic event) — the handle listeners still work.
        }
        handle.addEventListener("pointermove", onPointerMove);
        handle.addEventListener("pointerup", onPointerUp);
        handle.addEventListener("pointercancel", onAbort);
        handle.addEventListener("lostpointercapture", onAbort);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("blur", onAbort);
    }

    /** Component unmount mid-drag: cancel, release capture, drop listeners. */
    function destroy(): void {
        if (pointerId !== -1) finish(false);
        else teardown();
    }

    return { start, destroy };
}
