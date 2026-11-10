import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createLogger,
    effectiveLogLevel,
    isDebugEnabled,
    isSettingsLogLevel,
    LOG_LEVEL,
    LOG_LEVELS,
    setLogLevel,
    type LogData,
} from "../log";

/** Console spies — the logger resolves console methods at call time. */
function spyConsole() {
    return {
        debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
        info: vi.spyOn(console, "info").mockImplementation(() => {}),
        warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
        error: vi.spyOn(console, "error").mockImplementation(() => {}),
        log: vi.spyOn(console, "log").mockImplementation(() => {}),
    };
}

describe("logger — level filtering", () => {
    let consoleSpies: ReturnType<typeof spyConsole>;

    beforeEach(() => {
        setLogLevel("info");
        consoleSpies = spyConsole();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        setLogLevel("info");
    });

    it("emits every level at debug", () => {
        setLogLevel("debug");
        const log = createLogger("engine");
        log.debug("debug message");
        log.info("info message");
        log.warn("warn message");
        log.error("error message");

        expect(consoleSpies.debug).toHaveBeenCalledTimes(1);
        expect(consoleSpies.info).toHaveBeenCalledTimes(1);
        expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
        expect(consoleSpies.error).toHaveBeenCalledTimes(1);
    });

    it("suppresses messages below the configured level", () => {
        setLogLevel("warn");
        const log = createLogger("engine");
        log.debug("debug message");
        log.info("info message");
        log.warn("warn message");
        log.error("error message");

        expect(consoleSpies.debug).not.toHaveBeenCalled();
        expect(consoleSpies.info).not.toHaveBeenCalled();
        expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
        expect(consoleSpies.error).toHaveBeenCalledTimes(1);
    });

    it("suppresses everything in silent mode and skips payload factories", () => {
        setLogLevel("silent");
        const log = createLogger("engine");
        const factory = vi.fn(() => ({ expensive: true }));

        log.debug("debug message", factory);
        log.info("info message", factory);
        log.warn("warn message", factory);
        log.error("error message", factory);

        expect(factory).not.toHaveBeenCalled();
        expect(consoleSpies.debug).not.toHaveBeenCalled();
        expect(consoleSpies.info).not.toHaveBeenCalled();
        expect(consoleSpies.warn).not.toHaveBeenCalled();
        expect(consoleSpies.error).not.toHaveBeenCalled();
        expect(consoleSpies.log).not.toHaveBeenCalled();
    });
});

describe("logger — format and payload", () => {
    let consoleSpies: ReturnType<typeof spyConsole>;

    beforeEach(() => {
        setLogLevel("debug");
        consoleSpies = spyConsole();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        setLogLevel("info");
    });

    it("keeps the compact prefix with tag, level, and scope", () => {
        const log = createLogger("watcher");
        log.info("redirecting");

        const args = consoleSpies.info.mock.calls[0];
        expect(args[0]).toContain("[Redirect-Rules]");
        expect(args[0]).toContain("INFO");
        expect(args[0]).toContain("watcher");
        expect(args[4]).toBe("redirecting");
    });

    it("passes a plain payload object through by identity", () => {
        const log = createLogger("engine");
        const payload: LogData = { siteRegex: "x.test", changed: true };
        log.info("rule applied", payload);

        const args = consoleSpies.info.mock.calls[0];
        expect(args[5]).toBe(payload);
    });

    it("resolves a payload factory once when the level is enabled", () => {
        const log = createLogger("engine");
        const factory = vi.fn(() => ({ runId: 7 }));
        log.debug("run started", factory);

        expect(factory).toHaveBeenCalledTimes(1);
        expect(consoleSpies.debug.mock.calls[0][5]).toEqual({ runId: 7 });
    });

    it("does not route warn/error through console.log", () => {
        const log = createLogger("storage");
        log.warn("warn message");
        log.error("error message");

        expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
        expect(consoleSpies.error).toHaveBeenCalledTimes(1);
        expect(consoleSpies.log).not.toHaveBeenCalled();
    });
});

describe("logger — level control", () => {
    let consoleSpies: ReturnType<typeof spyConsole>;

    beforeEach(() => {
        setLogLevel("info");
        consoleSpies = spyConsole();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        setLogLevel("info");
    });

    it("warns on an unknown label and keeps the previous level", () => {
        setLogLevel("not-a-level");
        expect(consoleSpies.warn).toHaveBeenCalledTimes(1);

        const log = createLogger("log");
        log.info("still emitting");
        expect(consoleSpies.info).toHaveBeenCalledTimes(1);
    });

    it("reports debug availability", () => {
        setLogLevel("debug");
        expect(isDebugEnabled()).toBe(true);
        setLogLevel("info");
        expect(isDebugEnabled()).toBe(false);
        setLogLevel("silent");
        expect(isDebugEnabled()).toBe(false);
    });

    it("derives silent from performance mode without changing the stored level", () => {
        expect(effectiveLogLevel({ logLevel: "debug", performanceMode: true })).toBe("silent");
        expect(effectiveLogLevel({ logLevel: "debug", performanceMode: false })).toBe("debug");
    });
});

describe("logger — prototype-key labels are not levels", () => {
    let consoleSpies: ReturnType<typeof spyConsole>;

    beforeEach(() => {
        setLogLevel("info");
        consoleSpies = spyConsole();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        setLogLevel("info");
    });

    it("isSettingsLogLevel accepts only own level keys", () => {
        for (const level of ["debug", "info", "warn", "error", "silent"]) {
            expect(isSettingsLogLevel(level)).toBe(true);
        }
        for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
            expect(isSettingsLogLevel(key)).toBe(false);
        }
        expect(isSettingsLogLevel(42)).toBe(false);
    });

    it("setLogLevel keeps the current level on inherited keys", () => {
        setLogLevel("warn");
        for (const key of ["constructor", "toString", "__proto__"]) {
            setLogLevel(key);
            expect(LOG_LEVEL).toBe(LOG_LEVELS.warn);
        }
        expect(consoleSpies.warn).toHaveBeenCalledTimes(3);
    });
});
