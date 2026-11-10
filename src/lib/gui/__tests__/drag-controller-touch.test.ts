// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createListDrag, type DropTarget } from "../drag-controller";

const ROW_H = 120;

function rowRect(top: number): DOMRect {
    const bottom = top + ROW_H;
    return {
        top,
        bottom,
        left: 0,
        right: 200,
        width: 200,
        height: ROW_H,
        x: 0,
        y: top,
        toJSON: () => ({}),
    } as DOMRect;
}

function pointer(type: string, init: PointerEventInit): PointerEvent {
    return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init });
}

function setup() {
    document.body.innerHTML = "";
    const scroller = document.createElement("div");
    scroller.className = "rr-master";
    // * jsdom has no layout; nearestScrollParent reads the inline overflow.
    scroller.style.overflowY = "auto";

    const rows = Array.from({ length: 3 }, (_, index) => {
        const row = document.createElement("div");
        row.className = "rr-master-site";
        row.getBoundingClientRect = () => rowRect(index * ROW_H);
        scroller.appendChild(row);
        return row;
    });
    document.body.appendChild(scroller);

    const handle = document.createElement("button");
    // * jsdom implements PointerEvent but not pointer capture.
    handle.setPointerCapture = vi.fn();
    handle.hasPointerCapture = vi.fn(() => true);
    handle.releasePointerCapture = vi.fn();
    rows[0].appendChild(handle);

    const onHover = vi.fn<(target: DropTarget | null) => void>();
    const onDrop = vi.fn<(fromPos: number, target: DropTarget) => void>();
    const onCancel = vi.fn<() => void>();
    const onEnd = vi.fn<() => void>();
    const controller = createListDrag({
        getItems: () => rows,
        getAnchor: () => scroller,
        onHover,
        onDrop,
        onCancel,
        onEnd,
    });

    // * `start()` resolves the handle from `event.currentTarget` — the listener
    //   must sit on the handle exactly like DragHandle.svelte does it.
    handle.addEventListener("pointerdown", (event) => controller.start(event, 0));

    const fire = (type: string, init: PointerEventInit): PointerEvent => {
        const event = pointer(type, init);
        handle.dispatchEvent(event);
        return event;
    };

    return { rows, handle, fire, controller, onHover, onDrop, onCancel, onEnd };
}

const ghost = (): Element | null => document.querySelector(".rr-drag-floating");

beforeEach(() => {
    let frameId = 0;
    vi.stubGlobal(
        "requestAnimationFrame",
        vi.fn(() => {
            frameId += 1;
            return frameId;
        }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    document.body.className = "";
});

describe("createListDrag — pointer input", () => {
    it("accepts touch and pen input and prevents the compatibility gesture", () => {
        for (const pointerType of ["touch", "pen"]) {
            const drag = setup();
            const down = drag.fire("pointerdown", { pointerType, clientY: 10, button: 0 });

            expect(down.defaultPrevented).toBe(true);
            expect(drag.handle.setPointerCapture).toHaveBeenCalledWith(1);
        }
    });

    it("keeps mouse focus behavior (no preventDefault) and ignores non-primary buttons", () => {
        const left = setup();
        const leftDown = left.fire("pointerdown", { pointerType: "mouse", clientY: 10, button: 0 });
        expect(leftDown.defaultPrevented).toBe(false);
        expect(left.handle.setPointerCapture).toHaveBeenCalledWith(1);

        const right = setup();
        const rightDown = right.fire("pointerdown", { pointerType: "mouse", clientY: 10, button: 2 });
        expect(rightDown.defaultPrevented).toBe(false);
        expect(right.handle.setPointerCapture).not.toHaveBeenCalled();

        right.fire("pointermove", { pointerType: "mouse", clientY: 80, button: 0 });
        expect(ghost()).toBeNull();
        expect(right.onHover).not.toHaveBeenCalled();
    });

    it("activates only after the 4px threshold", () => {
        const drag = setup();
        drag.fire("pointerdown", { pointerType: "touch", clientY: 10 });

        drag.fire("pointermove", { pointerType: "touch", clientY: 12 });
        expect(ghost()).toBeNull();
        expect(drag.onHover).not.toHaveBeenCalled();

        drag.fire("pointermove", { pointerType: "touch", clientY: 40 });
        expect(ghost()).not.toBeNull();
        expect(document.body.classList.contains("rr-dragging")).toBe(true);
        expect(drag.onHover).toHaveBeenLastCalledWith({ pos: 0, insertAfter: false } satisfies DropTarget);
    });

    it("commits the drop on pointerup and cleans up the gesture", () => {
        const drag = setup();
        drag.fire("pointerdown", { pointerType: "touch", clientY: 10 });
        drag.fire("pointermove", { pointerType: "touch", clientY: 200 });
        expect(drag.onHover).toHaveBeenLastCalledWith({ pos: 1, insertAfter: true } satisfies DropTarget);

        drag.fire("pointerup", { pointerType: "touch", clientY: 200 });

        expect(drag.onDrop).toHaveBeenCalledWith(0, { pos: 1, insertAfter: true } satisfies DropTarget);
        expect(drag.onHover).toHaveBeenLastCalledWith(null);
        expect(drag.onCancel).not.toHaveBeenCalled();
        expect(drag.onEnd).toHaveBeenCalledTimes(1);
        expect(ghost()).toBeNull();
        expect(document.body.classList.contains("rr-dragging")).toBe(false);
        expect(drag.handle.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it.each(["pointercancel", "lostpointercapture"])("aborts on %s without committing", (type) => {
        const drag = setup();
        drag.fire("pointerdown", { pointerType: "touch", clientY: 10 });
        drag.fire("pointermove", { pointerType: "touch", clientY: 80 });

        drag.fire(type, { pointerType: "touch", clientY: 80 });

        expect(drag.onCancel).toHaveBeenCalledTimes(1);
        expect(drag.onDrop).not.toHaveBeenCalled();
        expect(drag.onEnd).toHaveBeenCalledTimes(1);
        expect(ghost()).toBeNull();
    });

    it("aborts on Escape without committing", () => {
        const drag = setup();
        drag.fire("pointerdown", { pointerType: "touch", clientY: 10 });
        drag.fire("pointermove", { pointerType: "touch", clientY: 80 });

        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

        expect(drag.onCancel).toHaveBeenCalledTimes(1);
        expect(drag.onDrop).not.toHaveBeenCalled();
        expect(drag.onEnd).toHaveBeenCalledTimes(1);
    });

    it("destroy() aborts an in-flight gesture and releases capture (unmount)", () => {
        const drag = setup();
        drag.fire("pointerdown", { pointerType: "touch", clientY: 10 });
        drag.fire("pointermove", { pointerType: "touch", clientY: 80 });
        expect(ghost()).not.toBeNull();

        drag.controller.destroy();

        expect(drag.onCancel).toHaveBeenCalledTimes(1);
        expect(drag.onDrop).not.toHaveBeenCalled();
        expect(drag.onEnd).toHaveBeenCalledTimes(1);
        expect(ghost()).toBeNull();
        expect(document.body.classList.contains("rr-dragging")).toBe(false);
        expect(drag.handle.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it("ignores a second start while a pointer is active", () => {
        const drag = setup();
        drag.fire("pointerdown", { pointerType: "touch", clientY: 10 });
        drag.fire("pointerdown", { pointerType: "touch", pointerId: 2, clientY: 80 });

        expect(drag.handle.setPointerCapture).toHaveBeenCalledTimes(1);
    });
});
