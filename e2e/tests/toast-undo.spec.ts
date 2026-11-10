import { expect, test } from "@playwright/test";
import { openDashboardTab } from "../helpers/dashboard";
import { openFixtureWithUserscript } from "../helpers/userscript";

/**
 * Row delete → undo toast (ADR 0039).
 *
 * * The ring must use the SAME duration as the toast timer: an undo delete is
 *   8 s, so the computed animation duration is 8 s (not the 3.2 s receipt
 *   default) and the toast is still visible after the receipt window.
 * * Undo restores the deleted row at its original position.
 */
test("row delete opens an 8s undo toast with a matching countdown ring", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);

    const site = dashboard.locator(".rr-master > details.rr-master-site").first();
    await site.locator("> .rr-group-summary").click();
    await expect(site.locator(".rr-master-rule")).toHaveCount(5);

    const rule = site.locator(".rr-master-rule").first();
    await rule.hover();
    await rule.getByRole("button", { name: "Delete" }).click();

    const toast = dashboard.locator(".rr-toast");
    await expect(toast).toBeVisible();
    await expect(toast.locator(".rr-toast-action .rr-icon svg")).toHaveCount(1);
    const ring = toast.locator(".rr-toast-timer-progress");

    // * Same 8000 ms source for the ring and the auto-hide timer.
    await expect(ring).toHaveAttribute("style", /animation-duration:\s*8000ms/);
    expect(await ring.evaluate((el) => getComputedStyle(el as Element).animationDuration)).toBe("8s");

    // * The arc fills over time (empty → full), not a static disc.
    const startOffset = await ring.evaluate((el) =>
        Number.parseFloat(getComputedStyle(el as Element).strokeDashoffset),
    );
    expect(startOffset).toBeGreaterThan(0);
    await expect
        .poll(async () => ring.evaluate((el) => Number.parseFloat(getComputedStyle(el as Element).strokeDashoffset)), {
            timeout: 4000,
        })
        .toBeLessThan(startOffset);

    // * Still alive after the 3.2 s plain-receipt window — cross it on the
    //   ring's own animation clock instead of a fixed sleep.
    await expect
        .poll(() => ring.evaluate((el) => Number(el.getAnimations()[0]?.currentTime ?? 0)), { timeout: 6000 })
        .toBeGreaterThanOrEqual(3200);
    await expect(toast).toBeVisible();

    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(toast).toHaveCount(0);
    await expect(site.locator(".rr-master-rule")).toHaveCount(5);
});

test("dismiss closes the toast without undoing the delete", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);

    const site = dashboard.locator(".rr-master > details.rr-master-site").first();
    await site.locator("> .rr-group-summary").click();
    await expect(site.locator(".rr-master-rule")).toHaveCount(5);

    const rule = site.locator(".rr-master-rule").first();
    await rule.hover();
    await rule.getByRole("button", { name: "Delete" }).click();

    const toast = dashboard.locator(".rr-toast");
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "Dismiss" }).click();

    await expect(toast).toHaveCount(0);
    await expect(site.locator(".rr-master-rule")).toHaveCount(4);
});
