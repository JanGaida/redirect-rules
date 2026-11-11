import { expect, test, type Locator, type Page } from "@playwright/test";
import { openDashboardTab } from "../helpers/dashboard";
import { injectUserscript, openFixtureWithUserscript, SEEDED_SETTINGS } from "../helpers/userscript";

/** Border-box width of a row-chrome element. */
const boxWidth = (locator: Locator): Promise<number> => locator.evaluate((el) => el.getBoundingClientRect().width);

/** Caption text width: border box minus the horizontal padding. */
const contentWidth = (locator: Locator): Promise<number> =>
    locator.evaluate((el) => {
        const style = getComputedStyle(el);
        return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });

/**
 * Dashboard smoke — the GM menu commands open the hash-takeover dashboard
 * (replaces the old panel-smoke specs; ADR 0011).
 *
 * * "Open Dashboard" → GM_openInTab(host stub url + #rr-dashboard — the e2e
 *   polyfill swaps the raw.githubusercontent host for the same-origin fixture
 *   path /rr-dashboard-host, ADR 0012) → the userscript instance in the NEW
 *   tab boots in dashboard mode (window.stop + DOM wipe + fullscreen mount).
 *   The polyfill backs GM_openInTab with window.open (Playwright does not
 *   popup-block — real browsers do, hence GM_openInTab).
 * * MULTI-DASHBOARD: EVERY menu click opens its OWN tab —
 *   the single-instance heartbeat/forwarding is gone. Tabs stay in sync via
 *   the settings value-change listener (remote reload while clean, conflict
 *   hint while dirty).
 * * AUTOSAVE (ADR 0024): changes persist via a configurable debounce — the rail
 *   stopwatch pill cycles fast/normal/slow and draws the countdown ring; Close
 *   flushes synchronously (no save button). The undo button restores the
 *   dashboard's opening state (session snapshot).
 * * Asserts the five rail tabs render, the autosave round-trip persists through
 *   the GM polyfill's storage (localStorage mirror, same-origin all tabs),
 *   the speed pill, the close flush, the multi-tab sync, and the undo restore.
 */

test("the Open Dashboard menu command opens the dashboard tab", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");

    // * No dashboard at boot — the GUI opens ONLY via the menu (lazy contract).
    await expect(page.locator(".rr-dashboard")).toHaveCount(0);
    expect(page.context().pages()).toHaveLength(1);

    const dashboard = await openDashboardTab(page);
    // * Fullscreen dashboard mounted in its own tab, rules tab active by default.
    await expect(dashboard.locator(".rr-dashboard")).toBeVisible();
    // * The dashboard tab uses the app icon as its browser-tab favicon.
    await expect(dashboard.locator('link[rel="icon"]')).toHaveAttribute("href", /data:image\/svg\+xml,/);
    await expect(dashboard.locator(".rr-dashboard")).toContainText("Add site rule");
    // * The seeded settings render: the localhost group is in the master list.
    await expect(dashboard.locator(".rr-master-site")).toHaveCount(1);
});

test("the empty preview mirrors the explorer filter geometry", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);

    // * Force the no-open-group state (a persisted selection may auto-open one).
    const openSummary = dashboard.locator(".rr-master-site[open] > summary");
    if ((await openSummary.count()) > 0) await openSummary.first().click();
    await expect(dashboard.locator(".rr-master-site[open]")).toHaveCount(0);

    const placeholder = dashboard.locator(".rr-preview-zone .rr-filter-sticky--placeholder");
    await expect(placeholder).toBeVisible();
    await expect(placeholder.locator("input, button, a, [tabindex]")).toHaveCount(0);

    const [masterFilterBox, placeholderBox] = await Promise.all([
        dashboard.locator(".rr-master > .rr-filter-sticky").boundingBox(),
        placeholder.boundingBox(),
    ]);
    expect(masterFilterBox).not.toBeNull();
    expect(placeholderBox).not.toBeNull();
    expect(Math.abs(masterFilterBox!.y - placeholderBox!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(masterFilterBox!.height - placeholderBox!.height)).toBeLessThanOrEqual(1);

    const [firstGroupBox, emptyCardBox] = await Promise.all([
        dashboard.locator(".rr-master-site").first().boundingBox(),
        dashboard.locator(".rr-preview-zone .rr-empty-skeleton").boundingBox(),
    ]);
    expect(firstGroupBox).not.toBeNull();
    expect(emptyCardBox).not.toBeNull();
    expect(Math.abs(firstGroupBox!.y - emptyCardBox!.y)).toBeLessThanOrEqual(1);
});

