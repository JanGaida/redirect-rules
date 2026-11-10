import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    DASHBOARD_HASH,
    DASHBOARD_HOST_URL,
    dashboardUrl,
    isDashboardUrl,
    normalizeRequest,
    readDashboardTab,
} from "../dashboard-protocol";

/** Reads a file relative to this test (node env, like `brand-color.test.ts`). */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Dashboard protocol — hash marker, boot request shape
// ─────────────────────────────────────────────────────────────────────────────

describe("isDashboardUrl", () => {
    it("detects the marker fragment exactly", () => {
        expect(isDashboardUrl(`https://x.test/#${DASHBOARD_HASH}`)).toBe(true);
        expect(isDashboardUrl(`https://x.test/page?q=1#${DASHBOARD_HASH}`)).toBe(true);
    });

    it("rejects other hashes and hash-less urls", () => {
        expect(isDashboardUrl("https://x.test/")).toBe(false);
        expect(isDashboardUrl("https://x.test/#section")).toBe(false);
        expect(isDashboardUrl("https://x.test/#rr-dashboard-extra")).toBe(false);
    });
});

describe("dashboardUrl", () => {
    it("appends the marker to the default host (repo-owned stub)", () => {
        expect(dashboardUrl()).toBe(`${DASHBOARD_HOST_URL}#${DASHBOARD_HASH}`);
    });

    it("appends the marker to a given host (the e2e fixture path seam)", () => {
        expect(dashboardUrl("/rr-dashboard-host")).toBe(`/rr-dashboard-host#${DASHBOARD_HASH}`);
    });

    it("keeps the host a raw.githubusercontent text/plain document (swap-invariant contract)", () => {
        expect(DASHBOARD_HOST_URL).toMatch(/^https:\/\/raw\.githubusercontent\.com\/.+/);
    });
});

// MARK: Repo-owned host stub (ADR 0012 — frozen public contract)

describe("repo-owned host stub", () => {
    it("pins the exact published URL (owner, branch and file are frozen)", () => {
        expect(DASHBOARD_HOST_URL).toBe(
            "https://raw.githubusercontent.com/JanGaida/redirect-rules/refs/heads/main/dashboard-host.html",
        );
    });

    it("ships the pinned file at the repo root and keeps it inert", () => {
        const fileName = new URL(DASHBOARD_HOST_URL).pathname.split("/").pop();
        const stub = read(`../../../../${fileName}`);

        expect(stub).toMatch(/<!doctype html>/i);
        expect(stub).toMatch(/<meta charset="utf-8"/i);
        expect(stub).toMatch(/<title>Redirect Rules<\/title>/);
        expect(stub).not.toMatch(/<script|<style|<link|<iframe|<img|\ssrc=|\shref=|@import/i);
    });
});

describe("readDashboardTab", () => {
    it("reads every known tab segment", () => {
        for (const tab of ["rules", "assistant", "stats", "info", "system"]) {
            expect(readDashboardTab(`https://x.test/#${DASHBOARD_HASH}/${tab}`)).toBe(tab);
        }
    });

    it("reads the assistant deep link with a query-like suffix", () => {
        expect(readDashboardTab(`https://x.test/#${DASHBOARD_HASH}/assistant?x=1`)).toBe("assistant");
    });

    it("returns null for absent or unknown segments", () => {
        expect(readDashboardTab(`https://x.test/#${DASHBOARD_HASH}`)).toBeNull();
        expect(readDashboardTab(`https://x.test/#${DASHBOARD_HASH}/unknown`)).toBeNull();
        expect(readDashboardTab("https://x.test/")).toBeNull();
    });
});

describe("normalizeRequest", () => {
    it("passes a valid request through", () => {
        const request = { id: 1, url: "https://x.test/", createRule: true };
        expect(normalizeRequest(request)).toEqual(request);
    });

    it("coerces absent createRule flags to false", () => {
        expect(normalizeRequest({ id: 2, url: "https://x.test/" })).toEqual({
            id: 2,
            url: "https://x.test/",
            createRule: false,
        });
    });

    it("rejects corrupt shapes (null, never throws)", () => {
        expect(normalizeRequest(null)).toBeNull();
        expect(normalizeRequest("request")).toBeNull();
        expect(normalizeRequest({ url: "https://x.test/" })).toBeNull(); // * id missing
    });
});
