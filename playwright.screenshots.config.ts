import { defineConfig } from "@playwright/test";
import { FIXTURE_SERVER_PORT } from "./e2e/helpers/fixture-server";

/**
 * Screenshot capture config — produces the committed README assets.
 *
 * * NOT part of the CI E2E run: `testDir` points at `e2e/screenshots`, while
 *   `playwright.config.ts` only picks up `e2e/tests`.
 * * Same fixture server as the E2E suite (synthetic pages, no live web).
 * * Requires a prior `npm run build`; run with `npm run screenshots`.
 *
 * ! The jsDelivr font request is deliberately NOT blocked here (unlike the E2E
 *   helpers), so the captured UI uses the real Hack webfont. Capture once with
 *   network access.
 */
export default defineConfig({
    testDir: "./e2e/screenshots",
    outputDir: "test-results/screenshots",
    fullyParallel: false,
    workers: 1,
    timeout: 60000,
    reporter: "list",
    use: {
        baseURL: `http://localhost:${FIXTURE_SERVER_PORT}`,
    },
    projects: [
        {
            name: "firefox",
            use: {
                browserName: "firefox",
                viewport: { width: 1440, height: 900 },
                colorScheme: "dark",
                locale: "en-US",
            },
        },
    ],
    globalSetup: "./e2e/global-setup.ts",
    globalTeardown: "./e2e/global-teardown.ts",
});
