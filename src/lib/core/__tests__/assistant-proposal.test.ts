import { describe, expect, it } from "vitest";
import { extractJsonValue, parseAssistantProposal, resolveProposal } from "../assistant-proposal";
import type { SiteRule } from "../settings";

const SITE: SiteRule = {
    siteRegex: "/example\\.test/",
    rules: [{ kind: "replace", regex: "/a/", substitution: "b" }],
};

/** Parses and fails the test on a rejected answer. */
function parse(text: string) {
    const result = parseAssistantProposal(text, "");
    if (!result.ok) throw new Error(`parse failed: ${result.code}`);
    return result.parsed;
}

describe("extractJsonValue", () => {
    it("strips Markdown fences and prose around the object", () => {
        const text = 'Here you go:\n```json\n{"kind":"replace","regex":"/a/","substitution":"b"}\n```\nThanks.';
        expect(extractJsonValue(text)).toBe('{"kind":"replace","regex":"/a/","substitution":"b"}');
    });

    it("tracks braces inside strings", () => {
        const text = '{"substitution":"a } b","kind":"replace"}';
        expect(extractJsonValue(text)).toBe(text);
    });

    it("extracts a top-level array", () => {
        const text = '[{"kind":"replace","regex":"/a/","substitution":"b"},{"kind":"appendQuery","params":"k=v"}]';
        expect(extractJsonValue(text)).toBe(text);
    });

    it("skips a prose bracket that is not JSON", () => {
        const text = 'Use this [note] value: {"kind":"replace","regex":"/a/","substitution":"b"}';
        expect(extractJsonValue(text)).toBe('{"kind":"replace","regex":"/a/","substitution":"b"}');
    });

    it("returns null without a balanced value", () => {
        expect(extractJsonValue("no json here")).toBeNull();
        expect(extractJsonValue('{"kind":"replace"')).toBeNull();
    });
});

describe("parseAssistantProposal", () => {
    it("parses a single rule with its own gate", () => {
        const result = parseAssistantProposal(
            JSON.stringify({
                siteRegex: "/example.test/",
                kind: "replace",
                regex: "/x/",
                substitution: "y",
            }),
            "",
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.parsed.siteGroups[0]?.siteRegex).toBe("/example.test/");
    });

    it("parses a removeQuery rule", () => {
        const result = parseAssistantProposal(
            JSON.stringify({
                siteRegex: "/example.test/",
                kind: "removeQuery",
                keys: "utm_*&fbclid",
            }),
            "",
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.siteGroups[0]?.rules[0]?.rule).toEqual({
                kind: "removeQuery",
                regex: "",
                keys: "utm_*&fbclid",
            });
        }
    });

    it("parses a fenced single rule and injects the fallback gate", () => {
        const result = parseAssistantProposal(
            '```json\n{"kind":"replace","regex":"/x/","substitution":"y"}\n```',
            "example.test",
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.siteGroups[0]?.siteRegex).toBe("example.test");
            expect(result.parsed.siteGroups[0]?.rules).toHaveLength(1);
        }
    });

    it("parses a group with several rules", () => {
        const result = parseAssistantProposal(
            JSON.stringify({
                siteRegex: "/group.test/",
                rules: [
                    { kind: "replace", regex: "/a/", substitution: "b" },
                    { kind: "appendQuery", params: "k=v" },
                    { kind: "checkpoint", regex: "/c/", mode: "stop" },
                ],
            }),
            "",
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.parsed.siteGroups[0]?.rules).toHaveLength(3);
    });

    it("accepts a rules array of groups", () => {
        const result = parseAssistantProposal(
            JSON.stringify({
                rules: [
                    { siteRegex: "/a.test/", rules: [{ kind: "replace", regex: "/a/", substitution: "b" }] },
                    { siteRegex: "/b.test/", rules: [{ kind: "appendQuery", params: "k=v" }] },
                ],
            }),
            "",
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.parsed.siteGroups).toHaveLength(2);
    });

    it("keeps verification entries from a group answer", () => {
        const result = parseAssistantProposal(
            JSON.stringify({
                siteRegex: "/example\\.test/",
                rules: [{ kind: "replace", regex: "/a/", substitution: "b" }],
                previewEntries: [
                    {
                        url: "https://example.test/a",
                        testOutputUri: "https://example.test/b",
                        description: "replace",
                    },
                ],
            }),
            "",
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.siteGroups[0]?.meta?.previewEntries).toEqual([
                { url: "https://example.test/a", testOutputUri: "https://example.test/b", description: "replace" },
            ]);
        }
    });

    it("keeps verification entries from the short single-rule shape", () => {
        const result = parseAssistantProposal(
            JSON.stringify({
                siteRegex: "/example\\.test/",
                kind: "replace",
                regex: "/a/",
                substitution: "b",
                previewEntries: [{ url: "", testOutputUri: "", description: "no example" }],
            }),
            "",
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.siteGroups[0]?.meta?.previewEntries).toHaveLength(1);
        }
    });

    it("rejects malformed verification entries as structure", () => {
        const result = parseAssistantProposal(
            JSON.stringify({
                siteRegex: "/example\\.test/",
                rules: [{ kind: "replace", regex: "/a/", substitution: "b" }],
                previewEntries: [{ description: "missing url" }],
            }),
            "",
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("structure");
    });

    it("parses a top-level array of TWO rules under the fallback gate", () => {
        const result = parseAssistantProposal(
            JSON.stringify([
                { kind: "replace", regex: "/a/", substitution: "b" },
                { kind: "appendQuery", params: "k=v" },
            ]),
            "/page\\.test/",
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.parsed.siteGroups).toHaveLength(1);
            expect(result.parsed.siteGroups[0]?.siteRegex).toBe("/page\\.test/");
            expect(result.parsed.siteGroups[0]?.rules).toHaveLength(2);
        }
    });

    it("parses a top-level array of TWO groups", () => {
        const result = parseAssistantProposal(
            JSON.stringify([
                { siteRegex: "/a.test/", rules: [{ kind: "replace", regex: "/a/", substitution: "b" }] },
                { siteRegex: "/b.test/", rules: [{ kind: "appendQuery", params: "k=v" }] },
            ]),
            "",
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.parsed.siteGroups).toHaveLength(2);
    });

    it("ignores a prose bracket before a valid object", () => {
        const result = parseAssistantProposal(
            'Use this [note]: {"siteRegex":"/a.test/","rules":[{"kind":"appendQuery","params":"k=v"}]}',
            "",
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.parsed.siteGroups[0]?.rules).toHaveLength(1);
    });

    it("reports needsGate when neither the answer nor the page supplies one", () => {
        const result = parseAssistantProposal('{"kind":"replace","regex":"/x/","substitution":"y"}', "");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("needsGate");
    });

    it("reports parse for invalid JSON", () => {
        const result = parseAssistantProposal("{not json", "");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("parse");
    });

    it("reports structure for an invalid rule", () => {
        const result = parseAssistantProposal(
            JSON.stringify({ siteRegex: "/a.test/", rules: [{ kind: "replace", regex: "/a/" }] }),
            "",
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("structure");
    });
});

