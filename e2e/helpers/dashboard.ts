import type { Page } from "@playwright/test";
import { invokeGmCommandWithGesture } from "./gm-polyfill";
import { blockFontRequests } from "./userscript";

const TAB_DEADLINE_MS = 20_000;
const PAGE_POLL_MS = 5_000;
const SELECTOR_POLL_MS = 5_000;

async function waitForNewPage(page: Page, before: Set<Page>, timeoutMs: number): Promise<Page | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const popup = page
            .context()
            .pages()
            .find((candidate) => !before.has(candidate));
        if (popup) return popup;
        await page.waitForTimeout(100);
    }
    return null;
}

/**
 * Invokes a dashboard-opening GM menu command and returns the new tab.
 *
 * * Firefox can return a WindowProxy without materializing a page; retry only
 *   while NO new page exists.
 * * Never re-invoke after a page materialized — the boot request is single-use.
 *
 * @param page  - The opener page.
 * @param label - The exact GM menu-command label.
 * @returns The dashboard tab.
 */
export async function openDashboardTab(page: Page, label = "Redirect Rules: Open Dashboard"): Promise<Page> {
    await blockFontRequests(page);
    const deadline = Date.now() + TAB_DEADLINE_MS;
    while (Date.now() < deadline) {
        const before = new Set(page.context().pages());
        const invoked = await invokeGmCommandWithGesture(page, label);
        if (!invoked) throw new Error(`GM menu command "${label}" is not registered`);

        const remaining = Math.max(0, deadline - Date.now());
        const popup = await waitForNewPage(page, before, Math.min(PAGE_POLL_MS, remaining));
        if (!popup) continue;

        // * Materialized tab: give it its own mount budget, never re-invoke.
        await popup.waitForSelector(".rr-dashboard", { timeout: SELECTOR_POLL_MS });
        return popup;
    }
    throw new Error(`dashboard tab "${label}" did not materialize within ${TAB_DEADLINE_MS} ms`);
}
