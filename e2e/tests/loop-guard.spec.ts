// ─────────────────────────────────────────────────────────────────────────────
// MARK: loop-guard spec — real A→B→A oscillation in Firefox
// ─────────────────────────────────────────────────────────────────────────────
// * Two site GROUPS are required: a single group applies A→B and B→A in the
//   same engine pass and returns the original url (no redirect at all).
// * Site gates are evaluated against the ORIGINAL url, so the loop-b group
//   stays inert on the first hop — that produces real navigations.
// * Assert observable state (navigation sequence, cleared `rrLoop`), not
//   console capture, which can drop around navigation teardown.

import { expect, test } from "@playwright/test";
import { injectUserscript } from "../helpers/userscript";

/** Loop fixture rules split across two site groups — see the header note. */
const LOOP_GUARD_SETTINGS = {
    locale: "en",
    rules: [
        {
            siteRegex: "/localhost/",
            rules: [{ kind: "replace", regex: "/loop-a\\.html/", substitution: "loop-b.html" }],
        },
        {
            siteRegex: "/\\/loop-b\\.html/",
            rules: [{ kind: "replace", regex: "/loop-b\\.html/", substitution: "loop-a.html" }],
        },
    ],
};

test("A→B→A oscillation is detected and aborted", async ({ page }) => {
    const navs: string[] = [];
    page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) navs.push(new URL(frame.url()).pathname);
    });

    await injectUserscript(page, { settings: LOOP_GUARD_SETTINGS });
    await page.goto("/loop-a.html").catch(() => undefined);

    // * One full cycle proves the two rules really redirect across navigations.
    await expect.poll(() => navs.join(","), { timeout: 10_000 }).toContain("/loop-a.html,/loop-b.html,/loop-a.html");

    // * Settled state: poll the abort marker (`clearLoopHistory` leaves an empty
    //   rrLoop) instead of a wall-clock settle window.
    const settledLength = navs.length;
    await expect
        .poll(() => page.evaluate(() => (JSON.parse(window.name || "{}") as { rrLoop?: unknown }).rrLoop), {
            timeout: 10_000,
        })
        .toEqual([]);
    expect(navs.length).toBe(settledLength);
    expect(new URL(page.url()).pathname).toBe("/loop-a.html");
    await expect(page.locator("body")).toHaveAttribute("data-fixture", "loop-a");
});
