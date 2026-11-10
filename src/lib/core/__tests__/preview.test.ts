import { describe, expect, it } from "vitest";
import {
    diffSpans,
    expandSubstitution,
    plainSpans,
    previewChain,
    previewGroup,
    previewGroupCompiled,
    ruleLabel,
    SAMPLE_URL,
    splitUrlComponents,
    type PreviewSpan,
    type UrlSegment,
} from "../preview";
import { applyRules, compileRules } from "../redirect-engine";
import type { SiteRule } from "../settings";

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Preview — URI segmentation, substitution parity, engine-parity replays
// ─────────────────────────────────────────────────────────────────────────────

// ─── splitUrlComponents ─────────────────────────────────────────────────────────

describe("splitUrlComponents", () => {
    it("segments scheme, userinfo, host, port, path, query, fragment", () => {
        const segments = splitUrlComponents("https://user:pass@example.com:8080/path/page?a=1#frag");
        const expectSeg = (component: UrlSegment["component"], text: string): void => {
            expect(segments.find((s) => s.component === component)?.text).toBe(text);
        };
        expectSeg("scheme", "https://");
        expectSeg("userinfo", "user:pass@");
        expectSeg("host", "example.com");
        expectSeg("port", ":8080");
        expectSeg("path", "/path/page");
        expectSeg("query", "?a=1");
        expectSeg("fragment", "#frag");
    });

    it("handles IPv6 hosts — port after the closing bracket", () => {
        const segments = splitUrlComponents("http://[::1]:9000/x");
        expect(segments.find((s) => s.component === "host")?.text).toBe("[::1]");
        expect(segments.find((s) => s.component === "port")?.text).toBe(":9000");
    });

    it("classifies scheme-less urls as context (no host/path guessing)", () => {
        const segments = splitUrlComponents("www.test.com/path?x=1#f");
        expect(segments.find((s) => s.component === "context")?.text).toBe("www.test.com/path");
        expect(segments.find((s) => s.component === "query")?.text).toBe("?x=1");
        expect(segments.find((s) => s.component === "fragment")?.text).toBe("#f");
    });

    it("never drops text — segments concatenate to the input", () => {
        for (const url of [SAMPLE_URL, "ttp://typo.test/", "garbage", "?only-query", "#only-frag", ""]) {
            expect(segmentsText(url)).toBe(url);
        }
    });

    it("returns empty for the empty string", () => {
        expect(splitUrlComponents("")).toEqual([]);
    });
});

function segmentsText(url: string): string {
    return splitUrlComponents(url)
        .map((s) => s.text)
        .join("");
}

// ─── expandSubstitution — native parity corpus ────────────────────────────────

describe("expandSubstitution — parity with native String.replace", () => {
    // * (regex, subject, template) — my expansion of the first match must equal
    //   native replace on the same input.
    const corpus: Array<{ re: RegExp; subject: string; template: string }> = [
        { re: /(a)(b)/, subject: "xabx", template: "[$1][$2]" },
        { re: /(a)(b)/, subject: "xabx", template: "[$&]" },
        { re: /(a)(b)/, subject: "xabx", template: "[$`][$']" },
        { re: /(a)(b)/, subject: "xabx", template: "[$$]" },
        { re: /(a)(b)/, subject: "xabx", template: "[$0][$3][$9]" },
        { re: /(a)(b)/, subject: "xabx", template: "[$12]" }, // * two-digit > captures → capture 1 + literal "0"
        { re: /(a)(b)/, subject: "xabx", template: "[$<nope>]" }, // * no named groups → literal $<…>
        { re: /(?<first>a)(b)/, subject: "xabx", template: "[$<first>][$<missing>]" },
        { re: /(?<first>a)(b)/, subject: "xabx", template: "$<first$<first>" }, // * unclosed — literal $ + text
        { re: /a(b?)/, subject: "xa", template: "[$1]" }, // * undefined capture → ""
        { re: /x/, subject: "axb", template: "[$&][$`][$']" },
        { re: /(?<word>\w+)/, subject: "hi there", template: "[$<word>][$1]$$" },
        { re: /(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l)/, subject: "abcdefghijkl", template: "[$10][$11][$12]" },
        { re: /(a)(b)/, subject: "ab", template: "[$1$2$1$2]" },
    ];

    it.each(corpus)("expands %s on %j exactly like native replace", ({ re, subject, template }) => {
        const native = subject.replace(re, template);
        const m = re.exec(subject);
        expect(m).not.toBeNull();
        const manual = subject.replace(
            new RegExp(re.source, re.flags.replace("g", "")),
            expandSubstitution(template, m![0], m!.index, subject, m!.slice(1) as Array<string | undefined>, m!.groups),
        );
        expect(manual).toBe(native);
    });
});

