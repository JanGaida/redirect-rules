// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    uiState,
    showToast,
    dismissToast,
    runToastAction,
    pauseToast,
    resumeToast,
    TOAST_MS,
    UNDO_TOAST_MS,
} from "../ui-state.svelte";

beforeEach(() => {
    vi.useFakeTimers();
    dismissToast();
});

afterEach(() => {
    dismissToast();
    vi.useRealTimers();
});

describe("toast state (ADR 0039)", () => {
    it("hides a plain receipt after TOAST_MS", () => {
        showToast("copied");
        expect(uiState.toast?.message).toBe("copied");
        vi.advanceTimersByTime(TOAST_MS - 1);
        expect(uiState.toast).not.toBeNull();
        vi.advanceTimersByTime(1);
        expect(uiState.toast).toBeNull();
    });

    it("keeps an undo toast for UNDO_TOAST_MS", () => {
        const run = vi.fn();
        showToast("deleted", { durationMs: UNDO_TOAST_MS, action: { label: "Undo", run } });
        expect(uiState.toast?.action?.label).toBe("Undo");
        vi.advanceTimersByTime(TOAST_MS);
        expect(uiState.toast).not.toBeNull();
        vi.advanceTimersByTime(UNDO_TOAST_MS - TOAST_MS);
        expect(uiState.toast).toBeNull();
        expect(run).not.toHaveBeenCalled();
    });

    it("replaces the pending toast and its action", () => {
        showToast("first", { durationMs: UNDO_TOAST_MS, action: { label: "Undo", run: vi.fn() } });
        showToast("second");
        expect(uiState.toast).toEqual({ message: "second", action: null, durationMs: TOAST_MS });
        vi.advanceTimersByTime(TOAST_MS);
        expect(uiState.toast).toBeNull();
    });

    it("runs the action once, clearing the toast first", () => {
        let toastAtRun: unknown = "not-run";
        const run = vi.fn(() => {
            toastAtRun = uiState.toast;
        });
        showToast("deleted", { durationMs: UNDO_TOAST_MS, action: { label: "Undo", run } });

        runToastAction();
        runToastAction();

        expect(run).toHaveBeenCalledTimes(1);
        expect(toastAtRun).toBeNull();
        expect(uiState.toast).toBeNull();
    });

    it("pauses on hover/focus and resumes with the remaining duration", () => {
        showToast("deleted", { durationMs: UNDO_TOAST_MS, action: { label: "Undo", run: vi.fn() } });
        vi.advanceTimersByTime(3000);
        pauseToast();
        expect(uiState.toastPaused).toBe(true);
        vi.advanceTimersByTime(UNDO_TOAST_MS * 2);
        expect(uiState.toast).not.toBeNull();

        resumeToast();
        expect(uiState.toastPaused).toBe(false);
        vi.advanceTimersByTime(UNDO_TOAST_MS - 3000 - 1);
        expect(uiState.toast).not.toBeNull();
        vi.advanceTimersByTime(1);
        expect(uiState.toast).toBeNull();
    });
});
