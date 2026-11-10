import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { buildGmPolyfillInitScript } from "./gm-polyfill";

/** Hack webfont CDN host — E2E must never reach the live web (playwright.config). */
const FONT_CDN_GLOB = "**cdn.jsdelivr.net/**";

/** Contexts that already registered the abort route. */
const fontBlockedContexts = new WeakSet<BrowserContext>();

/**
 * Aborts the webfont CDN for the whole browser context, before navigation.
 *
 * * Context scope (not page) — the dashboard popup is created by window.open,
 *   so page.route would miss it.
 * * Idempotent: repeated dashboard opens register the route only once.
 *
 * @param page - Any page belonging to the target context.
 */
export async function blockFontRequests(page: Page): Promise<void> {
    const context = page.context();
    if (fontBlockedContexts.has(context)) return;
    fontBlockedContexts.add(context);
    await context.route(FONT_CDN_GLOB, (route) => route.abort());
}

/**
 * Loads the built userscript file content from `dist/`.
 *
 * The userscript file is a single bundle preceded by a `// ==UserScript==`
 * metadata header (JS comments). The entire file is valid JS and runs as-is when
 * evaluated.
 *
 * ! Requires a prior build (`npm run build` / `npm run build:dev`). Throws if the
 *   file is missing — fail fast rather than silently injecting nothing.
 *
 * ! Dev and prod builds write DIFFERENT file names (redirect-rules.dev.user.js vs
 *   redirect-rules.user.js) — a dev run can never silently fall back to the prod
 *   build.
 *
 * @param dev - When true, loads the dev build (dev-only menu entries present);
 *   else the prod build.
 * @returns The raw userscript source string.
 */
export function loadUserscriptSource(dev = false): string {
    const flag = dev ? "dev" : "prod";
    const fileName = dev ? "redirect-rules.dev.user.js" : "redirect-rules.user.js";
    const distPath = resolve(process.cwd(), "dist", fileName);
    try {
        const content = readFileSync(distPath, "utf-8");
        if (!content.startsWith("// ==UserScript==")) {
            throw new Error(`unexpected userscript header (build=${flag})`);
        }
        return content;
    } catch (e) {
        throw new Error(
            `Failed to read built userscript at ${distPath}. Run "npm run build${dev ? ":dev" : ""}" first. Cause: ${(e as Error).message}`,
        );
    }
}

/**
 * Installs the GM polyfill + the built userscript — BOTH via `addInitScript`.
 *
 * * Difference to the youtube-ui-tweaks setup (which injects the userscript
 *   AFTER load): this boot never touches `documentElement`/`document.head`
 *   eagerly — settings load is plain GM storage access — so document-start
 *   injection is safe and the redirect-on-load case runs as a REAL navigation.
 *
 * ! The polyfill MUST be registered FIRST (addInitScript order = execution
 *   order); the userscript resolves GM_* globals at run time.
 *
 * ! `addInitScript` persists across navigations — the loop-guard spec's
 *   multi-hop redirect chain re-runs the userscript on every page load, exactly
 *   like Tampermonkey does.
 *
 * ! CONTEXT-scoped injection (not page.addInitScript): the dashboard takeover
 *   tab is created by window.open from the menu callback (ADR 0011) — init
 *   scripts must run there TOO, or the popup boots as a plain page without the
 *   polyfill. page.addInitScript does NOT propagate to popups.
 *
 * @param page - The Playwright page (do NOT navigate before calling this).
 * @param seed - Initial GM values for the polyfill (pre-seeded rules).
 * @param dev  - When true, inject the dev build; else the prod build.
 */
export async function injectUserscript(page: Page, seed: Record<string, unknown> = {}, dev = false): Promise<void> {
    await blockFontRequests(page);
    await page.context().addInitScript(buildGmPolyfillInitScript(seed));
    await page.context().addInitScript(loadUserscriptSource(dev));
}

/**
 * The pre-seeded settings every redirect-behavior spec shares.
 *
 * * All gates pin on `localhost` (the fixture server host) — the rules are
 *   inert on any other origin.
 */
export const SEEDED_SETTINGS = {
    locale: "en",
    rules: [
        {
            siteRegex: "/localhost/",
            rules: [
                // * replace-rule spec: /redirect-me.html → /redirected.html
                { kind: "replace", regex: "/redirect-me\\.html/", substitution: "redirected.html" },
                // * append-query spec: gate keeps it from touching OTHER pages
                { kind: "appendQuery", regex: "/append-page/", params: "base=1&extra=2" },
                // * loop pair — cancels within ONE engine pass; the loop-guard spec
                // * seeds separate site groups so A→B→A survives as real navigations
                { kind: "replace", regex: "/loop-a\\.html/", substitution: "loop-b.html" },
                { kind: "replace", regex: "/loop-b\\.html/", substitution: "loop-a.html" },
                // * SPA spec: the pushState target is rewritten
                { kind: "replace", regex: "/spa-target\\.html/", substitution: "spa-destination.html" },
            ],
        },
    ],
};

/**
 * Convenience: installs polyfill + userscript, then navigates.
 *
 * @param page - The Playwright page.
 * @param url  - Fixture URL path (relative to the fixture-server baseURL).
 * @param dev  - When true, inject the dev build; else the prod build.
 */
export async function openFixtureWithUserscript(page: Page, url: string, dev = false): Promise<void> {
    await injectUserscript(page, { settings: SEEDED_SETTINGS }, dev);
    // * location.replace during load aborts the original navigation — goto's
    //   "net::ERR_ABORTED" is EXPECTED for redirect specs; swallow only that.
    await page.goto(url).catch(() => undefined);
}
