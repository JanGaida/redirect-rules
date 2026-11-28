// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { copyToClipboard } from "../clipboard";

const navRecord = navigator as unknown as Record<string, unknown>;
const docRecord = document as unknown as Record<string, unknown>;
let originalClipboard: PropertyDescriptor | undefined;
let originalExecCommand: PropertyDescriptor | undefined;

beforeEach(() => {
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    originalExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand");
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
    else delete navRecord.clipboard;
    if (originalExecCommand) Object.defineProperty(document, "execCommand", originalExecCommand);
    else delete docRecord.execCommand;
});

function stubClipboard(value: unknown): void {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}

function stubExecCommand(result: boolean): ReturnType<typeof vi.fn> {
    const execCommand = vi.fn(() => result);
    Object.defineProperty(document, "execCommand", { configurable: true, writable: true, value: execCommand });
    return execCommand;
}

describe("copyToClipboard", () => {
    it("prefers the synchronous GM_setClipboard grant", async () => {
        const gmCopy = vi.fn();
        vi.stubGlobal("GM_setClipboard", gmCopy);
        const writeText = vi.fn(async () => {});
        stubClipboard({ writeText });

        await copyToClipboard("hello");

        expect(gmCopy).toHaveBeenCalledWith("hello");
        expect(writeText).not.toHaveBeenCalled();
    });

    it("awaits the async navigator clipboard when no GM grant exists", async () => {
        const writeText = vi.fn(async () => {});
        stubClipboard({ writeText });

        await copyToClipboard("hello");

        expect(writeText).toHaveBeenCalledWith("hello");
    });

    it("selects the fallback node and runs execCommand as the last resort", async () => {
        delete navRecord.clipboard;
        const execCommand = stubExecCommand(true);
        const node = document.createElement("textarea");
        const select = vi.spyOn(node, "select");
        const setSelectionRange = vi.spyOn(node, "setSelectionRange");

        await copyToClipboard("hello", node);

        expect(select).toHaveBeenCalledTimes(1);
        expect(execCommand).toHaveBeenCalledWith("copy");
        expect(setSelectionRange).toHaveBeenCalledWith(0, 0);
    });

    it("rejects when execCommand reports failure", async () => {
        delete navRecord.clipboard;
        stubExecCommand(false);
        const node = document.createElement("textarea");

        await expect(copyToClipboard("hello", node)).rejects.toThrow("execCommand copy failed");
    });

    it("rejects when no clipboard API is available", async () => {
        delete navRecord.clipboard;

        await expect(copyToClipboard("hello")).rejects.toThrow("no clipboard API available");
    });
});
