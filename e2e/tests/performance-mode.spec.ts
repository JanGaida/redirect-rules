import { expect, test, type Page } from "@playwright/test";
import { openDashboardTab } from "../helpers/dashboard";
import { injectUserscript, openFixtureWithUserscript, SEEDED_SETTINGS } from "../helpers/userscript";

/**
 * Performance mode (ADR 0041) — stops redirect-stat recording and forces silent
 * logging on new page loads, with a Stats-tab banner and a Settings hand-off.
 *
 * * `SEEDED_SETTINGS` has no `performanceMode`, so it normalizes to `false`;
 *   the gating specs spread it and set the flag.
 */

/** Seeds the shared settings plus `performanceMode` before navigation. */
async function openWithPerformanceMode(page: Page, performanceMode: boolean, url: string): Promise<void> {
    await injectUserscript(page, { settings: { ...SEEDED_SETTINGS, performanceMode } });
    await page.goto(url).catch(() => undefined);
}

/** Reads one GM value through the polyfill. */
async function gmValue(page: Page, key: string): Promise<unknown> {
    return page.evaluate(
        (valueKey) =>
            (window as unknown as { GM_getValue: (k: string, fallback: unknown) => unknown }).GM_getValue(
                valueKey,
                null,
            ),
        key,
    );
}

test("performance mode still redirects but never records stats", async ({ page }) => {
    await openWithPerformanceMode(page, true, "/redirect-me.html");

    await expect(page).toHaveURL(/\/redirected\.html$/);
    expect(await gmValue(page, "stats")).toBeNull();
});

test("a normal redirect still records stats (over-gating guard)", async ({ page }) => {
    await openFixtureWithUserscript(page, "/redirect-me.html");

    await expect(page).toHaveURL(/\/redirected\.html$/);
    const stats = (await gmValue(page, "stats")) as { total?: number } | null;
    expect(stats?.total).toBeGreaterThanOrEqual(1);
});

test("the Settings toggle locks the log level and persists both states", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);
    await dashboard.getByRole("tab", { name: "System" }).click();

    const panel = dashboard.locator(".rr-tab-panel--active");
    const performanceGroup = panel.getByRole("group", { name: "Performance mode" });
    const logLevelGroup = panel.getByRole("group", { name: "Log level" });

    await expect(logLevelGroup.locator("input[type=radio]").first()).toBeEnabled();
    // * The native radio is visually hidden behind its label surface — click the label text.
    await performanceGroup.getByText("Enabled", { exact: true }).click();
    await expect(performanceGroup.getByRole("radio", { name: "Enabled" })).toBeChecked();
    await expect(logLevelGroup.locator("input[type=radio]").first()).toBeDisabled();
    // * The row hint sits outside the fieldset but is linked via describedById.
    await expect(logLevelGroup).toHaveAttribute("aria-describedby", "log-level-row-hint");
    await expect(panel.locator("#log-level-row-hint")).toContainText("Locked while performance mode is on");

    await expect
        .poll(async () => (await gmValue(dashboard, "settings")) as { performanceMode?: boolean } | null, {
            timeout: 10_000,
        })
        .toMatchObject({ performanceMode: true });

    await performanceGroup.getByText("Disabled", { exact: true }).click();
    await expect(performanceGroup.getByRole("radio", { name: "Disabled" })).toBeChecked();
    await expect(logLevelGroup.locator("input[type=radio]").first()).toBeEnabled();

    await expect
        .poll(async () => (await gmValue(dashboard, "settings")) as { performanceMode?: boolean } | null, {
            timeout: 10_000,
        })
        .toMatchObject({ performanceMode: false });
});

test("the Stats banner explains frozen counters and links to Settings", async ({ page }) => {
    await injectUserscript(page, { settings: { ...SEEDED_SETTINGS, performanceMode: true } });
    await page.goto("/");
    const dashboard = await openDashboardTab(page);

    await dashboard.getByRole("tab", { name: "Stats" }).click();
    const panel = dashboard.locator(".rr-tab-panel--active");
    const banner = panel.locator(".rr-stats-performance-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Performance mode is on");
    await expect(banner).toContainText("already open pages keep counting until they reload");
    // * Existing counters stay rendered below the banner.
    await expect(panel.locator(".rr-stats-hero-total")).toBeVisible();

    await banner.getByRole("button", { name: "Open settings" }).click();
    await expect(dashboard.getByRole("tab", { name: "System" })).toHaveAttribute("aria-selected", "true");
    await expect(dashboard.locator(".rr-tab-panel--active")).toContainText("Performance mode");
    await expect(dashboard.locator('input[name="performance-mode"]').first()).toBeFocused();
});
