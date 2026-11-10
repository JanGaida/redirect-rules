import { expect, test } from "@playwright/test";
import { openFixtureWithUserscript } from "../helpers/userscript";

/**
 * appendQuery — effective URL behavior: existing params stay (raw `+` encoding
 * untouched), new params append with `&`, the fragment survives, and the page
 * actually NAVIGATES to the rewritten URL.
 */
test("query params are merged and the fragment survives the redirect", async ({ page }) => {
    await openFixtureWithUserscript(page, "/append-page.html?search=Exalted+Orb#section1");

    await expect
        .poll(async () => page.url(), { timeout: 10_000 })
        .toContain("append-page.html?search=Exalted+Orb&base=1&extra=2#section1");

    // * Fragment must still be client-side after the navigation
    await expect(page).toHaveURL(/#section1$/);
    await expect(page.locator("body")).toHaveAttribute("data-fixture", "append-page");
});