// ─── ruleLabel ────────────────────────────────────────────────────────────────

describe("ruleLabel", () => {
    it("labels a replace rule with its regex and an appendQuery rule with its params", () => {
        expect(ruleLabel({ kind: "replace", regex: "/old/", substitution: "new" })).toBe("/old/");
        expect(ruleLabel({ kind: "appendQuery", regex: "", params: "a=1" })).toBe("a=1");
        expect(ruleLabel({ kind: "removeQuery", regex: "", keys: "utm_*" })).toBe("utm_*");
    });
});

// ─── previewGroup — the group's FULL chain (every authored rule) ─────────────

const diffTexts = (spans: PreviewSpan[], diff: "match" | "insertion"): string =>
    spans
        .filter((s) => s.diff === diff)
        .map((s) => s.text)
        .join("");

describe("previewGroup", () => {
    const singleReplace: SiteRule = {
        siteRegex: "/x\\.test/",
        rules: [{ kind: "replace", regex: "/\\/old\\//", substitution: "/new/" }],
    };

    it("colors the matched region red (before) and the substitution green (after)", () => {
        const result = previewGroup("https://x.test/old/page", singleReplace);
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0]).toMatchObject({
            ruleIndex: 0,
            status: "applied",
            reason: "applied",
            label: "/\\/old\\//",
            oldUrl: "https://x.test/old/page",
            newUrl: "https://x.test/new/page",
        });
        expect(diffTexts(result.steps[0].oldSpans, "match")).toBe("/old/");
        expect(diffTexts(result.steps[0].newSpans, "insertion")).toBe("/new/");
    });

    it("replays preceding rules first — the next step sees the intermediate url", () => {
        const chained: SiteRule = {
            siteRegex: "/x\\.test/",
            rules: [
                { kind: "replace", regex: "/a/", substitution: "b" },
                { kind: "replace", regex: "/b/", substitution: "c" },
            ],
        };
        const result = previewGroup("https://x.test/a/", chained);
        expect(result.steps[0]).toMatchObject({ status: "applied", oldUrl: "https://x.test/a/" });
        expect(result.steps[1]).toMatchObject({
            status: "applied",
            oldUrl: "https://x.test/b/", // rule 0 already applied
            newUrl: "https://x.test/c/",
        });
        // * Parity with the engine: the chain result equals applyRules.
        expect(previewChain("https://x.test/a/", [chained]).finalUrl).toBe(
            applyRules("https://x.test/a/", compileRules([chained])).url,
        );
    });

    it("supports whitespace authoring variants against %20 urls", () => {
        for (const authored of ["/my\\sfile/", "/my file/"]) {
            const site: SiteRule = {
                siteRegex: "/x\\.test/",
                rules: [{ kind: "replace", regex: authored, substitution: "my-file" }],
            };
            const result = previewGroup("https://x.test/my%20file", site);
            expect(result.steps[0].reason).toBe("applied");
            expect(result.steps[0].newUrl).toBe("https://x.test/my-file");
        }
    });

    it("keeps sticky replace rules deterministic and at engine parity", () => {
        const site: SiteRule = {
            siteRegex: "/x\\.test/",
            rules: [{ kind: "replace", regex: "/https/y", substitution: "wss" }],
        };
        const url = "https://x.test/page";
        expect(previewGroup(url, site).finalUrl).toBe("wss://x.test/page");
        expect(previewGroup(url, site).finalUrl).toBe(applyRules(url, compileRules([site])).url);
    });

    it("colors every match of a g-flagged rule (native replace parity incl. zero-length)", () => {
        const site: SiteRule = {
            siteRegex: "/x\\.test/",
            rules: [
                { kind: "replace", regex: "/x*/g", substitution: "-" }, // * zero-length matches
                { kind: "replace", regex: "/a/g", substitution: "[A]" },
            ],
        };
        const zero = previewGroup("https://x.test/abc", site);
        expect(zero.steps[0].newUrl).toBe("https://x.test/abc".replace(/x*/g, "-"));

        const doubled = previewGroup("https://x.test/banana", site);
        // * Chain replay: rule 0 (zero-length x*) runs FIRST — the next rule
        //   sees the mangled intermediate, engine parity.
        const expected = "https://x.test/banana".replace(/x*/g, "-").replace(/a/g, "[A]");
        expect(doubled.steps[1].newUrl).toBe(expected);
        expect(diffTexts(doubled.steps[1].oldSpans, "match")).toBe("aaa");
        expect(diffTexts(doubled.steps[1].newSpans, "insertion")).toBe("[A][A][A]");
    });

    it("renders EVERY authored rule — skipped steps included, engine truth without holes", () => {
        const site: SiteRule = {
            siteRegex: "/x\\.test/",
            rules: [
                { kind: "replace", regex: "/old/", substitution: "new" },
                { kind: "replace", regex: "/nothing/", substitution: "x" }, // no match
                { kind: "replace", regex: "/new/", substitution: "new" }, // unchanged output
                { kind: "appendQuery", regex: "/never/", params: "p=1" }, // gate miss
                { kind: "replace", regex: "/([unclosed/", substitution: "x" }, // dead at compile
            ],
        };
        const result = previewGroup("https://x.test/old/page", site);
        expect(result.steps).toHaveLength(5); // ALL rules, applied AND skipped
        expect(result.steps.map((s) => s.ruleIndex)).toEqual([0, 1, 2, 3, 4]);
        expect(result.steps[0]).toMatchObject({
            status: "applied",
            reason: "applied",
            newUrl: "https://x.test/new/page",
        });
        expect(result.steps[1]).toMatchObject({
            status: "skipped",
            reason: "no-match",
            oldUrl: "https://x.test/new/page",
        });
        expect(diffTexts(result.steps[1].oldSpans, "match")).toBe(""); // no diff on a skipped step
        expect(result.steps[2]).toMatchObject({ status: "skipped", reason: "unchanged" });
        expect(result.steps[3]).toMatchObject({ status: "skipped", reason: "gate-no-match" });
        expect(result.steps[4]).toMatchObject({ status: "skipped", reason: "invalid-regex" });
        // * Skipped steps never mutate the chain.
        for (const step of result.steps.slice(1)) {
            expect(step.oldUrl).toBe(step.newUrl);
            expect(step.newUrl).toBe("https://x.test/new/page");
        }
    });

    it("marks every step skipped with site-no-match when the group gate misses", () => {
        const result = previewGroup("https://other.test/old/page", singleReplace);
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0]).toMatchObject({ status: "skipped", reason: "site-no-match" });
        expect(result.changed).toBe(false);
        expect(result.finalUrl).toBe("https://other.test/old/page");
    });

    it("marks every step skipped with invalid-regex when the site gate is unusable", () => {
        const badGate: SiteRule = {
            siteRegex: "/([unclosed/",
            rules: [{ kind: "replace", regex: "/a/", substitution: "b" }],
        };
        const result = previewGroup("https://x.test/a", badGate);
        expect(result.steps[0]).toMatchObject({ status: "skipped", reason: "invalid-regex" });
        expect(result.changed).toBe(false);
    });

    it("exposes the shared executor's gate result", () => {
        expect(previewGroup("https://x.test/old/page", singleReplace).gateMatched).toBe(true);
        expect(previewGroup("https://other.test/old/page", singleReplace).gateMatched).toBe(false);
    });

    it("reports gateMatched false for an invalid or empty gate", () => {
        const badGate: SiteRule = {
            siteRegex: "/([unclosed/",
            rules: [{ kind: "replace", regex: "/a/", substitution: "b" }],
        };
        expect(previewGroup("https://x.test/a", badGate).gateMatched).toBe(false);
        // * compileRules drops empty-gate groups entirely, so the executor never runs one.
        expect(previewGroup("https://x.test/a", { siteRegex: "", rules: [] }).gateMatched).toBe(false);
    });

    it("returns empty steps for a group without rules", () => {
        const result = previewGroup("https://x.test/", { siteRegex: "/x\\.test/", rules: [] });
        expect(result.steps).toEqual([]);
        expect(result.changed).toBe(false);
    });

    it("labels skipped steps with the authored rule's label", () => {
        const site: SiteRule = {
            siteRegex: "/x\\.test/",
            rules: [{ kind: "appendQuery", regex: "/never/", params: "a=1" }],
        };
        expect(previewGroup("https://x.test/page", site).steps[0].label).toBe("a=1");
    });

    it("keeps engine parity for the final url (single-site applyRules)", () => {
        const multi: SiteRule = {
            siteRegex: "/x\\.test/",
            rules: [
                { kind: "replace", regex: "/aa/", substitution: "bb" },
                { kind: "replace", regex: "/bb/", substitution: "cc" },
                { kind: "appendQuery", params: "m=1" },
                { kind: "replace", regex: "/never/", substitution: "x" },
            ],
        };
        const url = "https://x.test/aa?x=1";
        expect(previewGroup(url, multi).finalUrl).toBe(applyRules(url, compileRules([multi])).url);
    });

    describe("appendQuery rules", () => {
        const appendSite: SiteRule = {
            siteRegex: "/x\\.test/",
            rules: [
                { kind: "appendQuery", params: "b=2" },
                { kind: "appendQuery", params: "a=9" },
                { kind: "appendQuery", regex: "/never/", params: "c=3" },
                { kind: "appendQuery", params: "novalue" },
            ],
        };

        it("colors the appended params region green", () => {
            const result = previewGroup("https://x.test/page", appendSite);
            expect(result.steps[0]).toMatchObject({
                status: "applied",
                reason: "applied",
                newUrl: "https://x.test/page?b=2",
            });
            expect(diffTexts(result.steps[0].newSpans, "insertion")).toBe("?b=2");
            expect(diffTexts(result.steps[0].oldSpans, "match")).toBe(""); // * pure append — nothing replaced away
        });

        it("colors the overwritten param red (before) and green (after) — after the prior step appended", () => {
            // * Chain replay: rule 0 ("b=2") already appended BEFORE rule 1
            //   runs — engine truth, not a raw-input illusion.
            const result = previewGroup("https://x.test/page?a=1", appendSite);
            expect(result.steps[1].newUrl).toBe("https://x.test/page?a=9&b=2");
            expect(diffTexts(result.steps[1].oldSpans, "match")).toBe("1");
            expect(diffTexts(result.steps[1].newSpans, "insertion")).toBe("9");
        });

        it("respects the appendQuery gate (gate-no-match)", () => {
            const result = previewGroup("https://x.test/page", appendSite);
            expect(result.steps[2]).toMatchObject({ status: "skipped", reason: "gate-no-match" });
        });

        it("stays unchanged when params parse to nothing", () => {
            const result = previewGroup("https://x.test/page", appendSite);
            expect(result.steps[3]).toMatchObject({ status: "skipped", reason: "unchanged" });
        });
    });

    describe("removeQuery rules", () => {
        const removeSite: SiteRule = {
            siteRegex: "/x\\.test/",
            rules: [
                { kind: "removeQuery", keys: "fbclid" },
                { kind: "removeQuery", regex: "/never/", keys: "a" },
            ],
        };

        it("labels and colors the removed region as a match", () => {
            const result = previewGroup("https://x.test/page?fbclid=x&a=1", removeSite);
            expect(result.steps[0]).toMatchObject({
                kind: "removeQuery",
                label: "fbclid",
                status: "applied",
                reason: "applied",
                newUrl: "https://x.test/page?a=1",
            });
            expect(diffTexts(result.steps[0].oldSpans, "match")).toBe("fbclid=x&");
        });

        it("respects the gate (gate-no-match) and stays unchanged when nothing matches", () => {
            const result = previewGroup("https://x.test/page?fbclid=x&a=1", removeSite);
            expect(result.steps[1]).toMatchObject({ status: "skipped", reason: "gate-no-match" });
            const again = previewGroup("https://x.test/page?a=1", removeSite);
            expect(again.steps[0]).toMatchObject({ status: "skipped", reason: "unchanged" });
        });
    });

    // ─── The prominent TOTAL (start vs. end) ────────────────────────────────────

    const SITES: SiteRule = {
        siteRegex: "/a\\.test/",
        rules: [
            { kind: "replace", regex: "/aa/", substitution: "bb" },
            { kind: "replace", regex: "/bb/", substitution: "cc" },
            { kind: "appendQuery", params: "m=1" },
        ],
    };
    const url = "https://a.test/aa?x=1";

    it("gives every applied step its own red/green diff spans (spans never drop text)", () => {
        const chain = previewGroup(url, SITES);
        // * Step 1: "aa" replaced away (red on old), "bb" inserted (green on new).
        expect(chain.steps[0].oldSpans.some((s) => s.diff === "match" && s.text === "aa")).toBe(true);
        expect(chain.steps[0].newSpans.some((s) => s.diff === "insertion" && s.text === "bb")).toBe(true);
        // * appendQuery step: PURE append — old side has nothing replaced away
        // (no red), the appended params region ("&m=1") is green on the new side.
        expect(chain.steps[2].oldSpans.every((s) => s.diff === null)).toBe(true);
        expect(chain.steps[2].newSpans.some((s) => s.diff === "insertion" && s.text.includes("m=1"))).toBe(true);
        for (const step of chain.steps) {
            expect(step.oldSpans.map((s) => s.text).join("")).toBe(step.oldUrl);
            expect(step.newSpans.map((s) => s.text).join("")).toBe(step.newUrl);
        }
    });

    it("produces the prominent TOTAL diff (start vs. end)", () => {
        const chain = previewGroup(url, SITES);
        expect(chain.changed).toBe(true);
        // * Prefix/suffix heuristic: the common prefix is the
        //   scheme+host, the common suffix is just "=1" (the final query extends)
        //   — the middle carries the colors.
        expect(diffTexts(chain.sourceSpans, "match")).toBe("aa?x");
        // * The END side shows the FULL final url with the inserted parts green.
        expect(chain.targetSpans.map((s) => s.text).join("")).toBe(chain.finalUrl);
        expect(diffTexts(chain.targetSpans, "insertion")).toBe("cc?x=1&m");
    });

    it("returns neutral spans and changed=false when nothing matches", () => {
        const chain = previewGroup("https://other.test/", SITES);
        expect(chain.changed).toBe(false);
        expect(chain.sourceSpans.every((s) => s.diff === null)).toBe(true);
        expect(chain.targetSpans.every((s) => s.diff === null)).toBe(true);
        expect(chain.finalUrl).toBe("https://other.test/");
    });
});

