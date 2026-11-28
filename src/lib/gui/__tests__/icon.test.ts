import { describe, expect, it } from "vitest";

import { icons } from "../icon";

describe("icon registry", () => {
    it("maps every name to an inlined SVG string", () => {
        const entries = Object.entries(icons);

        expect(entries.length).toBeGreaterThan(0);
        for (const [name, svg] of entries) {
            expect(typeof svg, name).toBe("string");
            expect(svg, name).toContain("<svg");
            expect(svg.trim().endsWith("</svg>"), name).toBe(true);
        }
    });

    it("keeps the aliases and glyphs the dashboard relies on", () => {
        for (const name of ["add", "close", "delete", "download", "edit", "undo", "warning", "dataInfoAlert"]) {
            expect(icons[name as keyof typeof icons], name).toBeTruthy();
        }
        expect(icons.delete).toContain("<svg");
        expect(icons.edit).toContain("<svg");
    });
});
