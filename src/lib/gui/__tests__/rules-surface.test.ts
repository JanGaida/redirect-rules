import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* * CSS tripwire for the Rules-tab surface contract: flat selection surfaces
   (group border / preview-parity rule tint), and the fold tween never reaches
   preview test cases (ADR 0016). */
const css = readFileSync(new URL("../dashboard.css", import.meta.url), "utf8");
const rulesTab = readFileSync(new URL("../tabs/RulesTab.svelte", import.meta.url), "utf8");

function ruleBodies(selector: string): string[] {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((match) => match[1]);
}

describe("rules surface", () => {
    it("gives the open explorer group a brand border only (no glow)", () => {
        const group = ruleBodies(
            ".rr-master > details.rr-master-site[open]:not(.rr-autosave-paused, .rr-drop-target, .rr-drag-ghost)",
        ).join("\n");
        expect(group).toMatch(/border-color:\s*var\(--rr-brand\)/);
        expect(group).not.toMatch(/radial-gradient/);
        expect(group).not.toMatch(/background:/);
        expect(group).not.toMatch(/box-shadow:/);
    });

    it("gives the open rule the preview-parity border + soft fill", () => {
        const openRule = ruleBodies("details.rr-master-rule[open]")[0] ?? "";
        expect(openRule).toMatch(/border-color:\s*var\(--rr-brand\)/);
        expect(openRule).toMatch(/background:\s*var\(--rr-brand-soft\)/);
        expect(openRule).not.toMatch(/radial-gradient/);
        expect(openRule).not.toMatch(/box-shadow/);
    });

    it("keeps the open rule row free of animated background/shadow", () => {
        const rules = ruleBodies(".rr-master-rule");
        const card = rules.find((body) => /background:\s*var\(--rr-master-rule-bg\)/.test(body)) ?? "";
        expect(card).toMatch(/transition:\s*border-color/);
        for (const body of rules) {
            expect(body).not.toMatch(/transition:[^;]*background/);
            expect(body).not.toMatch(/transition:[^;]*box-shadow/);
        }
    });

    it("scopes the fold tween to the explorer (preview rows stay instant)", () => {
        expect(css).toMatch(/\.rr-master > details\.rr-master-site > \.rr-site-shell\s*\{/);
        expect(css).not.toMatch(/(^|\n)details\.rr-master-site > \.rr-site-shell\s*\{/);
        expect(css).not.toMatch(/(^|\n)details\.rr-master-site\[open\] > \.rr-site-shell\s*\{/);
    });
});

describe("group test dot", () => {
    it("maps success, mixed, failed and none to the four status tones", () => {
        expect(ruleBodies(".rr-test-dot--success")[0]).toMatch(/var\(--rr-ok\)/);
        expect(ruleBodies(".rr-test-dot--partial")[0]).toMatch(/var\(--rr-warn\)/);
        expect(ruleBodies(".rr-test-dot--failed")[0]).toMatch(/var\(--rr-danger\)/);
        expect(ruleBodies(".rr-test-dot--none")[0]).toMatch(/var\(--rr-faint\)/);
    });

    it("renders exactly one aggregated dot before the group title", () => {
        const indicatorAt = rulesTab.indexOf("<GroupTestIndicator");
        const captionAt = rulesTab.indexOf("<InlineCaption", indicatorAt);
        expect(indicatorAt).toBeGreaterThan(-1);
        expect(captionAt).toBeGreaterThan(indicatorAt);
        expect(rulesTab.match(/<GroupTestIndicator/g) ?? []).toHaveLength(1);
    });
});