test("double-click edits the site description and persists it", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);

    const site = dashboard.locator(".rr-master-site").first();
    // * Seeded gate "/localhost/" — no description yet.
    const caption = site.locator(".rr-summary-host");
    await expect(caption).toHaveText("localhost");
    // * font-display: optional — the Hack request is aborted in E2E (no live
    //   web); waiting for font loading to settle keeps the boxes stable.
    await dashboard.evaluate(() => document.fonts.ready);
    const summary = site.locator(".rr-group-summary");
    const summaryBox = await summary.boundingBox();
    expect(summaryBox).not.toBeNull();

    // * ADR 0031: row chrome reveals on hover, focus or open — never at rest.
    //   Hidden chrome collapses so the caption owns the width.
    //   Focus still sits on the body here, so `:focus-within` cannot mask it.
    await dashboard.mouse.move(0, 0);
    const siteActions = summary.locator(".rr-actions");
    const pencil = summary.getByRole("button", { name: "Edit description" });
    const hoverCapable = await dashboard.evaluate(() => window.matchMedia("(hover: hover)").matches);
    let restCaptionContentWidth = 0;
    if (hoverCapable) {
        await expect.poll(() => siteActions.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
        await expect.poll(() => pencil.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
        await expect.poll(() => boxWidth(siteActions)).toBeLessThanOrEqual(0.5);
        restCaptionContentWidth = await contentWidth(caption);
    }

    // * ADR 0033: the body no longer duplicates the description; the caption
    //   pencil is the touch route.
    await expect(site.locator(".rr-site-body label.rr-row-label", { hasText: "Site description" })).toHaveCount(0);
    await summary.hover();
    await expect.poll(() => siteActions.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    await expect.poll(() => pencil.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    if (hoverCapable) {
        await expect.poll(() => boxWidth(siteActions)).toBeGreaterThan(20);
        await expect.poll(() => contentWidth(caption)).toBeLessThan(restCaptionContentWidth - 20);
    }
    await pencil.click();
    const pencilInput = site.locator(".rr-summary-desc");
    await expect(pencilInput).toBeVisible();
    await expect(pencilInput).toBeFocused();
    await pencilInput.press("Escape");
    await expect(pencilInput).toHaveCount(0);

    await caption.dblclick();
    const input = site.locator(".rr-summary-desc");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();

    // * Zero-jump contract: editing must not fold the group (the caption click
    //   pair restores the pre-edit fold state) and must not change the row height.
    expect(await site.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    const [summaryAfterBox, textBox, fieldBox, actionsBox] = await Promise.all([
        summary.boundingBox(),
        caption.boundingBox(),
        input.boundingBox(),
        siteActions.boundingBox(),
    ]);
    expect(summaryAfterBox).not.toBeNull();
    expect(textBox).not.toBeNull();
    expect(fieldBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    for (const key of ["x", "y", "width", "height"] as const) {
        expect(Math.abs((summaryAfterBox?.[key] ?? 0) - (summaryBox?.[key] ?? 0))).toBeLessThanOrEqual(1);
    }

    // * Outward-expansion contract: the field box is the caption box
    //   grown by 6px vertically / 8px horizontally with compensating padding, so
    //   the glyph origin and the row height stay put.
    expect(Math.abs((fieldBox?.x ?? 0) - (textBox?.x ?? 0) + 8)).toBeLessThanOrEqual(1);
    expect(Math.abs((fieldBox?.y ?? 0) - (textBox?.y ?? 0) + 6)).toBeLessThanOrEqual(1);
    expect(Math.abs((fieldBox?.width ?? 0) - (textBox?.width ?? 0) - 16)).toBeLessThanOrEqual(1);
    expect(Math.abs((fieldBox?.height ?? 0) - (textBox?.height ?? 0) - 12)).toBeLessThanOrEqual(1);

    // * Fixed clearance to the action strip: the field overhangs 8px to the
    //   right, so the strip carries +8px margin → 8px field-to-strip.
    const gapToActions = (actionsBox?.x ?? 0) - ((fieldBox?.x ?? 0) + (fieldBox?.width ?? 0));
    expect(gapToActions).toBeGreaterThanOrEqual(7);
    expect(gapToActions).toBeLessThanOrEqual(9);

    // * Typography parity with the caption (font: inherit + explicit spacing).
    const typography = await input.evaluate((el) => {
        const field = getComputedStyle(el);
        const host = el.parentElement?.querySelector(".rr-summary-host");
        if (!host) return null;
        const captionStyle = getComputedStyle(host);
        return ["font-family", "font-size", "font-weight", "line-height", "letter-spacing"].map((prop) => [
            prop,
            field.getPropertyValue(prop),
            captionStyle.getPropertyValue(prop),
        ]);
    });
    expect(typography).not.toBeNull();
    for (const row of typography ?? []) {
        expect(row[1]).toBe(row[2]);
    }

    await input.fill("My site");
    await input.press("Enter");
    await expect(site.locator(".rr-summary-host")).toHaveText("My site");

    await expect
        .poll(
            async () => {
                const raw = await page.evaluate(() => localStorage.getItem("rrGM_settings"));
                return raw === null
                    ? null
                    : (JSON.parse(raw) as { rules: Array<{ description?: string }> }).rules[0]?.description;
            },
            { timeout: 8000 },
        )
        .toBe("My site");
});

test("preview test-case summaries edit URLs and the description inline and filter", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);

    // * `details.rr-master-site` picks the explorer group — preview rows share
    //   the class once entries exist.
    const site = dashboard.locator(".rr-master > details.rr-master-site").first();
    await site.locator("> .rr-group-summary").click();

    // * The seed ships NO preview entries — create one in this test only, so
    //   other specs keep their counts.
    await dashboard.getByRole("button", { name: "Add preview URL" }).click();
    const row = dashboard.locator(".rr-preview-zone details.rr-ed-preview").first();
    await expect(row).toHaveCount(1);

    // * The new entry starts folded — the URL rows live in the summary, so they
    //   are already reachable. Edit both values inline (dblclick = overlay).
    const summary = row.locator("> .rr-group-summary");
    const caption = summary.locator("> .rr-summary-lead > .rr-summary-caption > .rr-summary-host");
    const urlRows = summary.locator(".rr-summary-url-row");
    await expect(urlRows).toHaveCount(2);
    await expect(urlRows.nth(0).locator(".rr-summary-url-label")).toHaveText("Input");
    await expect(urlRows.nth(1).locator(".rr-summary-url-label")).toHaveText("Output");
    await expect(urlRows.nth(0).locator(".rr-summary-host")).toHaveText("—");
    await expect(urlRows.nth(1).locator(".rr-summary-host")).toHaveText("—");

    await urlRows.nth(0).locator(".rr-summary-host").dblclick();
    const inputField = urlRows.nth(0).getByLabel("Input", { exact: true });
    await expect(inputField).toBeVisible();
    await expect(inputField).toBeFocused();
    await inputField.fill("https://example.de/a");
    await inputField.press("Enter");
    await expect(urlRows.nth(0).locator(".rr-summary-host")).toHaveText("https://example.de/a");

    await urlRows.nth(1).locator(".rr-summary-host").dblclick();
    const outputField = urlRows.nth(1).getByLabel("Output", { exact: true });
    await expect(outputField).toBeVisible();
    await expect(outputField).toBeFocused();
    await outputField.fill("https://example.de/b");
    await outputField.press("Enter");
    await expect(urlRows.nth(1).locator(".rr-summary-host")).toHaveText("https://example.de/b");

    // * The URL rows carry the TOTAL panel style: URI tones + the input↔output diff.
    await expect(urlRows.nth(0).locator(".rr-summary-url-value")).toHaveClass(/rr-preview-panel/);
    await expect(urlRows.nth(1).locator(".rr-summary-url-value")).toHaveClass(/rr-preview-panel/);
    await expect(urlRows.nth(0).locator(".rr-uri-scheme").first()).toHaveText("https://");
    await expect(urlRows.nth(0).locator(".rr-diff-match")).toHaveText("a");
    await expect(urlRows.nth(1).locator(".rr-diff-insert")).toHaveText("b");

    // * No URL fields remain in the body; the summary rows are the only surface.
    await summary.click();
    expect(await row.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
    await expect(row.locator(".rr-preview-fields")).toHaveCount(0);
    await expect(row.locator(".rr-site-body input")).toHaveCount(0);
    await expect(row.locator(".rr-site-body label.rr-row-label", { hasText: "Description:" })).toHaveCount(0);

    // * Fixed label-left grid: both values share one x; the labels end before it.
    const inputValueBox = await urlRows.nth(0).locator(".rr-summary-url-value").boundingBox();
    const outputValueBox = await urlRows.nth(1).locator(".rr-summary-url-value").boundingBox();
    const inputLabelBox = await urlRows.nth(0).locator(".rr-summary-url-label").boundingBox();
    expect(inputValueBox).not.toBeNull();
    expect(outputValueBox).not.toBeNull();
    expect(inputLabelBox).not.toBeNull();
    expect(Math.abs((inputValueBox?.x ?? 0) - (outputValueBox?.x ?? 0))).toBeLessThanOrEqual(1);
    expect(inputLabelBox!.x + inputLabelBox!.width).toBeLessThanOrEqual(inputValueBox!.x);

    // * The URL block spans the full summary content width — left and right
    //   edges follow the summary padding, not the caption/actions columns.
    const urlLayout = await summary.evaluate((el) => {
        const block = el.querySelector(".rr-summary-urls");
        if (block === null) return null;
        const style = getComputedStyle(el);
        const summaryRect = el.getBoundingClientRect();
        const blockRect = block.getBoundingClientRect();
        return {
            leftGap: Math.abs(blockRect.left - (summaryRect.left + parseFloat(style.paddingLeft))),
            rightGap: Math.abs(blockRect.right - (summaryRect.right - parseFloat(style.paddingRight))),
        };
    });
    expect(urlLayout).not.toBeNull();
    expect(urlLayout!.leftGap).toBeLessThanOrEqual(1);
    expect(urlLayout!.rightGap).toBeLessThanOrEqual(1);

    // * No description yet: the caption is the dash placeholder (the input URL
    //   has its own row), and the chip stays short and icon-less.
    await expect(caption).toHaveText("—");
    await expect(summary.locator(".rr-chip-text")).toHaveText(/^(ok|fail|—)$/);
    await expect(summary.locator(".rr-chip-icon")).toHaveCount(0);

    // * font-display: optional — the aborted webfont settles before measurement.
    await dashboard.evaluate(() => document.fonts.ready);
    const summaryBox = await summary.boundingBox();
    expect(summaryBox).not.toBeNull();

    await caption.dblclick();
    const input = summary.locator("> .rr-summary-lead > .rr-summary-caption > .rr-summary-desc");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    // * Zero-jump contract: editing never changes the row height or the open
    //   state of the surrounding disclosure.
    expect(await row.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
    const summaryAfterBox = await summary.boundingBox();
    for (const key of ["x", "y", "width", "height"] as const) {
        expect(Math.abs((summaryAfterBox?.[key] ?? 0) - (summaryBox?.[key] ?? 0))).toBeLessThanOrEqual(1);
    }

    await input.fill("Docs redirect");
    await input.press("Enter");
    await expect(caption).toHaveText("Docs redirect");

    // * The URL rows keep their inline values after the description commit.
    await expect(urlRows).toHaveCount(2);
    await expect(urlRows.nth(0).locator(".rr-summary-host")).toHaveText("https://example.de/a");
    await expect(urlRows.nth(1).locator(".rr-summary-host")).toHaveText("https://example.de/b");

    // * A failing test keeps the TOTAL block as diagnostics; a passing one hides
    //   it because the summary rows already show the identical start/end pair.
    await expect(row.locator(".rr-total")).toBeVisible();
    await urlRows.nth(1).getByRole("button", { name: "Edit output URL" }).click();
    const passField = urlRows.nth(1).getByLabel("Output", { exact: true });
    await passField.fill("https://example.de/a");
    await passField.press("Enter");
    await expect(row.locator(".rr-total")).toHaveCount(0);
    await urlRows.nth(1).getByRole("button", { name: "Edit output URL" }).click();
    const restoreField = urlRows.nth(1).getByLabel("Output", { exact: true });
    await restoreField.fill("https://example.de/b");
    await restoreField.press("Enter");
    await expect(row.locator(".rr-total")).toBeVisible();

    await expect
        .poll(
            async () => {
                const raw = await page.evaluate(() => localStorage.getItem("rrGM_settings"));
                return raw === null
                    ? null
                    : (
                          JSON.parse(raw) as {
                              rules: Array<{ previewEntries?: Array<{ description?: string }> }>;
                          }
                      ).rules[0]?.previewEntries?.[0]?.description;
            },
            { timeout: 8000 },
        )
        .toBe("Docs redirect");

    // * ADR 0033: the caption pencil opens the same overlay without dblclick.
    await summary.hover();
    await summary.getByRole("button", { name: "Edit description" }).click();
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await input.press("Escape");

    // * Row actions: hidden at rest on hover-capable devices, visible on hover.
    //   Fold first — an open row keeps them revealed — and move focus out so
    //   `:focus-within` cannot mask the at-rest check. Hidden chrome collapses so
    //   the caption track owns the width.
    await summary.click();
    expect(await row.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    const filter = dashboard.locator(".rr-preview-zone input.rr-filter");
    await filter.focus();
    await dashboard.mouse.move(0, 0);
    const actions = summary.locator(".rr-actions");
    const opacityOf = () => actions.evaluate((el) => getComputedStyle(el).opacity);
    const hoverCapable = await dashboard.evaluate(() => window.matchMedia("(hover: hover)").matches);
    let restCaptionContentWidth = 0;
    if (hoverCapable) {
        // * The reveal fades — poll instead of reading mid-transition.
        await expect.poll(opacityOf).toBe("0");
        await expect.poll(() => boxWidth(actions)).toBeLessThanOrEqual(0.5);
        restCaptionContentWidth = await contentWidth(caption);
    }
    await summary.hover();
    await expect.poll(opacityOf).toBe("1");
    if (hoverCapable) {
        await expect.poll(() => boxWidth(actions)).toBeGreaterThan(20);
        await expect.poll(() => contentWidth(caption)).toBeLessThan(restCaptionContentWidth - 20);
    }

    // * Filter parity: the description is searchable; a miss reports the hint.
    await filter.fill("Docs");
    await expect(row).toHaveCount(1);
    await filter.fill("no-such-entry");
    await expect(dashboard.locator(".rr-preview-zone .rr-hint")).toHaveText("— no matches —");
});

test("the Create new Rule command opens a SECOND dashboard with the prefill", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboardA = await openDashboardTab(page);

    // * MULTI-DASHBOARD: no forwarding — the command opens its OWN
    //   tab; the boot request prefills THAT tab (a new site rule gated on the
    //   opener's host localhost:<port>).
    // * Firefox quirk: the first window.open of a fresh context may return a
    //   WindowProxy WITHOUT a page materializing. Poll for a NEW page and retry
    //   only when NOTHING materialized — never double-open a materialized tab
    //   (the boot request is single-use).
    const dashboardBPage = await openDashboardTab(page, "Redirect Rules: Create new Rule");

    // * Scoped to explorer groups — preview rows share `.rr-master-site`.
    const sitesB = dashboardBPage.locator(".rr-master > details.rr-master-site");
    await expect(sitesB).toHaveCount(2);
    // * The gate lives in the site row's INPUT value (values are not textContent).
    await expect(sitesB.nth(1).getByRole("textbox", { name: "Site", exact: true })).toHaveValue(/localhost/);
    // * The prefill opens its rule with the inline editor (label-agnostic).
    await expect(dashboardBPage.locator(".rr-master-rule[open] .rr-ed-fields")).toBeVisible();

    // * A stays untouched — the prefill went to the NEW tab only.
    await expect(dashboardA.locator(".rr-master-site")).toHaveCount(1);

    // * The boot request is consumed exactly once (deleted after the prefill).
    const remainingRequest = await dashboardBPage.evaluate(() =>
        (window as unknown as { GM_getValue: (key: string, fallback: unknown) => unknown }).GM_getValue(
            "dashboard-request",
            null,
        ),
    );
    expect(remainingRequest).toBeNull();
});

test("the tabs switch and the autosave round-trip persists the settings", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");

    const dashboard = await openDashboardTab(page);

    // * System tab: hero + always-open cards, no native dropdowns.
    await dashboard.getByRole("tab", { name: "System" }).click();
    const settingsPanel = dashboard.locator(".rr-tab-panel--active");
    await expect(settingsPanel.locator(".rr-settings-hero")).toBeVisible();
    await expect(settingsPanel.locator(".rr-settings-row")).toHaveCount(7);
    await expect(settingsPanel.locator(".rr-settings-grid")).toHaveCount(0);
    await expect(settingsPanel.getByRole("group", { name: "Color scheme" })).toBeVisible();
    await expect(settingsPanel.getByRole("group", { name: "Language" })).toBeVisible();
    await expect(settingsPanel.locator("select")).toHaveCount(0);
    await expect(settingsPanel.locator("input[type=radio]")).toHaveCount(22);
    await expect(settingsPanel.locator(".rr-card")).toHaveCount(3);
    await expect(settingsPanel.locator("details")).toHaveCount(0);
    await expect(
        settingsPanel.getByRole("group", { name: "Color scheme" }).locator(".rr-choice-surface .rr-icon"),
    ).toHaveCount(3);
    await expect(dashboard.locator(".rr-theme-toggle svg")).toHaveCount(1);
    const logGroup = settingsPanel.getByRole("group", { name: "Log level" });
    await expect(logGroup).toContainText("Warning");
    await expect(logGroup).toHaveClass(/rr-choice--segmented/);
    await expect(logGroup.getByRole("radio", { name: "Info" })).toBeChecked();
    await expect(logGroup).toHaveAttribute("aria-describedby", "log-level-row-hint");
    const resetButton = settingsPanel.locator(".rr-settings-reset").first();
    await expect(resetButton.locator("svg")).toHaveCount(1);
    const resetBox = await resetButton.boundingBox();
    expect(Math.round(resetBox?.height ?? 0)).toBeGreaterThanOrEqual(24);
    await expect(dashboard.locator(".rr-dashboard")).toContainText("Log level");
    // * Stats tab: migrated counters render there.
    await dashboard.getByRole("tab", { name: "Stats" }).click();
    await expect(dashboard.locator(".rr-dashboard")).toContainText("Total redirects");

    // * About tab: hero + version + release-card changelog render.
    await dashboard.getByRole("tab", { name: "About" }).click();
    await expect(dashboard.locator(".rr-dashboard")).toContainText("0.0.0-polyfill");
    await expect(dashboard.locator(".rr-info-hero")).toBeVisible();
    await expect(dashboard.locator(".rr-info-version-badge")).toContainText("0.0.0-polyfill");
    await expect(dashboard.getByTestId("build-sha-copy")).toBeVisible();
    await expect(dashboard.getByRole("button", { name: "Copy build SHA" })).toBeVisible();
    await expect(dashboard.getByTestId("build-sha-commit")).toBeVisible();
    await expect(dashboard.getByRole("link", { name: "View commit" })).toHaveAttribute("href", /\/commit\//);
    await expect(dashboard.locator(".rr-changelog")).toContainText("1.0.0");
    const release = dashboard.locator(".rr-changelog-release").first();
    await expect(release).toBeVisible();
    await expect(release).not.toHaveAttribute("open", "");
    await expect(release.locator(".rr-changelog-version")).toContainText("1.0.0");
    await release.locator(".rr-changelog-release-head").click();
    await expect(release).toHaveAttribute("open", "");
    await expect(release.locator(".rr-changelog-group-title").first()).toContainText("Features");

    // * AUTOSAVE round-trip: add a site rule, make it NON-EMPTY
    //   (prune-on-save drops entirely-empty rows/groups — documented save
    //   policy; the autosave PAUSES while empty rows exist), then wait for the
    //   2 s debounce to persist — no manual click (Close has its own flush
    //   test below). Verify the polyfill's storage mirror got it.
    await dashboard.getByRole("tab", { name: "Rules" }).click();
    await dashboard.getByRole("button", { name: "Add site rule" }).click();
    await expect(dashboard.locator(".rr-master-site")).toHaveCount(2);

    const newSite = dashboard.locator(".rr-master-site").nth(1);
    // * SINGLE-OPEN accordion: groups render FOLDED — unfold before touching
    //   its body (the site-row input + the add-rule action live inside details).
    await newSite.locator(".rr-group-summary").click();
    await newSite.getByRole("textbox", { name: "Site", exact: true }).fill("/e2e\\.test/");
    await newSite.getByRole("button", { name: "Add rule" }).click();
    // * Add rule opens the new rule inline — no extra click.
    const detailInputs = dashboard.locator(".rr-master-rule[open] .rr-input");
    await detailInputs.nth(0).fill("/old/");
    await detailInputs.nth(1).fill("/new/");

    // * Changes counter: +1 site +1 rule = 2 — the
    //   field fills modify ALREADY-changed rows and add nothing. The count is
    //   part of the pending status label while the debounce is still armed.
    await expect(dashboard.locator(".rr-status-pending")).toContainText("saving 2 changes");

    // * The debounce commits ≤ ~2 s after the last change (pad the timeout for
    //   slow CI); the status line confirms the automatic apply.
    await expect
        .poll(
            async () => {
                const raw = await page.evaluate(() => localStorage.getItem("rrGM_settings"));
                return raw === null ? 0 : (JSON.parse(raw) as { rules: unknown[] }).rules.length;
            },
            { timeout: 8000 },
        )
        .toBe(2);
    await expect(dashboard.locator(".rr-status")).toContainText("saved at");

    const persisted = await page.evaluate(() => {
        const raw = localStorage.getItem("rrGM_settings");
        return raw === null ? null : (JSON.parse(raw) as { rules: Array<{ siteRegex: string }> });
    });
    expect(persisted?.rules[1]?.siteRegex).toBe("/e2e\\.test/");
});

test("a card reset shows an undo toast and restores the previous values", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);
    await dashboard.getByRole("tab", { name: "System" }).click();

    const panel = dashboard.locator(".rr-tab-panel--active");
    const scheme = panel.getByRole("group", { name: "Color scheme" });
    await scheme.getByText("Light", { exact: true }).click();
    await expect(scheme.getByRole("radio", { name: "Light" })).toBeChecked();

    await panel.getByRole("button", { name: "Reset Appearance to defaults" }).click();
    const toast = dashboard.locator(".rr-toast");
    await expect(toast).toContainText("Defaults restored — Appearance.");
    await expect(scheme.getByRole("radio", { name: "Auto" })).toBeChecked();

    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(scheme.getByRole("radio", { name: "Light" })).toBeChecked();
});

test("the autosave speed pill cycles and persists the delay", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);
    const pill = dashboard.locator(".rr-autosave-toggle");

    // * Canonical cycle: normal (2 s) → slow (5 s) → fast (1 s). The speed
    //   click itself re-arms the debounce and draws the countdown ring.
    await expect(pill).toHaveAttribute("aria-label", "Autosave delay: Normal · 2 s");
    await pill.click();
    await expect(pill).toHaveAttribute("aria-label", "Autosave delay: Slow · 5 s");
    await expect(pill).toHaveAttribute("data-speed", "slow");

    await pill.click();
    await expect(pill).toHaveAttribute("aria-label", "Autosave delay: Fast · 1 s");
    await expect(pill).toHaveAttribute("data-speed", "fast");
    await expect(dashboard.locator(".rr-status-ring")).toHaveCount(1);
    await expect(dashboard.locator(".rr-status-check")).toHaveCount(0);
    await expect(dashboard.locator(".rr-autosave-toggle .rr-status-ring")).toHaveCount(0);

    // * Fast = 1 s → the setting persists after that debounce; then the ring
    //   disappears (idle/applied). Slow CI gets a padded timeout.
    await expect
        .poll(
            async () => {
                const raw = await page.evaluate(() => localStorage.getItem("rrGM_settings"));
                return raw === null ? null : (JSON.parse(raw) as { autosaveDelayMs?: number }).autosaveDelayMs;
            },
            { timeout: 8000 },
        )
        .toBe(1000);
    await expect(dashboard.locator(".rr-status-ring")).toHaveCount(0);
    await expect(dashboard.locator(".rr-status-check")).toHaveCount(1);
});