// ─── previewChain — parity with applyRules ─────────────────────────────────────

describe("previewChain — parity with applyRules", () => {
    const multi: SiteRule[] = [
        {
            siteRegex: "/example\\.(de|fr)/",
            rules: [{ kind: "replace", regex: "/example\\.(de|fr)/", substitution: "example.com" }],
        },
        {
            // * Gate matches BOTH example.de and example.com urls — gates evaluate
            //   against the ORIGINAL url, so this group must fire from the start.
            siteRegex: "/example/",
            rules: [
                { kind: "replace", regex: "/\\/old\\//", substitution: "/new/" },
                { kind: "appendQuery", params: "src=rr" },
            ],
        },
    ];

    it("final url + step order + old/new pairs equal the engine's applied records", () => {
        const chain = previewChain("https://example.de/old/page", multi);
        const engine = applyRules("https://example.de/old/page", compileRules(multi));

        expect(chain.changed).toBe(engine.changed);
        expect(chain.finalUrl).toBe(engine.url);
        expect(chain.steps).toHaveLength(engine.applied.length);
        chain.steps.forEach((step, i) => {
            expect(step.oldUrl).toBe(engine.applied[i].oldUrl);
            expect(step.newUrl).toBe(engine.applied[i].newUrl);
        });
    });

    it("carries the authored site/rule indexes for the step list", () => {
        const chain = previewChain("https://example.de/old/page", multi);
        expect(chain.steps[0]).toMatchObject({ siteIndex: 0, ruleIndex: 0 });
        expect(chain.steps[1]).toMatchObject({ siteIndex: 1, ruleIndex: 0 });
        expect(chain.steps[2]).toMatchObject({ siteIndex: 1, ruleIndex: 1 });
    });

    it("returns no steps and changed=false when nothing matches", () => {
        const chain = previewChain("https://other.test/", multi);
        expect(chain.steps).toEqual([]);
        expect(chain.changed).toBe(false);
        expect(chain.finalUrl).toBe("https://other.test/");
    });

    it("skips disabled groups exactly like applyRules", () => {
        const disabled: SiteRule[] = [{ ...multi[0], disabled: true }, multi[1]];
        const url = "https://example.de/old/page";
        const chain = previewChain(url, disabled);
        const engine = applyRules(url, compileRules(disabled));
        expect(chain.finalUrl).toBe(engine.url);
        expect(chain.steps).toHaveLength(engine.applied.length);
    });
});

