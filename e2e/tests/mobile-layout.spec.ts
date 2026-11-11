import { expect, test } from "@playwright/test";
import { openDashboardTab } from "../helpers/dashboard";
import { injectUserscript, openFixtureWithUserscript } from "../helpers/userscript";

/**
 * Mobile layout contract (ADR 0045) — bottom bar, header utilities, phone pane
 * switch and the horizontal split grip.
 *
 * * Firefox has no real safe-area insets and no virtual keyboard; the touch
 *   contract for those stays a CSS tripwire (touch-contract.test.ts).
 * * The dashboard opens in a NEW tab, so the viewport is set on that page after
 *   `openDashboardTab` (Firefox otherwise inherits the context size).
 */

const PHONE = { width: 390, height: 844 };

/** Three groups: enough rows to scroll the explorer on a narrow phone pane. */
const SETTINGS = {
    locale: "en",
    rules: [
        {
            siteRegex: "/localhost/",
            previewEntries: [{ url: "http://localhost/start.html", testOutputUri: "" }],
            rules: [
                { kind: "replace", regex: "/start\\.html/", substitution: "started.html" },
                { kind: "appendQuery", regex: "/started/", params: "a=1" },
                { kind: "removeQuery", regex: "", keys: "utm_source" },
                { kind: "replace", regex: "/nomatch\\.html/", substitution: "x.html" },
            ],
        },
        {
            siteRegex: "/localhost/",
            rules: [
                { kind: "replace", regex: "/x\\.html/", substitution: "y.html" },
                { kind: "replace", regex: "/y\\.html/", substitution: "z.html" },
            ],
        },
        {
            siteRegex: "/localhost/",
            rules: [
                { kind: "replace", regex: "/a\\.html/", substitution: "b.html" },
                { kind: "replace", regex: "/b\\.html/", substitution: "c.html" },
            ],
        },
    ],
};

test("phone: bottom bar below the content and utilities in the header", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);
    await dashboard.setViewportSize(PHONE);

    const [railBox, mainBox] = await Promise.all([
        dashboard.locator(".rr-rail").boundingBox(),
        dashboard.locator(".rr-main").boundingBox(),
    ]);
    expect(railBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    expect(railBox!.y).toBeGreaterThanOrEqual(mainBox!.y + mainBox!.height - 1);

    await expect(dashboard.locator(".rr-rail-tabs")).toHaveAttribute("aria-orientation", "horizontal");
    await expect(dashboard.locator(".rr-rail-foot")).toBeHidden();
    await expect(dashboard.locator(".rr-rail-tools--header")).toBeVisible();
    // * The utility cluster renders exactly once (no duplicate locale menu).
    await expect(dashboard.locator(".rr-lang-toggle")).toHaveCount(1);
    await expect(dashboard.locator(".rr-header-actions .rr-theme-toggle")).toBeVisible();
    // * Both pane-switch segments carry a glyph (small segments stay legible).
    await expect(dashboard.locator(".rr-pane-switch .rr-choice-surface svg")).toHaveCount(2);

    // * Narrowest phone: the density ladder keeps the header from overflowing.
    await dashboard.setViewportSize({ width: 320, height: 640 });
    await expect(dashboard.locator(".rr-app-icon")).toBeHidden();
    const overflow = await dashboard.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
});