test("the close button flushes the pending autosave synchronously", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);

    // * Slow (5 s) guarantees the close flush — not the debounce — persists.
    const pill = dashboard.locator(".rr-autosave-toggle");
    await pill.click();
    await expect(pill).toHaveAttribute("data-speed", "slow");

    const seeded = dashboard.locator(".rr-master-site").first();
    await seeded.locator(".rr-group-summary").click();
    await seeded.getByRole("textbox", { name: "Site", exact: true }).fill("/localhost-edited/");
    await expect(dashboard.locator(".rr-status-pending")).toContainText("saving 1 change");

    // * Close = synchronous flush (GM writes are sync) → the tab may go away
    //   while the click action is still settling, so the rejection is expected.
    const closed = dashboard.waitForEvent("close");
    await dashboard
        .getByRole("button", { name: "Close", exact: true })
        .click()
        .catch(() => undefined);
    await closed;

    const persisted = await page.evaluate(() => {
        const raw = localStorage.getItem("rrGM_settings");
        return raw === null
            ? null
            : (JSON.parse(raw) as { autosaveDelayMs?: number; rules: Array<{ siteRegex: string }> });
    });
    expect(persisted?.rules[0]?.siteRegex).toBe("/localhost-edited/");
    expect(persisted?.autosaveDelayMs).toBe(5000);
});

test("two dashboards stay in sync (remote reload while clean)", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboardA = await openDashboardTab(page);
    // * MULTI-DASHBOARD: the second menu click opens a SECOND tab.
    const dashboardB = await openDashboardTab(page);
    await expect(page.context().pages()).toHaveLength(3);

    // * A: add a valid group + rule (the same round-trip shape as above).
    await dashboardA.getByRole("button", { name: "Add site rule" }).click();
    const newSite = dashboardA.locator(".rr-master-site").nth(1);
    await newSite.locator(".rr-group-summary").click();
    await newSite.getByRole("textbox", { name: "Site", exact: true }).fill("/sync\\.test/");
    await newSite.getByRole("button", { name: "Add rule" }).click();
    // * Add rule opens the new rule inline.
    const detailInputs = dashboardA.locator(".rr-master-rule[open] .rr-input");
    await detailInputs.nth(0).fill("/old/");
    await detailInputs.nth(1).fill("/new/");

    // * A's autosave commits after the debounce → B (CLEAN) adopts the remote
    //   write through the storage event — the new group appears in B's list
    //   and B stays CLEAN (no pending save — no write-back, no ping-pong).
    await expect(dashboardB.locator(".rr-master-site")).toHaveCount(2, { timeout: 8000 });
    await expect(dashboardB.locator(".rr-status-pending")).toHaveCount(0);

    // * A confirms its own automatic apply.
    await expect(dashboardA.locator(".rr-status")).toContainText("saved at");
});