describe("previewGroup — disabled group", () => {
    it("still simulates the chain for authoring (engine skips it)", () => {
        const site: SiteRule = {
            siteRegex: "/x\\.test/",
            disabled: true,
            rules: [{ kind: "replace", regex: "/a/", substitution: "b" }],
        };
        const preview = previewGroup("https://x.test/a/", site);
        expect(preview.changed).toBe(true);
        expect(preview.finalUrl).toBe("https://x.test/b/");
        expect(preview.steps[0].status).toBe("applied");
        // * The engine itself remains unaffected.
        expect(applyRules("https://x.test/a/", compileRules([site])).url).toBe("https://x.test/a/");
    });
});

describe("previewGroup — checkpoint rules", () => {
    it("marks a continuing checkpoint as checkpoint-continue", () => {
        const site: SiteRule = {
            siteRegex: "/x\\.test/",
            rules: [
                { kind: "checkpoint", regex: "/session=on/", mode: "continue" },
                { kind: "replace", regex: "/track/", substitution: "clean" },
            ],
        };
        const result = previewGroup("https://x.test/track?session=on", site);
        expect(result.steps[0].kind).toBe("checkpoint");
        expect(result.steps[0].reason).toBe("checkpoint-continue");
        expect(result.steps[1].reason).toBe("applied");
        expect(result.finalUrl).toBe("https://x.test/clean?session=on");
    });

    it("marks a stopping checkpoint and later steps as checkpoint-stopped", () => {
        const site: SiteRule = {
            siteRegex: "/x\\.test/",
            rules: [
                { kind: "replace", regex: "/page/", substitution: "done" },
                { kind: "checkpoint", regex: "/\\/done/", mode: "stop" },
                { kind: "appendQuery", params: "again=1" },
            ],
        };
        const result = previewGroup("https://x.test/page", site);
        expect(result.steps[1].reason).toBe("checkpoint-stopped");
        expect(result.steps[2].reason).toBe("checkpoint-stopped");
        expect(result.steps[2].newUrl).toBe(result.steps[2].oldUrl);
        expect(result.finalUrl).toBe("https://x.test/done");
    });

    it("uses checkpoint-stopped for a failed continue-mode checkpoint", () => {
        const site: SiteRule = {
            siteRegex: "/x\\.test/",
            rules: [
                { kind: "checkpoint", regex: "/session=on/", mode: "continue" },
                { kind: "replace", regex: "/track/", substitution: "clean" },
            ],
        };
        const result = previewGroup("https://x.test/track", site);
        expect(result.steps[0].reason).toBe("checkpoint-stopped");
        expect(result.steps[1].reason).toBe("checkpoint-stopped");
    });

    it("ruleLabel returns checkpoint regex", () => {
        expect(ruleLabel({ kind: "checkpoint", regex: "/x/", mode: "continue" })).toBe("/x/");
    });
});

