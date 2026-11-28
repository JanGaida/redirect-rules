// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installGmStubs, uninstallGmStubs } from "../../core/__tests__/gm-stubs";
import { STORAGE_KEY_DASHBOARD_REQUEST } from "../../core/storage";
import { store } from "../../stores/settings.svelte";
import { DASHBOARD_HOST_URL } from "../dashboard-protocol";

// * Mounting is out of scope — the mock keeps Svelte components out of the
// * coverage denominator; only openDashboard is exercised here.
vi.mock("../App.svelte", () => ({ default: {} }));

type OpenDashboard = (options?: { url?: string; createRule?: boolean }) => void;
type StoredRequest = { id: number; url: string; createRule: boolean };

let openDashboard: OpenDashboard;
let gmStore: Map<string, unknown>;

const globals = globalThis as Record<string, unknown>;
const winRecord = window as unknown as Record<string, unknown>;

function storedRequest(): StoredRequest | undefined {
    return gmStore.get(STORAGE_KEY_DASHBOARD_REQUEST) as StoredRequest | undefined;
}

beforeAll(async () => {
    gmStore = installGmStubs();
    globals.GM_info = { scriptHandler: "test", script: { version: "test" } };
    // * Import after the GM stubs land — dashboard.ts pulls the store/autosave singletons.
    ({ openDashboard } = (await import("../dashboard")) as { openDashboard: OpenDashboard });
});

afterAll(() => {
    uninstallGmStubs();
    delete globals.GM_info;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    store.settings.dashboardHost = "fixed";
    delete winRecord.__RR_DASHBOARD_HOST__;
});

describe("openDashboard", () => {
    it("stores an incrementing boot request with the opener url and createRule flag", () => {
        vi.stubEnv("DEV", true);
        vi.stubGlobal(
            "GM_openInTab",
            vi.fn(() => ({})),
        );

        openDashboard({ url: "https://example.test/a" });
        const first = storedRequest();
        expect(first).toMatchObject({ url: "https://example.test/a", createRule: false });

        openDashboard({ url: "https://example.test/b", createRule: true });
        const second = storedRequest();
        expect(second).toMatchObject({ url: "https://example.test/b", createRule: true });
        expect(second?.id).toBe((first?.id ?? 0) + 1);
    });

    it("defaults the request url to the current page", () => {
        vi.stubEnv("DEV", true);
        vi.stubGlobal(
            "GM_openInTab",
            vi.fn(() => ({})),
        );

        openDashboard();

        expect(storedRequest()?.url).toBe(location.href);
    });

    it("opens the fixed host stub by default", () => {
        vi.stubEnv("DEV", false);
        const open = vi.fn(() => ({}));
        vi.stubGlobal("GM_openInTab", open);

        openDashboard();

        expect(open).toHaveBeenCalledWith(`${DASHBOARD_HOST_URL}#rr-dashboard`, { active: true });
    });

    it("honors the experimental about:blank host setting", () => {
        vi.stubEnv("DEV", false);
        const open = vi.fn(() => ({}));
        vi.stubGlobal("GM_openInTab", open);
        store.settings.dashboardHost = "aboutblank";
        openDashboard();

        expect(open).toHaveBeenCalledWith("about:blank#rr-dashboard", { active: true });
    });

    it("lets the e2e host override win in dev mode", () => {
        vi.stubEnv("DEV", true);
        const open = vi.fn(() => ({}));
        vi.stubGlobal("GM_openInTab", open);
        winRecord.__RR_DASHBOARD_HOST__ = "https://fixture.test/dashboard.html";

        openDashboard();

        expect(open).toHaveBeenCalledWith("https://fixture.test/dashboard.html#rr-dashboard", { active: true });
    });

    it("uses the Vite dev dashboard when no host override exists", () => {
        vi.stubEnv("DEV", true);
        const open = vi.fn(() => ({}));
        vi.stubGlobal("GM_openInTab", open);

        openDashboard();

        expect(open).toHaveBeenCalledWith("https://127.0.0.1:5173/dashboard.html#rr-dashboard", { active: true });
    });

    it("reports a blocked popup when GM_openInTab returns no handle", () => {
        vi.stubEnv("DEV", true);
        vi.stubGlobal(
            "GM_openInTab",
            vi.fn(() => null),
        );
        const alert = vi.fn();
        vi.stubGlobal("alert", alert);

        openDashboard();

        expect(alert).toHaveBeenCalledTimes(1);
    });

    it("falls back to window.open when the GM API is unavailable", () => {
        vi.stubEnv("DEV", true);
        delete globals.GM_openInTab;
        const open = vi.spyOn(window, "open").mockReturnValue(null);

        openDashboard({ url: "https://example.test/a" });

        expect(open).toHaveBeenCalledWith("https://127.0.0.1:5173/dashboard.html#rr-dashboard", "_blank", "noopener");
    });
});
