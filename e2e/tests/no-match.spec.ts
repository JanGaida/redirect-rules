import { expect, test } from "@playwright/test";
import { openFixtureWithUserscript } from "../helpers/userscript";

/**
 * No-match — a page none of the seeded rules touch must NOT navigate, not even
 * via the ungated-looking localhost site rule (every seeded rule is either
 * path-specific or carries a gate regex).
 */
test("a page no rule touches stays put", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");

    // * settle window: no positive event marks a non-redirect, so a short
    //   wall-clock guard remains the only check for a late navigation
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe("/");
    expect(new URL(page.url()).search).toBe("");
    await expect(page.locator("body")).toHaveAttribute("data-fixture", "index");
});
