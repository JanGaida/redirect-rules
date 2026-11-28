import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/**
 * Chromium E2E project (ADR 0048).
 *
 * * The base config stays Firefox-only; this config reuses its global setup,
 *   teardown, baseURL, and timeouts but swaps the browser project.
 */
export default defineConfig({
    ...base,
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