test("the undo button restores the dashboard's opening state", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);

    // * Change the seeded gate + let the AUTOSAVE commit — the undo must stay
    //   available AFTER a commit (it IS the safety net for automatic saves).
    const seeded = dashboard.locator(".rr-master-site").first();
    await seeded.locator(".rr-group-summary").click();
    await seeded.getByRole("textbox", { name: "Site", exact: true }).fill("/localhost-edited/");
    await expect(dashboard.getByRole("button", { name: "Undo" })).toBeEnabled();
    await expect
        .poll(async () => (await page.evaluate(() => localStorage.getItem("rrGM_settings"))) ?? "", { timeout: 8000 })
        .toContain("localhost-edited");

    // * The restore confirm needs an ACCEPT (Playwright auto-dismisses native
    //   dialogs, which would REJECT the restore).
    dashboard.once("dialog", (dialog) => dialog.accept());
    await dashboard.getByRole("button", { name: "Undo" }).click();

    // * Back to the opening state: input value + persisted + undo disabled.
    await expect(seeded.getByRole("textbox", { name: "Site", exact: true })).toHaveValue("/localhost/");
    await expect(dashboard.getByRole("button", { name: "Undo" })).toBeDisabled();
    const persisted = await page.evaluate(() => {
        const raw = localStorage.getItem("rrGM_settings");
        return raw === null ? null : (JSON.parse(raw) as { rules: Array<{ siteRegex: string }> });
    });
    expect(persisted?.rules[0]?.siteRegex).toBe("/localhost/");
});

test("the row grip reorders rules by drag and Arrow keys", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);

    // * No global drag lock anymore (ADR 0029).
    await expect(dashboard.locator(".rr-lock-toggle")).toHaveCount(0);

    const site = dashboard.locator(".rr-master-site").first();
    // * One site in the seed → the site row has no grip.
    await expect(site.locator("> .rr-group-summary > .rr-drag-handle")).toHaveCount(0);
    await site.locator(".rr-group-summary").click();

    const rules = site.locator(".rr-master-rule");
    await expect(rules.first()).toBeVisible();
    const labels = () => site.locator(".rr-master-rule-label").allTextContents();
    const before = await labels();
    expect(before.length).toBe(5);

    // * Drag the first rule grip onto the third row's upper half (pointer path).
    const grip = rules.first().locator(".rr-drag-handle");
    const gripBox = await grip.boundingBox();
    const targetBox = await rules.nth(2).boundingBox();
    expect(gripBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    await dashboard.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
    await dashboard.mouse.down();
    await dashboard.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + 8, { steps: 10 });
    await dashboard.mouse.up();
    await expect.poll(labels).toEqual([before[1], before[0], ...before.slice(2)]);

    // * Keyboard reorder moves the first rule back down one position.
    await rules.first().locator(".rr-drag-handle").focus();
    await dashboard.keyboard.press("ArrowDown");
    await expect.poll(labels).toEqual(before);

    // * A grip click must not unfold the rule row.
    await rules.first().locator(".rr-drag-handle").click();
    expect(await rules.first().evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
});

test("the row grip reorders rules with a touch pointer", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);

    const site = dashboard.locator(".rr-master-site").first();
    await site.locator(".rr-group-summary").click();
    const rules = site.locator(".rr-master-rule");
    await expect(rules.first()).toBeVisible();
    const labels = () => site.locator(".rr-master-rule-label").allTextContents();
    const before = await labels();
    expect(before.length).toBe(5);

    // * Synthetic touch pointer (Firefox has no touchscreen API): the grip and
    //   the controller run the same pointer path as a finger.
    const grip = rules.last().locator(".rr-drag-handle");
    const gripBox = await grip.boundingBox();
    const targetBox = await rules.first().boundingBox();
    expect(gripBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    const x = gripBox!.x + gripBox!.width / 2;
    const startY = gripBox!.y + gripBox!.height / 2;
    const endY = targetBox!.y + 6;
    const init = (y: number, buttons: number) => ({
        pointerId: 41,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
    });
    await grip.dispatchEvent("pointerdown", init(startY, 1));
    await grip.dispatchEvent("pointermove", init(startY - 12, 1));
    await grip.dispatchEvent("pointermove", init(endY, 1));
    await grip.dispatchEvent("pointerup", init(endY, 0));
    await expect.poll(labels).toEqual([before[4], ...before.slice(0, 4)]);
});

test("the rail exposes vertical tabs, the locale popup, and the version", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);

    // * Rail navigation replaces the header tabs.
    await expect(dashboard.locator(".rr-rail")).toBeVisible();
    const tablist = dashboard.locator(".rr-rail-tabs");
    await expect(tablist).toHaveAttribute("aria-orientation", "vertical");
    await expect(tablist.getByRole("tab")).toHaveCount(5);

    // * The status line lives in the header now — exactly one instance.
    await expect(dashboard.locator(".rr-header .rr-status")).toHaveCount(1);
    // * Version in the rail footer (the dev polyfill value is not asserted).
    await expect(dashboard.locator(".rr-rail-version")).toHaveText(/\S+/);

    // * Locale popup: Auto stays selectable; Deutsch relabels the rail at once.
    await dashboard.locator(".rr-lang-toggle").click();
    const menu = dashboard.locator(".rr-locale-menu");
    await expect(menu.getByRole("button", { name: "Deutsch" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Auto" })).toBeVisible();
    await menu.getByRole("button", { name: "Deutsch" }).click();
    await expect(dashboard.locator(".rr-lang-toggle")).toHaveText("DE");
    await expect(dashboard.getByRole("tab", { name: "Regeln" })).toBeVisible();

    // * Auto resolves back to the test browser's English locale.
    await dashboard.locator(".rr-lang-toggle").click();
    await dashboard.locator(".rr-locale-menu").getByRole("button", { name: "Auto" }).click();
    await expect(dashboard.locator(".rr-lang-toggle")).toHaveText("EN");
    await expect(dashboard.getByRole("tab", { name: "Rules" })).toBeVisible();
});

test("the rail footer lays out the utility pills as a 2×2 grid", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);

    const boxes = async () => {
        const [theme, lang, visibility, autosave] = await Promise.all([
            dashboard.locator(".rr-theme-toggle").boundingBox(),
            dashboard.locator(".rr-lang-toggle").boundingBox(),
            dashboard.locator(".rr-visibility-toggle").boundingBox(),
            dashboard.locator(".rr-autosave-toggle").boundingBox(),
        ]);
        return { theme, lang, visibility, autosave };
    };

    const layout = await boxes();
    expect(layout.theme && layout.lang && layout.visibility && layout.autosave).toBeTruthy();

    // * Row 1 = theme + locale, row 2 = global skipped-step switch + autosave.
    expect(Math.abs(layout.theme!.y - layout.lang!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.visibility!.y - layout.autosave!.y)).toBeLessThanOrEqual(1);
    expect(layout.visibility!.y).toBeGreaterThan(layout.lang!.y);

    // * Columns stay aligned across both rows.
    expect(Math.abs(layout.theme!.x - layout.visibility!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.lang!.x - layout.autosave!.x)).toBeLessThanOrEqual(1);

    // * The open locale popover is absolutely positioned and consumes no cell.
    await dashboard.locator(".rr-lang-toggle").click();
    await expect(dashboard.locator(".rr-locale-menu")).toBeVisible();
    const afterPopover = await boxes();
    expect(Math.abs(afterPopover.lang!.y - layout.lang!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterPopover.visibility!.y - layout.visibility!.y)).toBeLessThanOrEqual(1);
});

test("the global skipped-step switch persists, and the local button overrides it", async ({ page }) => {
    // * One applied + one skipped rule: the site-gate step is always rendered.
    await injectUserscript(page, {
        settings: {
            locale: "en",
            rules: [
                {
                    siteRegex: "localhost",
                    previewEntries: [{ url: "http://localhost/start.html", testOutputUri: "" }],
                    rules: [
                        { kind: "replace", regex: "/start\\.html/", substitution: "done.html" },
                        { kind: "replace", regex: "/never-matches/", substitution: "x" },
                    ],
                },
            ],
        },
    });
    await page.goto("/");
    const dashboard = await openDashboardTab(page);

    await dashboard.locator(".rr-master > details.rr-master-site").first().locator("> .rr-group-summary").click();
    const previewRow = dashboard.locator(".rr-preview-zone details.rr-ed-preview").first();
    await expect(previewRow).toHaveCount(1);
    await previewRow.locator("> .rr-group-summary").click();

    const steps = dashboard.locator(".rr-preview-zone .rr-steps > details.rr-step-group");
    const toggle = dashboard.locator(".rr-rail-tools .rr-visibility-toggle");
    const local = dashboard.locator(".rr-preview-zone .rr-btn--visibility");

    // * Default = show skipped: site gate + applied + skipped.
    await expect(steps).toHaveCount(3);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(steps).toHaveCount(2);

    // * A local click wins over the global default.
    await local.click();
    await expect(steps).toHaveCount(3);
    await expect(local).toHaveClass(/rr-btn--local-override/);

    // * Autosave persists only the global value — the exception stays in-memory.
    await expect(dashboard.locator(".rr-status")).toContainText("saved at", { timeout: 10000 });
    const stored = await dashboard.evaluate(() =>
        (window as unknown as { GM_getValue: (key: string, fallback: unknown) => unknown }).GM_getValue(
            "settings",
            null,
        ),
    );
    expect((stored as { hideSkipped?: boolean }).hideSkipped).toBe(true);

    // * Flipping the global switch clears every local exception.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(steps).toHaveCount(3);
    await expect(local).not.toHaveClass(/rr-btn--local-override/);
});

test("the theme toggle cycles auto → dark → light (T hotkey) onto <html>", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);

    // * ADR 0013: the persisted theme mirrors onto the takeover <html>.
    const html = dashboard.locator("html");
    await expect(html).toHaveAttribute("data-theme", "auto");

    const toggle = dashboard.locator(".rr-theme-toggle");
    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(toggle.locator("svg")).toHaveCount(1);
    await expect(toggle).toHaveAttribute("aria-label", "Dark");
    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "light");

    // * T hotkey cycles back to auto (focus is on the rail pill — not editable).
    await dashboard.keyboard.press("t");
    await expect(html).toHaveAttribute("data-theme", "auto");
});

