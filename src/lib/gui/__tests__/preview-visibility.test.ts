// @vitest-environment jsdom
import { installGmStubs, uninstallGmStubs } from "../../core/__tests__/gm-stubs";

// ! Import-order contract (same as autosave.test.ts): the settings store loads
//   at module init, so the GM stubs must exist before the dynamic imports.
installGmStubs({ settings: { locale: "en", rules: [] } });
const { store } = await import("../../stores/settings.svelte");
const { hideSkippedFor, hasLocalVisibilityOverride, toggleLocalVisibility, toggleGlobalHideSkipped } =
    await import("../preview-visibility.svelte");

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SiteRule } from "../../core/settings";

afterAll(() => {
    uninstallGmStubs();
});

beforeEach(() => {
    // * Fresh site object per test: overrides are keyed by IDENTITY, so a new
    //   object never inherits a previous test's exception.
    store.settings.hideSkipped = false;
});

/** A minimal group — only identity matters for the override map. */
function site(): SiteRule {
    return { siteRegex: "/a/", rules: [] };
}

describe("preview visibility precedence (ADR 0040)", () => {
    it("follows the global default without a local exception", () => {
        const group = site();
        expect(hideSkippedFor(group)).toBe(false);
        store.settings.hideSkipped = true;
        expect(hideSkippedFor(group)).toBe(true);
        expect(hasLocalVisibilityOverride(group)).toBe(false);
    });

    it("lets a local toggle override the global value", () => {
        const group = site();
        store.settings.hideSkipped = true;
        toggleLocalVisibility(group);
        expect(hideSkippedFor(group)).toBe(false);
        expect(hasLocalVisibilityOverride(group)).toBe(true);
        // * The global default itself is untouched.
        expect(store.settings.hideSkipped).toBe(true);
    });

    it("drops the exception when the local value equals the global default", () => {
        const group = site();
        store.settings.hideSkipped = false;
        toggleLocalVisibility(group);
        expect(hideSkippedFor(group)).toBe(true);
        expect(hasLocalVisibilityOverride(group)).toBe(true);
        toggleLocalVisibility(group);
        expect(hideSkippedFor(group)).toBe(false);
        expect(hasLocalVisibilityOverride(group)).toBe(false);
    });

    it("clears every local exception when the global switch flips", () => {
        const a = site();
        const b = site();
        toggleLocalVisibility(a);
        toggleLocalVisibility(b);
        expect(hasLocalVisibilityOverride(a)).toBe(true);
        expect(hasLocalVisibilityOverride(b)).toBe(true);

        toggleGlobalHideSkipped();
        expect(store.settings.hideSkipped).toBe(true);
        expect(hasLocalVisibilityOverride(a)).toBe(false);
        expect(hasLocalVisibilityOverride(b)).toBe(false);
        expect(hideSkippedFor(a)).toBe(true);
    });

    it("returns the global value for an absent site", () => {
        store.settings.hideSkipped = true;
        expect(hideSkippedFor(undefined)).toBe(true);
    });
});
