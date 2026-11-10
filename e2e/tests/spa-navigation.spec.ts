import { expect, test } from "@playwright/test";
import { openFixtureWithUserscript } from "../helpers/userscript";

/**
 * SPA navigation — pushState triggers the patched `urlchange` event, the watcher
 * re-runs against the NEW url and redirects out of the SPA navigation.
 */
test("pushState into a matching URL redirects via the urlchange hook", async ({ page }) => {
    await openFixtureWithUserscript(page, "/spa.html");
    await expect(page.locator("body")).toHaveAttribute("data-fixture", "spa");

    // * The button pushState's to /spa-target.html (no server hit) — the watcher
    //   must rewrite it to /spa-destination.html and navigate there.
    await page.click("#spa-link");

    await expect.poll(async () => page.url(), { timeout: 10_000 }).toContain("spa-destination.html");
    await expect(page.locator("body")).toHaveAttribute("data-fixture", "spa-destination");
});