test("the assistant copies without a target and imports a new group", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);

    const assistantTab = dashboard.getByRole("tab", { name: "Assistant" });
    await assistantTab.click();
    await expect(assistantTab).toHaveAttribute("aria-selected", "true");

    // * Provider hand-off is static external links only (no API, no prefill).
    await expect(dashboard.locator(".rr-provider")).toHaveCount(9);
    const kimiLink = dashboard.getByRole("link", { name: "Kimi" });
    await expect(kimiLink).toHaveAttribute("href", "https://www.kimi.com/");
    await expect(kimiLink).toHaveAttribute("target", "_blank");
    await expect(kimiLink).toHaveAttribute("rel", "noopener noreferrer");

    // * No target selection needed: the copy button is enabled on entry.
    await expect(dashboard.getByRole("heading", { name: "Tell the URL what to do." })).toBeVisible();
    const copy = dashboard.getByTestId("assistant-copy-prompt");
    await expect(copy).toBeEnabled();
    await copy.click();
    await expect(dashboard.locator(".rr-toast")).toBeVisible();

    const fallback = dashboard.getByTestId("assistant-prompt-fallback");
    await expect(fallback).toHaveValue(/Redirect Rules/);
    await expect(fallback).toHaveValue(/"siteRegex": "\/localhost\/"/);
    await expect(fallback).toHaveValue(/"rules": \[/);
    await expect(fallback).toHaveValue(/redirect-me/);

    // * The target select is always visible; "Automatic" drops the group dump
    //   and the LLM is told to ask for the target site instead.
    const targetSelect = dashboard.getByTestId("assistant-target-site");
    await expect(targetSelect).toBeVisible();
    await targetSelect.selectOption("");
    await expect(fallback).toHaveValue(/\(none — ask the user for the target site in the chat\.\)/);
    await expect(dashboard.locator(".rr-asst-summary-cell code").first()).toHaveText("auto");

    await expect(dashboard.getByTestId("assistant-paste")).toBeVisible();

    // * Fenced group answer with a new gate → new group, two rules.
    await dashboard.getByTestId("chat-import-box").fill(
        "```json\n" +
            JSON.stringify({
                siteRegex: "/imported\\.test/",
                rules: [
                    { kind: "replace", regex: "/import-me\\.html/", substitution: "imported.html" },
                    { kind: "appendQuery", params: "a=1" },
                ],
            }) +
            "\n```",
    );

    const dest = dashboard.locator(".rr-asst-dest");
    await expect(dest).toContainText("Target: new group /imported\\.test/");
    await expect(dest).toContainText("New rules: 2");
    await expect(dashboard.getByTestId("assistant-import")).toBeEnabled();
    await dashboard.getByTestId("assistant-import").click();
    await expect(dashboard.locator(".rr-toast")).toContainText("Configuration imported successfully");

    const success = dashboard.getByTestId("assistant-import-success");
    await expect(success).toBeVisible();
    await expect(success).toContainText("Rules imported: 2");

    // * The new group is persisted through the autosave debounce.
    await expect
        .poll(
            () =>
                dashboard.evaluate(() => {
                    const raw = localStorage.getItem("rrGM_settings");
                    if (raw === null) return null;
                    const parsed = JSON.parse(raw) as { rules: Array<{ siteRegex: string; rules: unknown[] }> };
                    const group = parsed.rules.find((site) => site.siteRegex === "/imported\\.test/");
                    return group?.rules.length ?? null;
                }),
            { timeout: 8000 },
        )
        .toBe(2);

    // * Open in Rules reveals the first imported rule in the new group.
    await success.getByRole("button", { name: "Open in Rules" }).click();
    await expect(dashboard.getByRole("tab", { name: "Rules" })).toHaveAttribute("aria-selected", "true");
    await expect(dashboard.locator("details.rr-master-rule[open]")).toContainText("/import-me\\.html/");

    // * The old FAB/popover surface is gone — the assistant owns the hand-off.
    // * The info popovers live on the rule fields; they must stay closed here.
    await expect(dashboard.locator(".rr-btn--chat-fab")).toHaveCount(0);
    await expect(dashboard.locator(".rr-info-pop:popover-open")).toHaveCount(0);
});

test("the assistant reuses a matching group and skips an existing rule", async ({ page }) => {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);

    await dashboard.getByRole("tab", { name: "Assistant" }).click();
    await dashboard.getByTestId("chat-import-box").fill(
        JSON.stringify({
            siteRegex: "localhost",
            rules: [
                { kind: "replace", regex: "/redirect-me\\.html/", substitution: "redirected.html" },
                { kind: "replace", regex: "/brand-new\\.html/", substitution: "brand-new-target.html" },
            ],
        }),
    );

    const dest = dashboard.locator(".rr-asst-dest");
    await expect(dest).toContainText("Target: /localhost/ (existing)");
    await expect(dest).toContainText("New rules: 1");
    await expect(dest).toContainText("Already present: 1");

    await dashboard.getByTestId("assistant-import").click();
    await expect(dashboard.getByTestId("assistant-import-success")).toContainText("Rules imported: 1");

    // * No duplicate group: the seeded group gained exactly one rule.
    await expect
        .poll(
            () =>
                dashboard.evaluate(() => {
                    const raw = localStorage.getItem("rrGM_settings");
                    if (raw === null) return null;
                    const parsed = JSON.parse(raw) as {
                        rules: Array<{ siteRegex: string; rules: unknown[] }>;
                    };
                    return { groups: parsed.rules.length, rules: parsed.rules[0]?.rules.length ?? null };
                }),
            { timeout: 8000 },
        )
        .toEqual({ groups: 1, rules: 6 });
});

test("a site-gate manual opens only its own group's popover", async ({ page }) => {
    await injectUserscript(page, {
        settings: {
            locale: "en",
            rules: ["one", "two", "three"].map((name) => ({
                siteRegex: `/${name}\\.test/`,
                rules: [{ kind: "replace", regex: "/old/", substitution: "new" }],
            })),
        },
    });
    await page.goto("/");
    const dashboard = await openDashboardTab(page);
    const groups = dashboard.locator(".rr-master > details.rr-master-site");
    await expect(groups).toHaveCount(3);

    const target = groups.nth(1);
    await target.locator("> .rr-group-summary").click();
    const trigger = target.locator(".rr-site-gate").getByRole("button", { name: "Regex manual" });
    const pop = target.locator(".rr-info-pop--manual");
    await trigger.click();
    await expect(pop).toBeVisible();

    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.waitForTimeout(500);
    await expect(pop).toBeVisible();

    // * Folded groups keep their triggers in the DOM — a shared slot would make
    //   every gate show its manual and auto-close the previous one.
    for (const index of [0, 2]) {
        await expect(groups.nth(index).locator(".rr-info-pop--manual")).not.toBeVisible();
        await expect(groups.nth(index).locator(".rr-info-trigger")).toHaveAttribute("aria-expanded", "false");
    }

    await dashboard.keyboard.press("Escape");
    await expect(pop).not.toBeVisible();
    await expect(trigger).toBeFocused();
});

test("re-clicking a reference trigger keeps its popover open", async ({ page }) => {
    await injectUserscript(page, {
        settings: {
            locale: "en",
            rules: [
                {
                    siteRegex: "/example\\.test/",
                    rules: [{ kind: "replace", regex: "/old/", substitution: "new" }],
                },
            ],
        },
    });
    await page.goto("/");
    const dashboard = await openDashboardTab(page);
    const site = dashboard.locator(".rr-master > details.rr-master-site").first();
    await site.locator("> .rr-group-summary").click();
    const siteGate = site.locator(".rr-site-gate");
    const trigger = siteGate.getByRole("button", { name: "Regex manual" });
    const pop = siteGate.locator(".rr-info-pop--manual");

    await trigger.click();
    await expect(pop).toBeVisible();
    // * Show-only trigger: a second click must NOT toggle the panel closed.
    await trigger.click();
    await expect(pop).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.waitForTimeout(300);
    await expect(pop).toBeVisible();

    await dashboard.keyboard.press("Escape");
    await expect(pop).not.toBeVisible();
    await expect(trigger).toBeFocused();
});

