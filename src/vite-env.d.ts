/// <reference types="svelte" />
/// <reference types="vite/client" />

/**
 * Compile-time build flag: true in `build:dev`, false in `build` (prod).
 *
 * Replaced by Vite `define` with a boolean literal, so code guarded by `if (__DEV__)`
 * (the dev-only TM-menu entries in src/main.ts) is dead-code-eliminated in prod builds.
 */
declare const __DEV__: boolean;

/**
 * Compile-time embedded CHANGELOG.md content (ADR 0014). Newline-normalized +
 * Base64-encoded by Vite `define`; `InfoTab.svelte` decodes via
 * `decodeText` from `src/lib/core/encoding.ts`. The release PR keeps header
 * version and changelog in the same merge, so they cannot drift.
 */
declare const __CHANGELOG_B64__: string[];

/**
 * Compile-time embedded i18n dictionaries (ADR 0014). JSON serialized and
 * Base64-encoded by Vite `define`; `src/lib/gui/i18n.svelte.ts` decodes via
 * `decodeText` and `JSON.parse`s the result at module load.
 */
declare const __I18N_B64__: string[];

/**
 * Compile-time embedded chat-template locale bodies (ADR 0014). Base64-encoded
 * Vite defines, decoded in `src/lib/core/chat-template.ts`.
 */
declare const __CHAT_TEMPLATE_DE_B64__: string[];
declare const __CHAT_TEMPLATE_EN_B64__: string[];
declare const __CHAT_ERROR_TEMPLATE_DE_B64__: string[];
declare const __CHAT_ERROR_TEMPLATE_EN_B64__: string[];

declare const __BUILD_SHA__: string;
declare const __BUILD_DATE__: string;

// * GM_* ambient declarations — vite-plugin-monkey/client types aren't
//   resolvable via triple-slash (package has no `./client` exports map).
//   Declare only the subset we use — must match the @grant list in vite.config.ts.
declare const GM_getValue: <T>(key: string, defaultValue: T) => T;
declare const GM_setValue: (key: string, value: unknown) => void;
declare const GM_deleteValue: (key: string) => void;
declare const GM_registerMenuCommand: (name: string, fn: () => void, accessKey?: string) => void;
// * ADR 0011: GM_openInTab bypasses popup blockers (TM menu callbacks have NO
//   transient user activation — window.open is blocked by real browsers).
declare const GM_openInTab: (
    url: string,
    options?: { active?: boolean; insertRelatedNextToCurrent?: boolean; setParent?: boolean; incognito?: boolean },
) => { close: () => void; closed: boolean; onclose?: () => void } | null;
// * Cross-tab dashboard signaling: remote settings writes (dashboard ↔ dashboard
//   sync) — same-tab writes must NOT fire the listener (remote flag).
declare const GM_addValueChangeListener: (
    key: string,
    listener: (name: string, oldValue: unknown, newValue: unknown, remote: boolean) => void,
) => number;
// * Chat-Template copy: synchronous fire-and-forget clipboard
// write — the takeover tab has GM access (its own context, ADR 0011).
declare const GM_setClipboard: (text: string) => void;
// * Settings export: GM_download is page-CSP-exempt — the dashboard host stub
//   sends `sandbox`, which silently blocks Blob anchor downloads.
declare const GM_download: (details: {
    url: string;
    name: string;
    saveAs?: boolean;
    onload?: () => void;
    onerror?: (error: unknown) => void;
}) => void;

// * GM_info is ALWAYS available (no @grant entry needed) — Tampermonkey fills
//   it from the userscript metadata header. Used by the About tab.
declare const GM_info: {
    script: {
        name: string;
        namespace: string;
        version: string;
        author?: string;
        description?: string;
    };
    scriptHandler: string;
    version: string;
};
