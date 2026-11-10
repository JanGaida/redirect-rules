import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* * Touch contract tripwire (ADR 0032). Textual assertions only — jsdom has no
   layout, so this pins the tokens and the shared field metric, not geometry. */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const css = read("../dashboard.css");

function ruleBodies(selector: string): string[] {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((match) => match[1]);
}

function hasRule(selector: string, declaration: RegExp): boolean {
    return ruleBodies(selector).some((body) => declaration.test(body));
}

const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const coarseBlock = css.match(/@media \(any-pointer: coarse\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

function pxToken(source: string, name: string): number | undefined {
    const match = source.match(new RegExp(`${name}:\\s*(\\d+)px`));
    return match ? Number(match[1]) : undefined;
}

describe("touch CSS contract", () => {
    it("raises tap targets through --rr-tap-min", () => {
        expect(pxToken(rootBlock, "--rr-tap-min")).toBeGreaterThanOrEqual(24);
        expect(pxToken(coarseBlock, "--rr-tap-min")).toBeGreaterThanOrEqual(32);

        expect(css).toMatch(/min-width:\s*var\(--rr-tap-min\)/);
        expect(css).toMatch(/min-height:\s*var\(--rr-tap-min\)/);
        expect(css).toMatch(/\.rr-actions \.rr-btn/);
        expect(css).toMatch(/\.rr-affix-btn/);
        expect(css).toMatch(/\.rr-info-trigger/);
        // * Popover header: the close button reaches the tap floor on its own.
        expect(hasRule(".rr-info-pop-close", /width:\s*var\(--rr-tap-min\)/)).toBe(true);
        // * Transfer dialog: 16px checkbox glyph inside a 24px layout cell; the
        //   accordion toggles carry the tap floor themselves.
        expect(hasRule(".rr-transfer-check", /inline-size:\s*16px/)).toBe(true);
        expect(hasRule(".rr-transfer-row", /grid-template-columns:[^;]*var\(--rr-tap-min\)/)).toBe(true);
        expect(hasRule(".rr-transfer-section-toggle", /min-height:\s*var\(--rr-tap-min\)/)).toBe(true);
        expect(hasRule(".rr-transfer-group-toggle", /min-height:\s*var\(--rr-tap-min\)/)).toBe(true);
        // * Assistant: primary action and the integrated site-group select.
        expect(hasRule(".rr-asst-primary", /min-height:\s*var\(--rr-tap-min\)/)).toBe(true);
        expect(hasRule(".rr-asst-select", /min-height:\s*var\(--rr-tap-min\)/)).toBe(true);
    });

    it("grows the splitter rail on coarse pointers while keeping the grip draggable", () => {
        expect(pxToken(rootBlock, "--rr-grip-w")).toBe(14);
        expect(pxToken(coarseBlock, "--rr-grip-w")).toBe(28);
        expect(rootBlock).toMatch(/--rr-explorer-w:\s*calc\(50% - var\(--rr-grip-w\) \/ 2\)/);
        expect(hasRule(".rr-master-detail", /grid-template-columns:[^;]*var\(--rr-grip-w\)/)).toBe(true);

        expect(hasRule(".rr-drag-handle", /touch-action:\s*none/)).toBe(true);
        expect(hasRule(".rr-drag-v", /touch-action:\s*none/)).toBe(true);
    });

    it("scopes the coarse-pointer field size to one shared token", () => {
        expect(rootBlock).toMatch(/--rr-field-fs:\s*0\.95em/);
        expect(coarseBlock).toMatch(/--rr-field-fs:\s*16px/);

        const inputRule = css.match(/\.rr-input,\s*\.rr-textarea\s*\{([^}]*)\}/)?.[1] ?? "";
        expect(inputRule).toMatch(/font-size:\s*var\(--rr-field-fs\)/);
        expect(inputRule).not.toMatch(/0\.95em/);
        expect(hasRule(".rr-mirror", /font-size:\s*var\(--rr-field-fs\)/)).toBe(true);
        expect(hasRule(".rr-input-affix-lead", /font-size:\s*var\(--rr-field-fs\)/)).toBe(true);
    });

    it("scopes the URL-panel surface to site-gate and rule-editor fields", () => {
        expect(rootBlock).toMatch(/--rr-editor-field-fs:\s*var\(--rr-fs-sm\)/);
        expect(coarseBlock).toMatch(/--rr-editor-field-fs:\s*16px/);

        const scopedField = ":is(.rr-site-gate .rr-input, .rr-master-rule-body .rr-ed-fields .rr-textarea)";
        expect(hasRule(scopedField, /box-sizing:\s*border-box/)).toBe(true);
        expect(hasRule(scopedField, /background:\s*var\(--rr-editor-field-bg\)/)).toBe(true);
        expect(hasRule(scopedField, /padding:\s*var\(--rr-editor-field-pad\)/)).toBe(true);
        expect(hasRule(scopedField, /font-size:\s*var\(--rr-editor-field-fs\)/)).toBe(true);
        expect(hasRule(scopedField, /line-height:\s*var\(--rr-editor-field-line-height\)/)).toBe(true);
        expect(hasRule(scopedField, /box-shadow:\s*var\(--rr-editor-field-shadow\)/)).toBe(true);

        expect(hasRule(`${scopedField}:focus-visible`, /box-shadow:\s*0 0 0 3px var\(--rr-ring\)/)).toBe(true);

        const invalidFocus = `${scopedField}[data-invalid="true"]:focus-visible`;
        expect(hasRule(invalidFocus, /border-color:\s*var\(--rr-danger\)/)).toBe(true);
        expect(hasRule(invalidFocus, /box-shadow:\s*0 0 0 3px var\(--rr-danger-soft\)/)).toBe(true);

        const mirrorSelector = ":is(.rr-site-gate .rr-mirror, .rr-master-rule-body .rr-ed-fields .rr-mirror)";
        expect(hasRule(mirrorSelector, /font-size:\s*var\(--rr-editor-field-fs\)/)).toBe(true);

        const affixSelector =
            ":is(.rr-site-gate .rr-input-affix-lead, .rr-master-rule-body .rr-ed-fields .rr-input-affix-lead)";
        expect(hasRule(affixSelector, /font-size:\s*var\(--rr-editor-field-fs\)/)).toBe(true);
        // * Static-prefix rail: own surface + crisp divider, never a button.
        expect(hasRule(affixSelector, /background:\s*var\(--rr-panel-2\)/)).toBe(true);
        expect(hasRule(affixSelector, /border-right-color:\s*var\(--rr-border-strong\)/)).toBe(true);

        // * Global leakage guard: the base field rule keeps the base token.
        const baseRule = css.match(/\.rr-input,\s*\.rr-textarea\s*\{([^}]*)\}/)?.[1] ?? "";
        expect(baseRule).toMatch(/font-size:\s*var\(--rr-field-fs\)/);
        expect(baseRule).not.toMatch(/--rr-editor-field-fs/);
    });

    it("bounds and scrolls the popover body on short viewports", () => {
        expect(hasRule(".rr-pop", /max-height:/)).toBe(true);
        expect(hasRule(".rr-info-pop[popover]", /overflow:\s*hidden/)).toBe(true);
        expect(hasRule(".rr-info-pop-body", /overflow-y:\s*auto/)).toBe(true);
        expect(hasRule(".rr-info-pop-body", /overscroll-behavior:\s*contain/)).toBe(true);
        expect(hasRule(".rr-info-pop.has-size[popover]", /max-height:\s*none/)).toBe(true);
    });

    it("animates reference popovers in and out without a display snap", () => {
        // * Closed base state + discrete display/overlay hand-off keeps the box
        //   rendered for the exit transition instead of hiding it immediately.
        expect(hasRule(".rr-info-pop[popover]", /opacity:\s*0/)).toBe(true);
        expect(hasRule(".rr-info-pop[popover]", /allow-discrete/)).toBe(true);
        expect(hasRule(".rr-info-pop:popover-open", /opacity:\s*1/)).toBe(true);
        // * The popover starts `display:none`, so the entry frame needs
        //   `@starting-style`; reduced motion drops the transition.
        expect(css).toMatch(/@starting-style\s*\{\s*\.rr-info-pop:popover-open/);
        expect(css).toMatch(
            /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.rr-info-pop\[popover\]\s*\{\s*transition:\s*none;/,
        );
    });

    it("makes the whole popover header a touch-safe drag surface", () => {
        expect(hasRule(".rr-info-pop-head", /touch-action:\s*none/)).toBe(true);
        expect(hasRule(".rr-info-pop-head", /user-select:\s*none/)).toBe(true);
        expect(hasRule(".rr-info-pop-head.is-dragging", /cursor:\s*grabbing/)).toBe(true);
    });

    it("keeps the popover stretch grip touch-safe", () => {
        expect(hasRule(".rr-info-pop-resize", /touch-action:\s*none/)).toBe(true);
        expect(hasRule(".rr-info-pop-resize", /cursor:\s*nwse-resize/)).toBe(true);
        expect(hasRule(".rr-info-pop-resize", /width:\s*var\(--rr-tap-min\)/)).toBe(true);
    });

    it("uses dynamic viewport height with a static fallback", () => {
        expect(hasRule(".rr-dashboard", /height:\s*100%/)).toBe(true);
        expect(hasRule(".rr-dashboard", /height:\s*100dvh/)).toBe(true);
    });

    it("removes the double-tap delay from tappable chrome", () => {
        expect(css).toMatch(/touch-action:\s*manipulation/);
        expect(hasRule(".rr-master-rule-summary", /touch-action:\s*manipulation/)).toBe(true);
        expect(css).toMatch(/\.rr-group-summary,[^{}]*\{[^}]*touch-action:\s*manipulation/);
    });
});