test("the field reference triggers anchor top-layer popovers for tokens and the manual", async ({ page }) => {
    await injectUserscript(page, {
        settings: {
            locale: "en",
            rules: [
                {
                    siteRegex: "/example\\.test/",
                    rules: [
                        { kind: "replace", regex: "/old/", substitution: "new" },
                        { kind: "appendQuery", regex: "/append/", params: "k=v" },
                        { kind: "checkpoint", regex: "/gate/", mode: "continue" },
                    ],
                },
            ],
        },
    });
    await page.goto("/");
    const dashboard = await openDashboardTab(page);

    const site = dashboard.locator(".rr-master > details.rr-master-site").first();
    await site.locator("> .rr-group-summary").click();

    // * Site gate: escape toggle first, manual trigger last, both in the field.
    const siteGate = site.locator(".rr-site-gate");
    const siteTrail = siteGate.locator(".rr-input-affix-trail");
    const siteManualTrigger = siteTrail.getByRole("button", { name: "Regex manual" });
    await expect(siteTrail.getByRole("button")).toHaveCount(2);
    await expect(siteTrail.locator("> button").last()).toHaveAccessibleName("Regex manual");
    await expect(siteManualTrigger).toHaveAttribute("aria-expanded", "false");

    const siteManualPop = siteGate.locator(".rr-info-pop--manual");
    await expect(siteManualPop).not.toBeVisible();
    await siteManualTrigger.click();
    await expect(siteManualTrigger).toHaveAttribute("aria-expanded", "true");
    await expect(siteManualPop).toBeVisible();
    await page.waitForTimeout(750);
    await expect(siteManualPop).toBeVisible();
    await expect(siteManualPop).toContainText("Regex manual");
    await dashboard.keyboard.press("Escape");
    await expect(siteManualPop).not.toBeVisible();
    await expect(siteManualTrigger).toBeFocused();

    const rules = site.locator(".rr-master-rule");
    await rules.first().locator("> .rr-master-rule-summary").click();

    const fields = rules.first().locator(".rr-ed-fields");
    const tokenTrigger = fields.getByRole("button", { name: "Token reference" });
    const manualTrigger = fields.getByRole("button", { name: "Regex manual" });
    await expect(tokenTrigger).toHaveCount(1);
    await expect(manualTrigger).toHaveCount(1);
    await expect(tokenTrigger).toHaveAttribute("aria-expanded", "false");
    await expect(manualTrigger).toHaveAttribute("aria-expanded", "false");
    await expect(fields.locator(".rr-field-control .rr-info-trigger")).toHaveCount(2);
    await expect(fields.locator(".rr-row-label .rr-info-trigger")).toHaveCount(0);

    const tokenPop = dashboard.locator(".rr-info-pop--tokens");
    const manualPop = fields.locator(".rr-info-pop--manual");
    await expect(tokenPop).toHaveCount(1);
    await expect(manualPop).toHaveCount(1);
    await expect(tokenPop).not.toBeVisible();
    await expect(manualPop).not.toBeVisible();

    // * Manual: 5 groups, 18 token rows, examples folded until the group toggle.
    await manualTrigger.click();
    await expect(manualTrigger).toHaveAttribute("aria-expanded", "true");
    await expect(manualPop).toBeVisible();
    await expect(manualPop).toHaveRole("dialog");
    await expect(manualPop).toContainText("Regex manual");
    await expect(manualPop.locator(".rr-manual-group-row")).toHaveCount(5);
    await expect(manualPop.locator(".rr-manual-row")).toHaveCount(18);

    // * No manual lead; the one Examples toggle lives in the Meaning table
    //   head instead of its own toolbar band or column.
    await expect(manualPop.locator(".rr-info-pop-lead")).toHaveCount(0);
    await expect(manualPop.locator(".rr-manual-toolbar")).toHaveCount(0);
    await expect(manualPop.locator(".rr-manual-table thead .rr-manual-examples-toggle")).toHaveCount(1);

    const firstExample = manualPop.locator(".rr-manual-example").first();
    const exampleToggle = manualPop.getByRole("button", { name: "Examples" });
    await expect(exampleToggle).toHaveCount(1);
    await expect(firstExample).toBeHidden();
    await exampleToggle.click();
    await expect(firstExample).toBeVisible();

    // * Escape closes the manual (not the dashboard) and returns focus.
    await dashboard.keyboard.press("Escape");
    await expect(manualPop).not.toBeVisible();
    await expect(manualTrigger).toBeFocused();
    await expect(dashboard.locator(".rr-dashboard")).toBeVisible();

    // * Switching from the rule manual to the site manual keeps the site one open.
    await manualTrigger.click();
    await expect(manualPop).toBeVisible();
    await siteManualTrigger.click();
    await expect(siteManualPop).toBeVisible();
    await page.waitForTimeout(750);
    await expect(siteManualPop).toBeVisible();
    await expect(manualPop).not.toBeVisible();
    await dashboard.keyboard.press("Escape");

    // * The same direct switch in the other direction must survive too.
    await siteManualTrigger.click();
    await expect(siteManualPop).toBeVisible();
    await manualTrigger.click();
    await expect(manualPop).toBeVisible();
    await page.waitForTimeout(750);
    await expect(manualPop).toBeVisible();
    await expect(siteManualPop).not.toBeVisible();
    await dashboard.keyboard.press("Escape");

    // * Tokens: kind-specific rows, no manual link anymore.
    await tokenTrigger.click();
    await expect(tokenTrigger).toHaveAttribute("aria-expanded", "true");
    await expect(tokenPop).toBeVisible();
    await expect(tokenPop).toHaveRole("dialog");
    await expect(tokenPop).toContainText("Substitution · token reference");
    await expect(tokenPop.locator(".rr-token-row")).toHaveCount(3);
    await expect(tokenPop.locator(".rr-toklink")).toHaveCount(0);

    // * Viewport-relative placement at the preview column's left edge.
    const [popBox, previewBox] = await Promise.all([
        tokenPop.boundingBox(),
        dashboard.locator(".rr-preview-zone").boundingBox(),
    ]);
    expect(popBox).not.toBeNull();
    expect(previewBox).not.toBeNull();
    expect(popBox!.x).toBeGreaterThanOrEqual(0);
    expect(popBox!.y).toBeGreaterThanOrEqual(0);
    expect(popBox!.x + popBox!.width).toBeLessThanOrEqual((await dashboard.evaluate(() => window.innerWidth)) + 1);
    expect(Math.abs(popBox!.x - (previewBox!.x + 8))).toBeLessThanOrEqual(2);

    await dashboard.keyboard.press("Escape");
    await expect(tokenPop).not.toBeVisible();
    await expect(tokenTrigger).toBeFocused();

    // * Stacked layout (≤ 1100px): the popover opens BELOW the trigger.
    await dashboard.setViewportSize({ width: 1000, height: 800 });
    await tokenTrigger.click();
    await expect(tokenPop).toBeVisible();
    const [stackedPop, stackedTrigger] = await Promise.all([tokenPop.boundingBox(), tokenTrigger.boundingBox()]);
    expect(stackedPop).not.toBeNull();
    expect(stackedTrigger).not.toBeNull();
    expect(Math.abs(stackedPop!.y - (stackedTrigger!.y + stackedTrigger!.height + 8))).toBeLessThanOrEqual(2);
    // * The trigger sits at the field's right edge: the popover is clamped into
    //   the viewport instead of staying x-aligned with the trigger.
    expect(stackedPop!.x).toBeGreaterThanOrEqual(0);
    expect(stackedPop!.x + stackedPop!.width).toBeLessThanOrEqual(
        (await dashboard.evaluate(() => window.innerWidth)) + 1,
    );
    await dashboard.keyboard.press("Escape");
    await dashboard.setViewportSize({ width: 1280, height: 720 });

    // * appendQuery swaps the token set + title live.
    await rules.nth(1).locator("> .rr-master-rule-summary").click();
    const paramsFields = rules.nth(1).locator(".rr-ed-fields");
    const paramsTrigger = paramsFields.getByRole("button", { name: "Token reference" });
    await paramsTrigger.click();
    await expect(tokenPop).toContainText("Params · token reference");
    await expect(tokenPop.locator(".rr-token-row")).toHaveCount(5);
    await dashboard.keyboard.press("Escape");

    // * Checkpoint: no token trigger, but the manual trigger stays; no disclosure.
    await rules.nth(2).locator("> .rr-master-rule-summary").click();
    const checkpointFields = rules.nth(2).locator(".rr-ed-fields");
    await expect(checkpointFields.getByRole("button", { name: "Token reference" })).toHaveCount(0);
    await expect(checkpointFields.getByRole("button", { name: "Regex manual" })).toHaveCount(1);
    await expect(checkpointFields.locator(".rr-manual-disclosure")).toHaveCount(0);
});

test("the popover header is a grab handle and keeps the close click", async ({ page }) => {
    await injectUserscript(page, {
        settings: {
            locale: "en",
            rules: [
                {
                    siteRegex: "/example\\.test/",
                    rules: [{ kind: "replace", regex: "/old/", substitution: "new" }],
                },
            ],
        },
    });
    await page.goto("/");
    const dashboard = await openDashboardTab(page);
    const site = dashboard.locator(".rr-master > details.rr-master-site").first();
    await site.locator("> .rr-group-summary").click();
    const rule = site.locator(".rr-master-rule").first();
    await rule.locator("> .rr-master-rule-summary").click();
    const trigger = rule.locator(".rr-ed-fields").getByRole("button", { name: "Regex manual" });
    const pop = rule.locator(".rr-info-pop--manual");
    await trigger.click();
    await expect(pop).toBeVisible();

    // * Header = card-head band: title only; the manual carries no lead anymore.
    await expect(pop.locator(".rr-info-pop-head .rr-info-pop-lead")).toHaveCount(0);
    await expect(pop.locator(".rr-info-pop-head .rr-info-pop-title")).toHaveText("Regex manual");
    await expect(pop.locator("> .rr-info-pop-lead")).toHaveCount(0);

    const [before, header, vw, vh] = await Promise.all([
        pop.boundingBox(),
        pop.locator(".rr-info-pop-head").boundingBox(),
        dashboard.evaluate(() => window.innerWidth),
        dashboard.evaluate(() => window.innerHeight),
    ]);
    expect(before).not.toBeNull();
    expect(header).not.toBeNull();

    // * Drag left/up (near the right clamp a positive X would not move) and
    //   compare against the same MARGIN clamp the handler applies.
    const dx = -60;
    const dy = -40;
    await dashboard.mouse.move(header!.x + header!.width / 2, header!.y + header!.height / 2);
    await dashboard.mouse.down();
    await dashboard.mouse.move(header!.x + header!.width / 2 + dx, header!.y + header!.height / 2 + dy, { steps: 5 });
    await dashboard.mouse.up();

    const after = await pop.boundingBox();
    expect(after).not.toBeNull();
    const expectedX = Math.min(Math.max(before!.x + dx, 8), vw - after!.width - 8);
    const expectedY = Math.min(Math.max(before!.y + dy, 8), vh - after!.height - 8);
    expect(Math.abs(after!.x - expectedX)).toBeLessThanOrEqual(2);
    expect(Math.abs(after!.y - expectedY)).toBeLessThanOrEqual(2);

    // * Synthetic touch pointer (Firefox has no touchscreen API): the header
    //   runs the same pointer path as a finger.
    const head = pop.locator(".rr-info-pop-head");
    const touchBefore = await pop.boundingBox();
    const touchHead = await head.boundingBox();
    expect(touchBefore).not.toBeNull();
    expect(touchHead).not.toBeNull();
    const tx = touchHead!.x + touchHead!.width / 2;
    const ty = touchHead!.y + touchHead!.height / 2;
    const touch = (x: number, y: number, buttons: number) => ({
        pointerId: 42,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
    });
    await head.dispatchEvent("pointerdown", touch(tx, ty, 1));
    await head.dispatchEvent("pointermove", touch(tx + 30, ty + 20, 1));
    await head.dispatchEvent("pointerup", touch(tx + 30, ty + 20, 0));
    const touched = await pop.boundingBox();
    expect(touched).not.toBeNull();
    expect(touched!.x).toBeGreaterThan(touchBefore!.x);
    expect(touched!.y).toBeGreaterThan(touchBefore!.y);

    // * Bottom-right grip stretches the panel: width can grow past the 800px
    //   variant width, height past the 72dvh default cap, clamped to the viewport.
    const grip = pop.locator(".rr-info-pop-resize");
    const gripBox = await grip.boundingBox();
    const sizeBefore = await pop.boundingBox();
    expect(gripBox).not.toBeNull();
    expect(sizeBefore).not.toBeNull();
    await dashboard.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
    await dashboard.mouse.down();
    await dashboard.mouse.move(gripBox!.x + gripBox!.width / 2 + 40, gripBox!.y + gripBox!.height / 2 + 30, {
        steps: 5,
    });
    await dashboard.mouse.up();
    const sizeAfter = await pop.boundingBox();
    expect(sizeAfter).not.toBeNull();
    expect(sizeAfter!.width).toBeGreaterThan(sizeBefore!.width);
    expect(sizeAfter!.height).toBeGreaterThan(sizeBefore!.height);
    await expect(pop).toHaveClass(/has-size/);

    // * The close button still owns its click — the header must not swallow it.
    await pop.getByRole("button", { name: "Close" }).click();
    await expect(pop).not.toBeVisible();
    await expect(trigger).toBeFocused();

    // * Stretched size is session-only: reopening returns to the variant width.
    await trigger.click();
    await expect(pop).toBeVisible();
    await expect(pop).toHaveCSS("transform", "none");
    const reopened = await pop.boundingBox();
    expect(reopened).not.toBeNull();
    expect(Math.abs(reopened!.width - sizeBefore!.width)).toBeLessThanOrEqual(2);
    await expect(pop).not.toHaveClass(/has-size/);
    await dashboard.keyboard.press("Escape");
});

