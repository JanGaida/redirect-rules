// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadJson, exportFilename } from "../download";

const urlRecord = URL as unknown as Record<string, unknown>;
let originalCreate: PropertyDescriptor | undefined;
let originalRevoke: PropertyDescriptor | undefined;

beforeEach(() => {
    originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalCreate) Object.defineProperty(URL, "createObjectURL", originalCreate);
    else delete urlRecord.createObjectURL;
    if (originalRevoke) Object.defineProperty(URL, "revokeObjectURL", originalRevoke);
    else delete urlRecord.revokeObjectURL;
    document.body.innerHTML = "";
});

function stubBlobApis() {
    const create = vi.fn((_blob: Blob) => "blob:mock-url");
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    return { create, revoke, click };
}

describe("exportFilename", () => {
    it("uses the backup prefix for a full export and zero-pads the stamp", () => {
        const date = new Date(2026, 0, 2, 3, 4);

        expect(exportFilename("full", date)).toBe("redirect-rules-backup-20260102-0304.json");
    });

    it("uses the export prefix for a partial transfer", () => {
        const date = new Date(2026, 11, 24, 23, 59);

        expect(exportFilename("partial", date)).toBe("redirect-rules-export-20261224-2359.json");
    });
});

describe("downloadJson", () => {
    it("prefers GM_download with a self-contained data URL", () => {
        const gmDownload = vi.fn();
        vi.stubGlobal("GM_download", gmDownload);

        downloadJson("export.json", { locale: "de", count: 2 });

        expect(gmDownload).toHaveBeenCalledTimes(1);
        const details = gmDownload.mock.calls[0][0] as { url: string; name: string; saveAs: boolean };
        expect(details.name).toBe("export.json");
        expect(details.saveAs).toBe(false);
        expect(details.url.startsWith("data:application/json;charset=utf-8,")).toBe(true);
        const payload = decodeURIComponent(details.url.slice(details.url.indexOf(",") + 1));
        expect(JSON.parse(payload)).toEqual({ locale: "de", count: 2 });
    });

    it("survives a GM_download error callback", () => {
        const gmDownload = vi.fn();
        vi.stubGlobal("GM_download", gmDownload);

        downloadJson("export.json", { a: 1 });

        const details = gmDownload.mock.calls[0][0] as { onerror: (error: unknown) => void };
        expect(() => details.onerror(new Error("disk full"))).not.toThrow();
    });

    it("falls back to a Blob anchor when GM_download throws", async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            "GM_download",
            vi.fn(() => {
                throw new Error("blocked");
            }),
        );
        const { create, revoke, click } = stubBlobApis();

        downloadJson("fallback.json", { a: 1 });

        expect(create).toHaveBeenCalledTimes(1);
        expect(click).toHaveBeenCalledTimes(1);
        expect(revoke).not.toHaveBeenCalled();
        const blob = create.mock.calls[0][0] as Blob;
        expect(JSON.parse(await blob.text())).toEqual({ a: 1 });

        vi.advanceTimersByTime(0);
        expect(revoke).toHaveBeenCalledWith("blob:mock-url");
    });

    it("uses the Blob anchor when no GM API exists", () => {
        const { create, click } = stubBlobApis();

        downloadJson("plain.json", []);

        expect(create).toHaveBeenCalledTimes(1);
        expect(click).toHaveBeenCalledTimes(1);
        expect(document.querySelector("a")).toBeNull();
    });
});
