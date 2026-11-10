import { defineConfig, devices } from "@playwright/test";
import { FIXTURE_SERVER_PORT } from "./e2e/helpers/fixture-server";

/**
 * Playwright configuration — E2E tests against locally served synthetic fixture pages.
 *
 * ! This config must NEVER hit the live web: the fixture server (node:http) serves
 *   hand-built HTML pages only. Everything the userscript needs (rules, storage) comes
 *   from the GM polyfill's pre-seeded values.
 *
 * What runs here: the built userscript is injected via addInitScript together with the
 * GM polyfill (both pre-document-start — the boot reads no documentElement, so unlike
 * the youtube-ui-tweaks setup the userscript itself is init-script-safe). Specs then
 * assert the EFFECTIVE URL behavior: redirects on load, SPA pushState, query-append
 * with fragment preservation, loop-guard abort, panel smoke.
 *
 * ! E2E runs in Firefox (the userscript's target platform). Run `npm run build` first.
 */
export default defineConfig({
    testDir: "./e2e/tests",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    // * Single worker: the suite is small and the loop-guard specs rely on fast
    //   sequential page loads; serial avoids port contention noise for no real cost.
    workers: 1,
    timeout: 60000,
    reporter: "list",
    use: {
        baseURL: `http://localhost:${FIXTURE_SERVER_PORT}`,
        trace: "on-first-retry",
    },
    projects: [
        {
            name: "firefox",
            use: { ...devices["Desktop Firefox"] },
        },
    ],
    globalSetup: "./e2e/global-setup.ts",
    globalTeardown: "./e2e/global-teardown.ts",
});