test("a kind switch restores the previous kind's distinct fields (session draft)", async ({ page }) => {
    await injectUserscript(page, {
        settings: {
            locale: "en",
            rules: [
                {
                    siteRegex: "/example\\.test/",
                    rules: [{ kind: "replace", regex: "/old/", substitution: "new" }],
                },
            ],
        },
    });
    await page.goto("/");
    const dashboard = await openDashboardTab(page);

    const site = dashboard.locator(".rr-master > details.rr-master-site").first();
    await site.locator("> .rr-group-summary").click();
    const rule = site.locator(".rr-master-rule").first();
    await rule.locator("> .rr-master-rule-summary").click();
    const fields = rule.locator(".rr-ed-fields");

    // * Radio order = replace, appendQuery, removeQuery, checkpoint; the distinct
    //   textarea follows the shared regex field. The native input is visually
    //   hidden behind its label surface, so force the check.
    const kinds = fields.getByRole("radio");
    const textareas = fields.locator("textarea");
    await expect(textareas.nth(1)).toHaveValue("new");

    // * appendQuery starts empty, then owns its params.
    await kinds.nth(1).check({ force: true });
    await expect(textareas.nth(1)).toHaveValue("");
    await textareas.nth(1).fill("a=1");

    // * removeQuery starts empty, then owns its keys.
    await kinds.nth(2).check({ force: true });
    await expect(textareas.nth(1)).toHaveValue("");
    await textareas.nth(1).fill("utm_*");

    // * Back to replace: substitution restored, shared regex untouched.
    await kinds.nth(0).check({ force: true });
    await expect(textareas.nth(0)).toHaveValue("/old/");
    await expect(textareas.nth(1)).toHaveValue("new");

    // * appendQuery draft survives its own round trip too.
    await kinds.nth(1).check({ force: true });
    await expect(textareas.nth(1)).toHaveValue("a=1");

    // * removeQuery draft survives its own round trip too.
    await kinds.nth(2).check({ force: true });
    await expect(textareas.nth(1)).toHaveValue("utm_*");

    // * Checkpoint round trip keeps the replace draft.
    await kinds.nth(3).check({ force: true });
    await kinds.nth(0).check({ force: true });
    await expect(textareas.nth(1)).toHaveValue("new");
});

test("the stats tab renders the hero, donut, field-style last redirect, top rules, groups, and accordion", async ({
    page,
}) => {
    const from = "https://example.com/very/long/original/path?token=abc&more=1";
    const to = "https://example.com/very/long/target/path?token=def&more=2";
    const seededRuleCount = SEEDED_SETTINGS.rules[0].rules.length;
    await injectUserscript(page, {
        settings: SEEDED_SETTINGS,
        stats: { counts: {}, total: 1, last: { from, to, ts: Date.UTC(2026, 10, 3, 12, 0) } },
    });
    await page.goto("/");
    const dashboard = await openDashboardTab(page);
    await dashboard.getByRole("tab", { name: "Stats" }).click();

    // * Hero: all-time redirects, site/active-rule facts, empty donut.
    const hero = dashboard.locator(".rr-stats-hero");
    await expect(hero).toContainText("Total redirects");
    await expect(hero.locator(".rr-stats-hero-total")).toHaveText("1");
    await expect(hero.locator(".rr-stats-fact")).toHaveCount(2);
    await expect(hero.locator(".rr-stats-fact").nth(0)).toContainText("Sites");
    await expect(hero.locator(".rr-stats-fact").nth(0).locator("strong")).toHaveText("1");
    await expect(hero.locator(".rr-stats-fact").nth(1)).toContainText("Active rules");
    await expect(hero.locator(".rr-stats-fact").nth(1).locator("strong")).toHaveText(`0/${seededRuleCount}`);

    const donut = hero.locator(".rr-stats-donut");
    await expect(donut).toHaveClass(/is-empty/);
    await expect(donut.locator(".rr-stats-donut-center strong")).toHaveText("0");
    await expect(hero.locator(".rr-stats-donut-legend li")).toHaveCount(4);
    await expect(hero.locator(".rr-stats-donut-legend li strong")).toHaveText(["0", "0", "0", "0"]);

    // * Last redirect reuses the Rules-tab field surface + URI tones.
    const lastCard = dashboard.locator(".rr-stats-last-card");
    await expect(lastCard.locator(".rr-stats-last-fields dt")).toHaveText(["From", "To"]);
    await expect(lastCard.locator(".rr-stats-last-fields .rr-preview-text")).toHaveText([from, to]);
    await expect(lastCard.locator(".rr-uri-scheme")).toHaveCount(2);
    await expect(lastCard.locator(".rr-uri-host")).toHaveCount(2);
    await expect(lastCard.locator(".rr-uri-query")).toHaveCount(2);
    await expect(lastCard.locator(".rr-stats-last-time")).toHaveCount(1);
    await expect(lastCard.locator(".rr-stats-last-time")).not.toHaveText("");

    // * No hits -> the ranked list shows its empty message.
    const topCard = dashboard.locator("section[aria-labelledby='rr-stats-top-title']");
    await expect(topCard).toContainText("Top rules");
    await expect(topCard.locator(".rr-stats-empty")).toContainText("No hits yet");

    // * Site groups keep the seeded row and the footer facts.
    const siteCard = dashboard.locator("section[aria-labelledby='rr-stats-sites-title']");
    await expect(siteCard.locator(".rr-stats-bar-row")).toHaveCount(1);
    await expect(siteCard.locator(".rr-stats-bar-name")).toHaveText(["localhost"]);
    await expect(siteCard.locator(".rr-stats-foot-label")).toHaveText(["Largest group", "Ø per rule", "No hits"]);
    await expect(siteCard.locator(".rr-stats-foot-cell").nth(0).locator(".rr-stats-foot-value")).toHaveText(
        "localhost",
    );
    await expect(siteCard.locator(".rr-stats-foot-cell").nth(2).locator(".rr-stats-foot-value")).toHaveText(
        String(seededRuleCount),
    );
    await expect(siteCard.locator(".rr-stats-foot-cell").nth(2)).toContainText(
        `${seededRuleCount} of ${seededRuleCount} rules`,
    );

    // * Accordion starts fully closed; opening reveals every configured row.
    const accordion = dashboard.locator("section[aria-labelledby='rr-stats-per-group-title']");
    await expect(accordion.locator("details.rr-stats-acc")).toHaveCount(1);
    await expect(accordion.locator("details.rr-stats-acc[open]")).toHaveCount(0);
    const summary = accordion.locator("details.rr-stats-acc > summary");
    await expect(summary.locator(".rr-stats-acc-name")).toHaveText("localhost");
    await expect(summary.locator(".rr-stats-acc-name")).toHaveAttribute("title", "/localhost/");
    await summary.click();
    await expect(accordion.locator(".rr-stats-bar-row")).toHaveCount(seededRuleCount);
});

test("the stats tab renders a live redirect in the hero, donut, top rules, groups, and accordion", async ({ page }) => {
    await openFixtureWithUserscript(page, "/redirect-me.html");
    await expect.poll(async () => page.url(), { timeout: 10_000 }).toContain("redirected.html");

    const dashboard = await openDashboardTab(page);
    await dashboard.getByRole("tab", { name: "Stats" }).click();

    const seededRuleCount = SEEDED_SETTINGS.rules[0].rules.length;
    const hero = dashboard.locator(".rr-stats-hero");
    // * The dashboard sink seeds from GM storage, so the cross-context write can
    //   land just after the tab opens — poll the hero before the rest.
    await expect
        .poll(async () => (await hero.locator(".rr-stats-hero-total").textContent())?.trim(), { timeout: 10_000 })
        .toBe("1");
    await expect(hero.locator(".rr-stats-fact").nth(0).locator("strong")).toHaveText("1");
    await expect(hero.locator(".rr-stats-fact").nth(1).locator("strong")).toHaveText(`1/${seededRuleCount}`);

    const donut = hero.locator(".rr-stats-donut");
    await expect(donut).not.toHaveClass(/is-empty/);
    await expect(donut.locator(".rr-stats-donut-center strong")).toHaveText("1");
    const legendRows = hero.locator(".rr-stats-donut-legend li");
    await expect(legendRows).toHaveCount(4);
    await expect(legendRows.nth(0).locator("strong")).toHaveText("1");
    await expect(legendRows.nth(0).locator(".rr-stats-donut-share")).toHaveText("100%");
    await expect(legendRows.nth(1).locator("strong")).toHaveText("0");
    await expect(legendRows.nth(1).locator(".rr-stats-donut-share")).toHaveText("0%");
    await expect(legendRows.nth(2).locator("strong")).toHaveText("0");
    await expect(legendRows.nth(2).locator(".rr-stats-donut-share")).toHaveText("0%");
    await expect(legendRows.nth(3).locator("strong")).toHaveText("0");
    await expect(legendRows.nth(3).locator(".rr-stats-donut-share")).toHaveText("0%");

    const lastCard = dashboard.locator(".rr-stats-last-card");
    await expect(lastCard.locator(".rr-stats-last-fields .rr-preview-text").nth(0)).toContainText("/redirect-me.html");
    await expect(lastCard.locator(".rr-stats-last-fields .rr-preview-text").nth(1)).toContainText("/redirected.html");

    const topCard = dashboard.locator("section[aria-labelledby='rr-stats-top-title']");
    await expect(topCard.locator(".rr-stats-top-row")).toHaveCount(1);
    await expect(topCard.locator(".rr-stats-top-name")).toContainText("redirect-me");
    await expect(topCard.locator(".rr-stats-top-count")).toHaveText("1");
    await expect(topCard.locator(".rr-stats-top-site")).toHaveText("localhost");

    const siteCard = dashboard.locator("section[aria-labelledby='rr-stats-sites-title']");
    const footCells = siteCard.locator(".rr-stats-foot-cell");
    await expect(footCells.nth(0).locator(".rr-stats-foot-value")).toHaveText("localhost");
    await expect(footCells.nth(0).locator(".rr-stats-foot-sub")).toHaveText("1 · 100%");
    await expect(footCells.nth(1).locator(".rr-stats-foot-value")).toHaveText("0");
    await expect(footCells.nth(1).locator(".rr-stats-foot-sub")).toHaveText(`1 / ${seededRuleCount}`);
    await expect(footCells.nth(2).locator(".rr-stats-foot-value")).toHaveText(String(seededRuleCount - 1));

    const accordion = dashboard.locator("section[aria-labelledby='rr-stats-per-group-title']");
    await expect(accordion.locator("details.rr-stats-acc")).toHaveCount(1);
    await expect(accordion.locator("details.rr-stats-acc[open]")).toHaveCount(0);
    await accordion.locator("details.rr-stats-acc > summary").click();
    await expect(accordion.locator(".rr-stats-bar-row")).toHaveCount(seededRuleCount);
    await expect(accordion.locator(".rr-stats-bar-row.is-empty")).toHaveCount(seededRuleCount - 1);
    await expect(accordion.locator(".rr-stats-bar-row:not(.is-empty)")).toHaveCount(1);
    await expect(accordion.locator(".rr-stats-bar-row:not(.is-empty) .rr-stats-bar-count")).toHaveText("1");
});