describe("previewGroupCompiled", () => {
    it("matches previewGroup when the group is compiled once and reused", () => {
        const site: SiteRule = {
            siteRegex: "/x\\.test/",
            rules: [
                { kind: "replace", regex: "/old/", substitution: "new" },
                { kind: "appendQuery", regex: "/new/", params: "b=2" },
            ],
        };
        const url = "https://x.test/old/page";
        const group = compileRules([site])[0];

        expect(previewGroupCompiled(url, site, group)).toEqual(previewGroup(url, site));
        // * A second entry reuses the SAME compiled group — still independent.
        expect(previewGroupCompiled("https://x.test/other", site, group)).toEqual(
            previewGroup("https://x.test/other", site),
        );
    });

    it("handles an unusable gate exactly like previewGroup", () => {
        const site: SiteRule = {
            siteRegex: "/([unclosed/",
            rules: [{ kind: "replace", regex: "/a/", substitution: "b" }],
        };
        const url = "https://x.test/a";

        expect(previewGroupCompiled(url, site, compileRules([site])[0])).toEqual(previewGroup(url, site));
    });
});

// ─── Span helpers ───────────────────────────────────────────────────────────────

function diffText(spans: PreviewSpan[], diff: PreviewSpan["diff"]): string {
    return spans
        .filter((span) => span.diff === diff)
        .map((span) => span.text)
        .join("");
}