describe("resolveProposal", () => {
    it("matches a semantically equal gate and reuses the existing group", () => {
        const parsed = parse(
            JSON.stringify({
                siteRegex: "example.test",
                rules: [{ kind: "replace", regex: "/new/", substitution: "x" }],
            }),
        );
        const proposal = resolveProposal([SITE], parsed);
        expect(proposal.groups[0]?.matchIndex).toBe(0);
        expect(proposal.groups[0]?.isNew).toBe(false);
        expect(proposal.groups[0]?.siteRegex).toBe("/example\\.test/");
        // * The parse result itself stays untouched (derived purity).
        expect(parsed.siteGroups[0]?.siteRegex).toBe("example.test");
    });

    it("skips an existing rule and counts it as a duplicate", () => {
        const parsed = parse(
            JSON.stringify({
                siteRegex: "/example\\.test/",
                rules: [
                    { kind: "replace", regex: "/a/", substitution: "b" },
                    { kind: "replace", regex: "/new/", substitution: "x" },
                ],
            }),
        );
        const proposal = resolveProposal([SITE], parsed);
        expect(proposal.groups[0]?.rules).toEqual([{ kind: "replace", regex: "/new/", substitution: "x" }]);
        expect(proposal.groups[0]?.duplicates).toHaveLength(1);
        expect(proposal.noNewRules).toBe(false);
    });

    it("creates a new group when no gate matches", () => {
        const parsed = parse(
            JSON.stringify({
                siteRegex: "/other.test/",
                rules: [{ kind: "appendQuery", params: "k=v" }],
            }),
        );
        const proposal = resolveProposal([SITE], parsed);
        expect(proposal.groups[0]?.matchIndex).toBeNull();
        expect(proposal.groups[0]?.isNew).toBe(true);
        expect(proposal.groups[0]?.rules).toHaveLength(1);
    });

    it("reports noNewRules when every rule is already present", () => {
        const parsed = parse(
            JSON.stringify({
                siteRegex: "/example\\.test/",
                rules: [{ kind: "replace", regex: "/a/", substitution: "b" }],
            }),
        );
        const proposal = resolveProposal([SITE], parsed);
        expect(proposal.noNewRules).toBe(true);
        expect(proposal.groups[0]?.rules).toHaveLength(0);
    });

    it("deduplicates repeats inside the proposal itself", () => {
        const parsed = parse(
            JSON.stringify({
                siteRegex: "/new.test/",
                rules: [
                    { kind: "replace", regex: "/a/", substitution: "b" },
                    { kind: "replace", regex: "/a/", substitution: "b" },
                ],
            }),
        );
        const proposal = resolveProposal([], parsed);
        expect(proposal.groups[0]?.rules).toHaveLength(1);
        expect(proposal.groups[0]?.duplicates).toHaveLength(1);
    });

    it("keeps only verification entries that are new to the target", () => {
        const site: SiteRule = {
            ...SITE,
            previewEntries: [
                { url: "https://example.test/a", testOutputUri: "https://example.test/b", description: "replace" },
            ],
        };
        const parsed = parse(
            JSON.stringify({
                siteRegex: "/example\\.test/",
                rules: [{ kind: "replace", regex: "/new/", substitution: "x" }],
                previewEntries: [
                    { url: "https://example.test/a", testOutputUri: "https://example.test/b", description: "replace" },
                    { url: "https://example.test/c", testOutputUri: "https://example.test/d", description: "replace" },
                    { url: "https://example.test/c", testOutputUri: "https://example.test/d", description: "replace" },
                ],
            }),
        );
        const proposal = resolveProposal([site], parsed);
        expect(proposal.groups[0]?.previewEntries).toEqual([
            { url: "https://example.test/c", testOutputUri: "https://example.test/d", description: "replace" },
        ]);
    });
});