/** Full legacy settings object — all seven fields + rules (replace-eligible). */
function fullLegacySettings(locale: "en" | "de" = "en") {
    return {
        locale,
        logLevel: "info",
        performanceMode: false,
        theme: "auto",
        motion: "normal",
        dashboardHost: "fixed",
        autosaveDelayMs: 2000,
        rules: [
            {
                siteRegex: "/replaced\\.test/",
                rules: [{ kind: "replace", regex: "/a/", substitution: "b" }],
            },
        ],
    };
}

async function openSettingsTab(page: Page): Promise<Page> {
    await openFixtureWithUserscript(page, "/");
    const dashboard = await openDashboardTab(page);
    await dashboard.getByRole("tab", { name: "System" }).click();
    return dashboard;
}

async function importFile(dashboard: Page, name: string, body: unknown): Promise<void> {
    const panel = dashboard.locator(".rr-tab-panel--active");
    await panel.locator("input[type=file]").setInputFiles({
        name,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(body)),
    });
}

test("a partial backup merges only the differing units", async ({ page }) => {
    const dashboard = await openSettingsTab(page);
    await importFile(dashboard, "partial.json", {
        settings: {
            locale: "de",
            rules: [
                {
                    siteRegex: "/imported\\.test/",
                    rules: [{ kind: "replace", regex: "/a/", substitution: "b" }],
                },
            ],
        },
    });

    const dialog = dashboard.locator("dialog.rr-transfer-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Import backup" })).toBeVisible();
    // * Partial file → no mode choice at all; merge is implicit.
    await expect(dialog.locator(".rr-transfer-modes")).toHaveCount(0);
    await expect(dialog.getByRole("radio", { name: "Replace" })).toHaveCount(0);
    await expect(dialog.locator(".rr-transfer-head-note--warn")).toContainText(/partial|unvollständig/i);
    // * Every section starts collapsed; expand to inspect the diff.
    await dialog.getByRole("button", { name: "General", exact: true }).click();
    await expect(dialog.locator(".rr-transfer-row").filter({ hasText: "Language" })).toHaveCount(1);
    await dialog.getByRole("button", { name: "Rules", exact: true }).click();
    await expect(dialog.locator(".rr-transfer-group")).toContainText("imported.test");

    const apply = dialog.getByRole("button", { name: /Apply merge/ });
    await expect(apply).toBeEnabled();
    await apply.click();

    await expect(dialog).toHaveCount(0);
    await expect(dashboard.locator(".rr-toast")).toContainText(/Backup merged\.|Backup zusammengeführt\./);
    await expect(dashboard.locator(".rr-status")).toContainText(/saved at|gespeichert um/);
    // * Locale flipped to German; the imported group is now in the rules list.
    await expect(dashboard.locator(".rr-tab-panel--active")).toContainText("Allgemein");
    await dashboard.getByRole("tab", { name: "Regeln" }).click();
    await expect(dashboard.locator(".rr-master")).toContainText("imported.test");
});

test("a complete backup can replace everything", async ({ page }) => {
    const dashboard = await openSettingsTab(page);
    await importFile(dashboard, "full.json", { settings: fullLegacySettings("de") });

    const dialog = dashboard.locator("dialog.rr-transfer-dialog");
    await expect(dialog).toBeVisible();
    const replaceRadio = dialog.getByRole("radio", { name: "Replace" });
    await expect(replaceRadio).toBeEnabled();
    await dialog.locator(".rr-transfer-modes").getByText("Replace", { exact: true }).click();
    await expect(replaceRadio).toBeChecked();
    await expect(dialog.locator(".rr-transfer-warning")).toBeVisible();

    await dialog.getByRole("button", { name: "Replace everything" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(dashboard.locator(".rr-toast")).toContainText(/Settings replaced\.|Einstellungen ersetzt\./);
    await expect(dashboard.locator(".rr-tab-panel--active")).toContainText("Allgemein");

    await dashboard.getByRole("tab", { name: "Regeln" }).click();
    const groups = dashboard.locator(".rr-master-site");
    await expect(groups).toHaveCount(1);
    await expect(groups.first()).toContainText("replaced.test");
});

test("the export dialog opens with every section collapsed", async ({ page }) => {
    const dashboard = await openSettingsTab(page);
    await dashboard.locator(".rr-tab-panel--active").getByRole("button", { name: "Export backup" }).click();

    const dialog = dashboard.locator("dialog.rr-transfer-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Export backup" })).toBeVisible();

    const toggles = dialog.locator(".rr-transfer-section-toggle");
    await expect(toggles).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) {
        await expect(toggles.nth(index)).toHaveAttribute("aria-expanded", "false");
    }
    const collapsedHeight = (await dialog.boundingBox())!.height;

    await dialog.getByRole("button", { name: "General", exact: true }).click();
    await expect(dialog.locator(".rr-transfer-row").filter({ hasText: "Language" })).toHaveCount(1);
    // * Fixed height: expanding content scrolls the body, it never resizes the dialog.
    const expandedHeight = (await dialog.boundingBox())!.height;
    expect(expandedHeight).toBeCloseTo(collapsedHeight, 0);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
});

test("a tall export dialog scrolls only its body, never the head or footer", async ({ page }) => {
    const dashboard = await openSettingsTab(page);
    await dashboard.setViewportSize({ width: 900, height: 480 });
    await dashboard.locator(".rr-tab-panel--active").getByRole("button", { name: "Export backup" }).click();

    const dialog = dashboard.locator("dialog.rr-transfer-dialog");
    await expect(dialog).toBeVisible();
    for (const name of ["General", "Appearance", "Advanced", "Rules"]) {
        await dialog.getByRole("button", { name, exact: true }).click();
    }

    const body = dialog.locator(".rr-transfer-body");
    const metrics = await body.evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
    }));
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

    await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    const head = await dialog.locator(".rr-transfer-head").boundingBox();
    const footer = await dialog.locator(".rr-transfer-footer").boundingBox();
    expect(head).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(head!.y).toBeGreaterThanOrEqual(0);
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(481);
});

test("an invalid imported unit is disabled, its valid neighbor still applies", async ({ page }) => {
    const dashboard = await openSettingsTab(page);
    await importFile(dashboard, "invalid.json", {
        settings: {
            rules: [
                {
                    siteRegex: "/mixed\\.test/",
                    rules: [
                        { kind: "replace", regex: "/ok/", substitution: "x" },
                        { kind: "replace", regex: "/(bad/", substitution: "y" },
                    ],
                },
            ],
        },
    });

    const dialog = dashboard.locator("dialog.rr-transfer-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".rr-transfer-modes")).toHaveCount(0);
    await expect(dialog.getByRole("radio", { name: "Replace" })).toHaveCount(0);

    await dialog.getByRole("button", { name: "Rules", exact: true }).click();
    await dialog.locator(".rr-transfer-group-toggle").first().click();
    const ruleRows = dialog.locator(".rr-transfer-row--rule");
    await expect(ruleRows).toHaveCount(2);
    await expect(ruleRows.nth(0).locator("input[type=checkbox]")).toBeEnabled();
    await expect(ruleRows.nth(1).locator("input[type=checkbox]")).toBeDisabled();
    await expect(ruleRows.nth(1).locator(".rr-transfer-problem")).toHaveAttribute("aria-label", "Invalid regex");

    await dialog.getByRole("button", { name: /Apply merge/ }).click();
    await expect(dialog).toHaveCount(0);
    await dashboard.getByRole("tab", { name: "Rules" }).click();
    await expect(dashboard.locator(".rr-master")).toContainText("mixed.test");
});

test("unchecking a row keeps it visible in only-differences mode", async ({ page }) => {
    const dashboard = await openSettingsTab(page);
    await importFile(dashboard, "touched.json", {
        settings: { locale: "de", autosaveDelayMs: 2000 },
    });

    const dialog = dashboard.locator("dialog.rr-transfer-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "General", exact: true }).click();
    const themeRow = dialog.locator(".rr-transfer-row").filter({ hasText: "Autosave" });
    // * Equal imported field is hidden by the default differences filter.
    await expect(themeRow).toHaveCount(0);

    await dialog.getByRole("button", { name: "All", exact: true }).click();
    await expect(themeRow).toHaveCount(1);
    const checkbox = themeRow.locator("input[type=checkbox]");
    await expect(checkbox).toBeChecked();
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
    // * Unchecked — but still visible because the user touched it.
    await expect(themeRow).toHaveCount(1);
});

test("ESC closes the transfer dialog without closing the dashboard", async ({ page }) => {
    const dashboard = await openSettingsTab(page);
    await importFile(dashboard, "cancel.json", { settings: { locale: "de" } });

    const dialog = dashboard.locator("dialog.rr-transfer-dialog");
    await expect(dialog).toBeVisible();
    await dashboard.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // * Dashboard still alive and nothing was applied.
    await expect(dashboard.locator(".rr-dashboard")).toBeVisible();
    await expect(dashboard.locator(".rr-tab-panel--active")).toContainText("General");
    await expect(dashboard.locator(".rr-toast")).toHaveCount(0);
});
