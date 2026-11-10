import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildGmPolyfillInitScript, invokeGmCommandWithGesture } from "../helpers/gm-polyfill";
import { loadUserscriptSource } from "../helpers/userscript";
import { defaultSettings, type Settings } from "../../src/lib/core/settings";
import { ruleHash, type Stats } from "../../src/lib/core/stats";

/**
 * README screenshot capture — run with `npm run screenshots` after a build.
 *
 * * Deterministic seed: shipped example groups enabled, English UI, dark theme,
 *   motion off, silent logs, fixed stats counters and last-redirect timestamp.
 * * The webfont is NOT blocked here (unlike the E2E helpers), so the captured UI
 *   uses the real Hack face. Capture once with network access.
 * * Output: `assets/screenshots/*.png` (committed README assets).
 */

const SCREENSHOT_DIR = resolve(process.cwd(), "assets", "screenshots");
const MENU_LABEL = "Redirect Rules: Open Dashboard";
const DASHBOARD_DEADLINE_MS = 20_000;
const STATS_TOTAL = 1_843;
const LAST_REDIRECT_TS = Date.UTC(2026, 10, 9, 18, 42);

/** Real package version — the polyfill otherwise renders its 0.0.0 marker. */
const PACKAGE_VERSION = (
    JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8")) as { version: string }
).version;

mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Seed — stable settings + stats for every capture
// ─────────────────────────────────────────────────────────────────────────────

/** Example groups with a dark English UI and all groups enabled. */
function screenshotSettings(): Settings {
    const settings = defaultSettings();
    settings.locale = "en";
    settings.theme = "dark";
    settings.motion = "aus";
    settings.logLevel = "silent";
    settings.rules = settings.rules.map((site) => ({ ...site, disabled: false }));
    return settings;
}

/** Redirect counters keyed by the real rule content hash. */
function screenshotStats(settings: Settings): Stats {
    const counts: Record<string, number> = {};
    const hits = [212, 168, 143, 121, 97, 84, 73, 61, 52, 44, 38, 31, 26, 21, 17, 14, 11, 9, 7, 5];
    let index = 0;
    for (const site of settings.rules) {
        for (const rule of site.rules) {
            counts[ruleHash(site.siteRegex, rule)] = hits[index % hits.length] ?? 5;
            index += 1;
        }
    }
    return {
        counts,
        total: STATS_TOTAL,
        last: {
            from: "https://www.google.com/search?q=regex+redirect+rules",
            to: "https://www.google.com/search?q=regex+redirect+rules&num=100&udm=14",
            ts: LAST_REDIRECT_TS,
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Dashboard — open the takeover tab without the font abort route
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Installs polyfill + built userscript for the whole context.
 *
 * ! No `blockFontRequests` here — the capture needs the real webfont.
 */
async function injectForScreenshots(page: Page, seed: Record<string, unknown>): Promise<void> {
    await page.context().addInitScript(buildGmPolyfillInitScript(seed));
    await page.context().addInitScript(`window.GM_info.script.version = ${JSON.stringify(PACKAGE_VERSION)};`);
    await page.context().addInitScript(loadUserscriptSource());
    await page.goto("/");
}

/** Opens the dashboard via the GM menu command and waits for the mount. */
async function openDashboard(page: Page): Promise<Page> {
    const deadline = Date.now() + DASHBOARD_DEADLINE_MS;
    while (Date.now() < deadline) {
        const popupPromise = page
            .context()
            .waitForEvent("page", { timeout: 3_000 })
            .catch(() => null);
        await invokeGmCommandWithGesture(page, MENU_LABEL);
        const popup = await popupPromise;
        if (popup === null) continue;
        await popup.waitForSelector(".rr-dashboard", { timeout: 10_000 });
        return popup;
    }
    throw new Error("dashboard tab did not materialize");
}

/** Captures the full dashboard viewport once layout and autosave have settled. */
async function capture(dashboard: Page, name: string): Promise<void> {
    // * Selection persists through autosave — wait out the debounce so the header
    // * does not read "saving changes" in the committed image.
    await expect(dashboard.locator(".rr-status-pending")).toHaveCount(0, { timeout: 10_000 });
    await dashboard.waitForTimeout(300);
    await dashboard.screenshot({
        path: resolve(SCREENSHOT_DIR, `${name}.png`),
        animations: "disabled",
        caret: "hide",
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Captures
// ─────────────────────────────────────────────────────────────────────────────

test("capture the rules tab", async ({ page }) => {
    const settings = screenshotSettings();
    await injectForScreenshots(page, { settings, stats: screenshotStats(settings) });
    const dashboard = await openDashboard(page);

    // * YouTube group (richer chain: removeQuery + replace + checkpoint) with its
    // * first rule open, so the editor dock shows fields, chain, and preview.
    const site = dashboard.locator(".rr-master > details.rr-master-site").nth(1);
    await site.locator("> .rr-group-summary").click();
    const rule = site.locator(".rr-master-rule").first();
    await rule.locator("> .rr-master-rule-summary").click();
    await expect(rule.locator(".rr-ed-fields")).toBeVisible();

    // * Unfold the first test case so the chain steps are part of the shot.
    const previewRow = dashboard.locator(".rr-preview-zone details.rr-ed-preview").first();
    await previewRow.locator("> .rr-group-summary").click();
    await expect(previewRow.locator(".rr-steps").first()).toBeVisible();

    await capture(dashboard, "dashboard-rules");
});

test("capture the stats tab", async ({ page }) => {
    const settings = screenshotSettings();
    await injectForScreenshots(page, { settings, stats: screenshotStats(settings) });
    const dashboard = await openDashboard(page);

    await dashboard.locator("#rr-tab-stats").click();
    await expect(dashboard.locator(".rr-stats-hero-total")).toHaveText(new Intl.NumberFormat("en").format(STATS_TOTAL));

    await capture(dashboard, "dashboard-stats");
});
