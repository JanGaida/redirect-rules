/**
 * Shared token reference data — one source for the token popover.
 *
 * * `key` indexes the `tokref.*` i18n entries (no new keys).
 * * `code` is locale-free regex/substitution/params notation.
 */
export interface TokenRefEntry {
    /** Locale-free code shown in the chip. */
    code: string;
    /** Suffix of the `tokref.*` i18n key. */
    key: string;
}

/** `replace` substitution tokens. */
export const TOKREF_SUBST: TokenRefEntry[] = [
    { code: "$1 $2 …", key: "capture" },
    { code: "$&", key: "whole" },
    { code: "$$", key: "dollar" },
];

/** `appendQuery` params tokens. */
export const TOKREF_APPEND: TokenRefEntry[] = [
    { code: "k=v", key: "qPair" },
    { code: "&", key: "qSep" },
    { code: "k", key: "qSkip" },
    { code: "#frag", key: "qFrag" },
    { code: "%20", key: "qRaw" },
];
