import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* * Brand contract: --rr-brand must equal the app-icon fill (single source).
   The dev console duplicates the tokens, so it is checked too. */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const iconSvg = read("../../../../assets/icons/app/icon.svg");
const dashboardCss = read("../dashboard.css");
const devHtml = read("../../../../index.html");

const BRAND_DECL_RE = /--rr-brand:\s*(#[0-9a-fA-F]{6});/;
const BRAND_COUNT_RE = /--rr-brand:/g;

function declaredBrand(source: string): string | undefined {
    return source.match(BRAND_DECL_RE)?.[1]?.toLowerCase();
}

describe("brand color", () => {
    it("matches the app-icon fill", () => {
        const iconFill = iconSvg.match(/<rect[^>]*fill="(#[0-9a-fA-F]{6})"/)?.[1]?.toLowerCase();

        expect(iconFill).toMatch(/^#[0-9a-f]{6}$/);
        expect(declaredBrand(dashboardCss)).toBe(iconFill);
        expect(declaredBrand(devHtml)).toBe(iconFill);
    });

    it("is declared once per stylesheet (no theme override)", () => {
        expect(dashboardCss.match(BRAND_COUNT_RE)).toHaveLength(1);
        expect(devHtml.match(BRAND_COUNT_RE)).toHaveLength(1);
    });
});
