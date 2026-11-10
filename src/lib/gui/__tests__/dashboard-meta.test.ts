// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { ensureViewportMeta } from "../dashboard-meta";

const metas = (): HTMLMetaElement[] => Array.from(document.head.querySelectorAll('meta[name="viewport"]'));

afterEach(() => {
    document.head.innerHTML = "";
});

describe("ensureViewportMeta", () => {
    it("adds a device-width viewport meta when missing", () => {
        ensureViewportMeta(document);

        expect(metas()).toHaveLength(1);
        expect(metas()[0].getAttribute("content")).toBe("width=device-width, initial-scale=1");
    });

    it("updates an existing stale meta instead of appending a second one", () => {
        const stale = document.createElement("meta");
        stale.name = "viewport";
        stale.content = "width=device-width, user-scalable=no";
        document.head.appendChild(stale);

        ensureViewportMeta(document);

        expect(metas()).toHaveLength(1);
        expect(metas()[0]).toBe(stale);
        expect(stale.getAttribute("content")).toBe("width=device-width, initial-scale=1");
    });

    it("is idempotent across repeated boots", () => {
        ensureViewportMeta(document);
        ensureViewportMeta(document);
        ensureViewportMeta(document);

        expect(metas()).toHaveLength(1);
        expect(metas()[0].getAttribute("content")).toBe("width=device-width, initial-scale=1");
    });

    it("does nothing when the document has no head", () => {
        const doc = document.implementation.createHTMLDocument("headless");
        doc.documentElement.removeChild(doc.head);

        expect(() => ensureViewportMeta(doc)).not.toThrow();
        expect(doc.querySelector('meta[name="viewport"]')).toBeNull();
    });
});
