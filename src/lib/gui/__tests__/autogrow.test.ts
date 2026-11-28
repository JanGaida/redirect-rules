// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { autogrow } from "../components/autogrow";

function textarea(initialHeight: number): { node: HTMLTextAreaElement; setScrollHeight: (value: number) => void } {
    const node = document.createElement("textarea");
    let scrollHeight = initialHeight;
    Object.defineProperty(node, "scrollHeight", { configurable: true, get: () => scrollHeight });
    return { node, setScrollHeight: (value) => (scrollHeight = value) };
}

describe("autogrow", () => {
    it("grows to the current scroll height on attach", () => {
        const { node } = textarea(42);

        autogrow(node);

        expect(node.style.height).toBe("42px");
    });

    it("regrows on input and change", () => {
        const { node, setScrollHeight } = textarea(42);
        autogrow(node);

        setScrollHeight(80);
        node.dispatchEvent(new Event("input"));
        expect(node.style.height).toBe("80px");

        setScrollHeight(120);
        node.dispatchEvent(new Event("change"));
        expect(node.style.height).toBe("120px");
    });

    it("stops listening after destroy", () => {
        const { node, setScrollHeight } = textarea(42);
        const action = autogrow(node);

        action.destroy();
        setScrollHeight(200);
        node.dispatchEvent(new Event("input"));
        node.dispatchEvent(new Event("change"));

        expect(node.style.height).toBe("42px");
    });
});
