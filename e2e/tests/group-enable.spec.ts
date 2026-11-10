import { expect, test, type Page } from "@playwright/test";
import { openDashboardTab } from "../helpers/dashboard";
import { injectUserscript } from "../helpers/userscript";

/**
 * Group enable/disable (ADR 0038) — a disabled group stays editable and
 * previewable but never reaches the redirect engine.
 */

const SETTINGS = {
    locale: "en",
    rules: [
        {
            siteRegex: "/localhost/",
            rules: [{ kind: "replace", regex: "/redirect-me\\.html/", substitution: "redirected.html" }],
        },
    ],
};

function persistedDisabled(dashboard: Page): Promise<boolean | null> {
    return dashboard.evaluate(() => {
        const raw = localStorage.getItem("rrGM_settings");
        if (raw === null) return null;
        const settings = JSON.parse(raw) as { rules?: Array<{ disabled?: boolean }> };
        return settings.rules?.[0]?.disabled === true;
    });
}

test("disabling a group stops the redirect and re-enabling restores it", async ({ page }) => {
    await injectUserscript(page, { settings: SETTINGS });
    await page.goto("/redirect-me.html").catch(() => undefined);
    await expect.poll(async () => page.url(), { timeout: 10_000 }).toContain("redirected.html");

    const dashboard = await openDashboardTab(page);
    const site = dashboard.locator(".rr-master > details.rr-master-site").first();
    const summary = site.locator("> .rr-group-summary");
    await summary.hover();
    await summary.getByRole("button", { name: "Disable group" }).click();

    await expect.poll(() => persistedDisabled(dashboard), { timeout: 8000 }).toBe(true);
    await expect(site).toHaveAttribute("data-disabled", "true");

    await page.goto("/redirect-me.html").catch(() => undefined);
    await expect.poll(async () => page.url(), { timeout: 10_000 }).toContain("redirect-me.html");
    expect(page.url()).not.toContain("redirected.html");

    await summary.hover();
    await summary.getByRole("button", { name: "Enable group" }).click();
    await expect.poll(() => persistedDisabled(dashboard), { timeout: 8000 }).toBe(false);

    await page.goto("/redirect-me.html").catch(() => undefined);
    await expect.poll(async () => page.url(), { timeout: 10_000 }).toContain("redirected.html");
});