describe("plainSpans", () => {
    it("segments the url without a diff overlay", () => {
        const spans = plainSpans("https://example.de/a");
        expect(spans.every((span) => span.diff === null)).toBe(true);
        expect(spans.map((span) => span.text).join("")).toBe("https://example.de/a");
    });

    it("returns no spans for an empty string", () => {
        expect(plainSpans("")).toEqual([]);
    });
});

describe("diffSpans", () => {
    it("keeps identical urls plain on both sides", () => {
        const { sourceSpans, targetSpans } = diffSpans("https://example.de/a", "https://example.de/a");
        expect(sourceSpans.every((span) => span.diff === null)).toBe(true);
        expect(targetSpans.every((span) => span.diff === null)).toBe(true);
    });

    it("marks the changed middle red on the source side and green on the target side", () => {
        const { sourceSpans, targetSpans } = diffSpans("https://example.de/a", "https://example.de/b");
        expect(diffText(sourceSpans, "match")).toBe("a");
        expect(diffText(targetSpans, "insertion")).toBe("b");
    });

    it("keeps the common prefix and suffix unmarked", () => {
        const { sourceSpans, targetSpans } = diffSpans("https://x.test/old/page", "https://x.test/new/page");
        expect(diffText(sourceSpans, "match")).toBe("old");
        expect(diffText(targetSpans, "insertion")).toBe("new");
        expect(sourceSpans.map((span) => span.text).join("")).toBe("https://x.test/old/page");
        expect(targetSpans.map((span) => span.text).join("")).toBe("https://x.test/new/page");
    });

    it("handles an empty source against a set target", () => {
        const { sourceSpans, targetSpans } = diffSpans("", "https://example.de/b");
        expect(sourceSpans).toEqual([]);
        expect(diffText(targetSpans, "insertion")).toBe("https://example.de/b");
    });
});
