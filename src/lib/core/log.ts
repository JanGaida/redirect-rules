// ─────────────────────────────────────────────────────────────────────────────
// MARK: Logger — scoped console output with level filtering
// ─────────────────────────────────────────────────────────────────────────────
// * Levels: debug=0 < info=1 < warn=2 < error=3 < silent=4. Filter via LOG_LEVEL.
// * ! Info stays sparse (user-observable outcomes); debug carries the full trail.
// * Performance: every method returns before payload/format work when filtered;
// *   prefixes/styles are built once per scope; payload factories run only when
// *   the level is enabled.
// * Payloads are plain JSON-safe objects — no RegExp, Error, DOM, or proxies.

/** Emitting log levels (methods on the logger). "silent" is settings-only. */
export type LogLevelLabel = "debug" | "info" | "warn" | "error";

/** Settings-facing log level: the emitting levels plus "silent" (everything off). */
export type SettingsLogLevel = LogLevelLabel | "silent";

/** Numeric severity per label (debug=0 < info=1 < warn=2 < error=3 < silent=4). */
export const LOG_LEVELS: Record<SettingsLogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4,
};

/** Ordered list of level labels, indexed by numeric severity (reverse lookup + GUI options). */
export const LOG_LEVEL_LABELS: SettingsLogLevel[] = ["debug", "info", "warn", "error", "silent"];

/** Logical scope tag for a log message — keeps the console format stable. */
export type LogScope =
    | "append-query"
    | "assistant"
    | "autosave"
    | "boot"
    | "dashboard"
    | "editor"
    | "engine"
    | "info"
    | "log"
    | "protocol"
    | "regex"
    | "rules"
    | "settings"
    | "stats"
    | "stats-view"
    | "storage"
    | "store"
    | "system"
    | "transfer"
    | "ui"
    | "watcher";

/**
 * Structured payload attached to a log message.
 *
 * * A factory defers payload construction until the level is enabled — use it
 *   for hot paths and expensive snapshots.
 * * Keep values JSON-safe (strings, numbers, booleans, arrays, plain objects).
 */
export type LogData = Record<string, unknown> | (() => Record<string, unknown>);

/** Scoped logger returned by {@link createLogger}. */
export interface Logger {
    debug(message: string, data?: LogData): void;
    info(message: string, data?: LogData): void;
    warn(message: string, data?: LogData): void;
    error(message: string, data?: LogData): void;
}

/**
 * Type guard for a settings log level (the five supported labels).
 *
 * Used by settings normalization (persisted `logLevel` field) — the silent shape
 * check, as opposed to {@link setLogLevel} which warns on unknown labels.
 *
 * @param label - The candidate label from stored settings.
 */
export function isSettingsLogLevel(label: unknown): label is SettingsLogLevel {
    return typeof label === "string" && Object.hasOwn(LOG_LEVELS, label);
}

/**
 * Derives the level to apply from settings — performance mode silences logging
 * without overwriting the stored `logLevel`.
 *
 * * Structural parameter (no `Settings` import): settings imports this module,
 *   so importing it back would create a cycle.
 *
 * @param settings - Objects carrying the stored level and the performance flag.
 */
export function effectiveLogLevel(settings: {
    logLevel: SettingsLogLevel;
    performanceMode: boolean;
}): SettingsLogLevel {
    return settings.performanceMode ? "silent" : settings.logLevel;
}

/** Current numeric log level. Messages below this severity are suppressed. Mutable at runtime. */
export let LOG_LEVEL: number = LOG_LEVELS.info;

/** Console-log prefix tag shown in every emitted message. */
export const LOG_TAG = "Redirect-Rules";

// ─── Fixed console format ─────────────────────────────────────────────────────

/** Tag style — blue, bold. */
const TAG_STYLE = "color:#00aaff;font-weight:700";
/** Scope style — gray, italic. */
const SCOPE_STYLE = "color:#aaa;font-style:italic";

/** Per-level color style (second `%c` segment). */
const LEVEL_STYLE: Record<LogLevelLabel, string> = {
    debug: "color:#888;font-weight:600",
    info: "color:#44dd66;font-weight:600",
    warn: "color:#ffaa00;font-weight:600",
    error: "color:#ff4444;font-weight:600",
};

/** Console method per level — resolved at call time so DevTools/test spies win. */
function consoleMethod(level: LogLevelLabel): (...data: unknown[]) => void {
    if (level === "debug") return console.debug;
    if (level === "info") return console.info;
    if (level === "warn") return console.warn;
    return console.error;
}

/**
 * Creates a scoped logger — the ONLY way runtime code emits logs.
 *
 * * Prefixes and styles are prepared once per scope; the returned methods do one
 *   numeric comparison before any formatting or payload work.
 *
 * @param scope - Stable logical module tag (see {@link LogScope}).
 */
export function createLogger(scope: LogScope): Logger {
    const prefix: Record<LogLevelLabel, string> = {
        debug: `%c[${LOG_TAG}]%c DEBUG %c${scope}`,
        info: `%c[${LOG_TAG}]%c INFO %c${scope}`,
        warn: `%c[${LOG_TAG}]%c WARN %c${scope}`,
        error: `%c[${LOG_TAG}]%c ERROR %c${scope}`,
    };

    const emit = (level: LogLevelLabel, message: string, data?: LogData): void => {
        if (LOG_LEVELS[level] < LOG_LEVEL) return;
        const payload = typeof data === "function" ? data() : data;
        const method = consoleMethod(level);
        if (payload === undefined) {
            method.call(console, prefix[level], TAG_STYLE, LEVEL_STYLE[level], SCOPE_STYLE, message);
        } else {
            method.call(console, prefix[level], TAG_STYLE, LEVEL_STYLE[level], SCOPE_STYLE, message, payload);
        }
    };

    return {
        debug: (message, data) => emit("debug", message, data),
        info: (message, data) => emit("info", message, data),
        warn: (message, data) => emit("warn", message, data),
        error: (message, data) => emit("error", message, data),
    };
}

/** Logger for the logger itself (unknown-level warnings). */
const log = createLogger("log");

/**
 * Sets the current log level from a label string.
 *
 * Unknown labels keep the current level and emit a warning (suppressed when
 * the current level is silent).
 *
 * @param label - One of "debug" | "info" | "warn" | "error" | "silent".
 */
export function setLogLevel(label: string): void {
    // * Own keys only: inherited names (constructor, toString, __proto__) are
    //   NOT levels — indexing LOG_LEVELS there would poison the numeric level.
    if (!Object.hasOwn(LOG_LEVELS, label)) {
        log.warn(`unknown level "${label}" — keeping ${LOG_LEVEL_LABELS[LOG_LEVEL]}`, { label });
        return;
    }
    LOG_LEVEL = LOG_LEVELS[label as SettingsLogLevel];
}

/**
 * Returns true when debug-level messages are currently emitted.
 *
 * * Hot-path guard: callers skip expensive debug-only work (status objects,
 *   string interpolation) when debug is off, instead of building values that
 *   the logger would discard.
 */
export function isDebugEnabled(): boolean {
    return LOG_LEVELS.debug >= LOG_LEVEL;
}