test("phone: the pane switch preserves editor state and scroll position", async ({ page }) => {
    await injectUserscript(page, { settings: SETTINGS });
    await page.goto("/").catch(() => undefined);
    const dashboard = await openDashboardTab(page);
    // * Short viewport: the explorer must be scrollable for the assertion.
    await dashboard.setViewportSize({ width: PHONE.width, height: 560 });

    const master = dashboard.locator(".rr-master-detail > .rr-master");
    const preview = dashboard.locator(".rr-preview-zone");

    // * Explorer + preview share one cell; rules is the default pane.
    await expect(master).toBeVisible();
    await expect(preview).toBeHidden();

    await dashboard.locator(".rr-master > details.rr-master-site > .rr-group-summary").first().click();
    const firstRule = dashboard.locator(".rr-master .rr-master-rule").first();
    await firstRule.locator("> .rr-master-rule-summary").click();

    const substitution = firstRule.getByRole("textbox", { name: "With" });
    await substitution.fill("edited-while-on-rules.html");
    const scrollBefore = await master.evaluate((el) => {
        el.scrollTop = 120;
        return el.scrollTop;
    });
    expect(scrollBefore).toBeGreaterThan(0);

    await dashboard.locator(".rr-pane-switch .rr-choice-surface").filter({ hasText: "Preview" }).click();
    await expect(preview).toBeVisible();
    await expect(master).toBeHidden();

    await dashboard.locator(".rr-pane-switch .rr-choice-surface").filter({ hasText: "Rules" }).click();
    await expect(master).toBeVisible();
    await expect(preview).toBeHidden();
    await expect(substitution).toHaveValue("edited-while-on-rules.html");
    expect(await master.evaluate((el) => el.scrollTop)).toBe(scrollBefore);
});

test("phone: a chain-step click switches to the rules pane and focuses the row", async ({ page }) => {
    await injectUserscript(page, { settings: SETTINGS });
    await page.goto("/").catch(() => undefined);
    const dashboard = await openDashboardTab(page);
    await dashboard.setViewportSize(PHONE);

    const masterDetail = dashboard.locator(".rr-master-detail");
    await dashboard.locator(".rr-master > details.rr-master-site > .rr-group-summary").first().click();
    await dashboard.locator(".rr-pane-switch .rr-choice-surface").filter({ hasText: "Preview" }).click();
    await expect(masterDetail).toHaveAttribute("data-pane", "preview");

    // * The preview card starts folded — unfold it to reach the chain steps.
    await dashboard.locator(".rr-preview-zone details.rr-ed-preview > .rr-group-summary").first().click();

    // * First chain step (rule 1) — the gate row carries the "site" kind chip.
    const step = dashboard.locator(".rr-preview-zone .rr-steps details.rr-step-group").filter({ hasText: "Replace" });
    await step.first().locator("> summary").click();

    await expect(masterDetail).toHaveAttribute("data-pane", "rules");
    await expect(dashboard.locator('.rr-master-rule[data-site="0"][data-rule="0"] > summary')).toBeFocused();
});

test("stacked split: one horizontal grip resizes the explorer height", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);
    await dashboard.setViewportSize({ width: 900, height: 900 });

    await expect(dashboard.locator(".rr-drag-h")).toBeVisible();
    await expect(dashboard.locator(".rr-drag-v")).toBeHidden();

    const master = dashboard.locator(".rr-master-detail > .rr-master");
    const before = (await master.boundingBox())!.height;
    const grip = dashboard.locator(".rr-drag-h");
    const gripBox = (await grip.boundingBox())!;
    const x = gripBox.x + gripBox.width / 2;
    const startY = gripBox.y + gripBox.height / 2;
    const init = (y: number, buttons: number) => ({
        pointerId: 17,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
    });
    await grip.dispatchEvent("pointerdown", init(startY, 1));
    await grip.dispatchEvent("pointermove", init(startY + 80, 1));
    await grip.dispatchEvent("pointerup", init(startY + 80, 0));

    await expect.poll(async () => (await master.boundingBox())!.height).toBeGreaterThan(before + 40);
});

test("desktop: the rail stays vertical", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);
    await dashboard.setViewportSize({ width: 1440, height: 900 });

    await expect(dashboard.locator(".rr-rail-tabs")).toHaveAttribute("aria-orientation", "vertical");
    await expect(dashboard.locator(".rr-drag-v")).toBeVisible();
    await expect(dashboard.locator(".rr-drag-h")).toBeHidden();
});
