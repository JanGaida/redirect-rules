// ─────────────────────────────────────────────────────────────────────────────
// MARK: UI state — cross-component transient dashboard state (runes singleton)
// ─────────────────────────────────────────────────────────────────────────────
// * Modal/toast flags that far-apart components must share: the token/manual
//   reference popovers (rule editor + site gate) and the rail's locale popup
//   own theirs, App's ESC handler must close an open popover FIRST (before the
//   unsaved-changes confirm) and App also RENDERS the toast at the dashboard root.
// * Single-slot toasts (ADR 0039): a new message replaces the pending one,
//   including its Undo action — there is no toast stack.
// * Deliberately NOT in the settings store: none of this persists — it is
//   per-open-view chrome, reset naturally by a remount.

import { createLogger } from "../core/log";

const log = createLogger("ui");

/** Which popover is open (single-popover semantics).
 *
 * * `siteManual:<index>` is unique per site group: every folded group keeps its
 *   gate trigger in the DOM, so a shared `"siteManual"` slot would make all
 *   gates open (and auto-close each other) on one click.
 */
export type PopoverKey = "tokens" | "manual" | "locale" | `siteManual:${number}`;

/** Optional action button rendered inside the toast. */
export interface ToastAction {
    /** Visible button label (i18n'd by the caller). */
    label: string;
    /** Runs on click; the toast is cleared BEFORE this runs. */
    run: () => void;
}

/** Current toast payload (null = hidden). */
export interface ToastState {
    /** Announced message (role="status"). */
    message: string;
    /** Undo-style action (null for plain receipts). */
    action: ToastAction | null;
    /** Total visible duration — drives the countdown ring (ADR 0039). */
    durationMs: number;
}

/** Transient UI flags + the pending toast (null = hidden). */
export const uiState = $state({
    /** Open popover (null = none). ESC closes it before anything else. */
    popover: null as PopoverKey | null,
    /** Open modal dialog (null = none). ESC belongs to the native dialog. */
    modal: null as "transfer" | null,
    /** Current toast (null = hidden) — set via {@link showToast}. */
    toast: null as ToastState | null,
    /** Whether hover/focus currently holds the toast timer (ring pauses too). */
    toastPaused: false,
});

/** Plain receipt timing. */
export const TOAST_MS = 3200;

/** Undo window for destructive deletes (ADR 0039). */
export const UNDO_TOAST_MS = 8000;

/** Toast auto-hide timer (module scope — one toast at a time). */
let toastTimer: number | null = null;
/** Total duration of the pending toast — restart value for {@link resumeToast}. */
let toastDurationMs = TOAST_MS;
/** Remaining time when the timer was paused. */
let toastRemainingMs = TOAST_MS;
/** Timestamp of the last (re)arm — pause subtracts the elapsed slice. */
let toastStartedAt = 0;
/** Whether the timer is currently held by hover/focus. */
let toastPaused = false;

/** (Re-)arms the auto-hide timer with a full or remaining duration. */
function armToastTimer(durationMs: number, remainingMs = durationMs): void {
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastDurationMs = durationMs;
    toastRemainingMs = Math.max(0, remainingMs);
    toastStartedAt = Date.now();
    toastPaused = false;
    uiState.toastPaused = false;
    toastTimer = window.setTimeout(() => {
        toastTimer = null;
        uiState.toast = null;
    }, toastRemainingMs);
}

/**
 * Shows a toast — replaces a pending toast immediately (single slot).
 *
 * @param message - The message to show (i18n'd by the caller).
 * @param options - Duration override and/or an action button (ADR 0039).
 */
export function showToast(message: string, options: { durationMs?: number; action?: ToastAction } = {}): void {
    const durationMs = options.durationMs ?? TOAST_MS;
    log.debug("toast shown", { message, hasAction: options.action !== undefined, durationMs });
    uiState.toast = { message, action: options.action ?? null, durationMs };
    armToastTimer(durationMs);
}

/** Hides the toast and cancels its timer. */
export function dismissToast(): void {
    const hadToast = uiState.toast !== null;
    if (toastTimer !== null) {
        window.clearTimeout(toastTimer);
        toastTimer = null;
    }
    toastPaused = false;
    uiState.toastPaused = false;
    uiState.toast = null;
    if (hadToast) log.debug("toast dismissed");
}

/**
 * Runs the toast action: clears FIRST so the action may show its own toast
 * (e.g. the undo-failure message).
 */
export function runToastAction(): void {
    const action = uiState.toast?.action;
    if (action === null || action === undefined) return;
    log.debug("toast action run", { label: action.label });
    dismissToast();
    action.run();
}

/** Holds the auto-hide timer (and its countdown ring) while hovered/focused. */
export function pauseToast(): void {
    if (toastTimer === null || toastPaused) return;
    window.clearTimeout(toastTimer);
    toastTimer = null;
    toastRemainingMs = Math.max(0, toastRemainingMs - (Date.now() - toastStartedAt));
    toastPaused = true;
    uiState.toastPaused = true;
}

/** Resumes with the REMAINING duration — ring and timer stay in sync. */
export function resumeToast(): void {
    if (!toastPaused) return;
    armToastTimer(toastDurationMs, toastRemainingMs);
}
