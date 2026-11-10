import { expect, test } from "@playwright/test";
import { openFixtureWithUserscript } from "../helpers/userscript";

/**
 * Redirect-on-load — the core contract: a matching rule navigates the page via
 * `location.replace` at document-start, as a REAL navigation (no SPA tricks).
 */
test("a matching replace rule navigates to the rewritten URL", async ({ page }) => {
    await openFixtureWithUserscript(page, "/redirect-me.html");

    await expect.poll(async () => page.url(), { timeout: 10_000 }).toContain("redirected.html");
    await expect(page.locator("body")).toHaveAttribute("data-fixture", "redirected");
});
