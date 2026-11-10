import { describe, expect, it, vi } from "vitest";
import { applyRules, compileRules, executeCompiledGroup } from "../redirect-engine";
import { setLogLevel } from "../log";
import type { SiteRule } from "../settings";

/** Compiles + applies in one step (test convenience). */
function run(url: string, siteRules: SiteRule[]): string {
    const result = applyRules(url, compileRules(siteRules));
    return result.url;
}

describe("compileRules — fail-soft", () => {
    it("drops site rules with an invalid gate regex but keeps the rest", () => {
        const compiled = compileRules([
            { siteRegex: "/([unclosed/", rules: [{ kind: "replace", regex: "/a/", substitution: "b" }] },
            { siteRegex: "/ok\\.test/", rules: [{ kind: "replace", regex: "/a/", substitution: "b" }] },
        ]);
        expect(compiled).toHaveLength(1);
        expect(compiled[0].source.siteRegex).toBe("/ok\\.test/");
    });

    it("drops rules with an invalid regex but keeps the site rule", () => {
        const compiled = compileRules([
            {
                siteRegex: "/ok\\.test/",
                rules: [
                    { kind: "replace", regex: "/([unclosed/", substitution: "b" },
                    { kind: "replace", regex: "/a/", substitution: "b" },
                ],
            },
        ]);
        expect(compiled[0].rules).toHaveLength(1);
    });

    it("drops appendQuery rules with an invalid gate regex", () => {
        const compiled = compileRules([
            {
                siteRegex: "/ok\\.test/",
                rules: [
                    { kind: "appendQuery", regex: "/([unclosed/", params: "a=1" },
                    { kind: "appendQuery", params: "b=2" },
                ],
            },
        ]);
        expect(compiled[0].rules).toHaveLength(1);
        expect(compiled[0].rules[0].kind).toBe("appendQuery");
    });

    it("strips the g flag from gate regexes (stateless .test)", () => {
        const compiled = compileRules([{ siteRegex: "/x\\.test/g", rules: [] }]);
        expect(compiled[0].gateRe.global).toBe(false);
    });

    it("strips the sticky flag from replace rules but keeps g", () => {
        const compiled = compileRules([
            {
                siteRegex: "/x\\.test/gy",
                rules: [{ kind: "replace", regex: "/a/gy", substitution: "b" }],
            },
        ]);
        expect(compiled[0].gateRe.sticky).toBe(false);
        expect(compiled[0].gateRe.global).toBe(false);
        const replace = compiled[0].rules[0] as { replaceRe: RegExp };
        expect(replace.replaceRe.sticky).toBe(false);
        expect(replace.replaceRe.global).toBe(true);
    });

    it("drops site rules with an empty gate instead of compiling match-all", () => {
        const compiled = compileRules([
            { siteRegex: "", rules: [{ kind: "replace", regex: "/a/", substitution: "b" }] },
            { siteRegex: "/ok\\.test/", rules: [] },
        ]);
        expect(compiled).toHaveLength(1);
        expect(compiled[0].source.siteRegex).toBe("/ok\\.test/");
    });

    it("drops replace rules with an empty regex", () => {
        const compiled = compileRules([
            {
                siteRegex: "/ok\\.test/",
                rules: [
                    { kind: "replace", regex: "", substitution: "PREFIX-" },
                    { kind: "replace", regex: "/a/", substitution: "b" },
                ],
            },
        ]);
        expect(compiled[0].rules).toHaveLength(1);
        expect(compiled[0].rules[0].kind).toBe("replace");
    });
});

describe("group enable/disable (ADR 0038)", () => {
    const offGroup: SiteRule = {
        siteRegex: "/x\\.test/",
        disabled: true,
        rules: [{ kind: "replace", regex: "/a/", substitution: "b" }],
    };

    it("skips disabled groups at compile by default", () => {
        expect(compileRules([offGroup])).toHaveLength(0);
    });

    it("compiles disabled groups only on explicit request (preview)", () => {
        const compiled = compileRules([offGroup], { includeDisabled: true });
        expect(compiled).toHaveLength(1);
        expect(compiled[0].source.disabled).toBe(true);
    });

    it("never applies a disabled group", () => {
        expect(run("https://x.test/a/", [offGroup])).toBe("https://x.test/a/");
    });

    it("keeps enabled groups working", () => {
        const enabled: SiteRule = { siteRegex: "/x\\.test/", rules: offGroup.rules };
        expect(run("https://x.test/a/", [enabled])).toBe("https://x.test/b/");
    });
});

describe("executeCompiledGroup — shared sequence truth", () => {
    it("keeps authored rule indexes when compile skips a dead rule", () => {
        const compiled = compileRules([
            {
                siteRegex: "/x\\.test/",
                rules: [
                    { kind: "replace", regex: "/([unclosed/", substitution: "b" }, // * index 0 — dead
                    { kind: "replace", regex: "/a/", substitution: "b" }, // * index 1
                    { kind: "appendQuery", params: "c=3" }, // * index 2
                ],
            },
        ]);
        expect(compiled[0].rules.map((rule) => rule.ruleIndex)).toEqual([1, 2]);
    });

    it("tests the site gate against gateUrl while rules start at inputUrl", () => {
        const group = compileRules([
            {
                siteRegex: "/start\\.test/",
                rules: [{ kind: "replace", regex: "/old/", substitution: "new" }],
            },
        ])[0];
        const execution = executeCompiledGroup(group, "https://other.test/old", "https://start.test/");
        expect(execution.gateMatched).toBe(true);
        expect(execution.finalUrl).toBe("https://other.test/new");
        expect(execution.steps[0]).toMatchObject({ ruleIndex: 0, reason: "applied", changed: true });
    });

    it("reports the reason vocabulary for no-match, gate-no-match, and abort", () => {
        const group = compileRules([
            {
                siteRegex: "/x\\.test/",
                rules: [
                    { kind: "replace", regex: "/absent/", substitution: "x" }, // * no-match
                    { kind: "appendQuery", regex: "/q=1/", params: "a=1" }, // * gate-no-match
                    { kind: "checkpoint", regex: "/stop/", mode: "stop" }, // * stops here
                    { kind: "replace", regex: "/page/", substitution: "after" }, // * never reached
                ],
            },
        ])[0];
        const execution = executeCompiledGroup(group, "https://x.test/page?stop");

        expect(execution.aborted).toBe(true);
        expect(execution.steps.map((step) => step.reason)).toEqual(["no-match", "gate-no-match", "checkpoint-stopped"]);
        expect(execution.steps.map((step) => step.ruleIndex)).toEqual([0, 1, 2]);
        expect(execution.finalUrl).toBe("https://x.test/page?stop");
    });
});

describe("applyRules — replace rules", () => {
    it("applies standard String.replace semantics with capture groups", () => {
        const out = run("http://example.de/home", [
            {
                siteRegex: "/example\\.(de|fr)/",
                rules: [
                    {
                        kind: "replace",
                        regex: "/example\\.(de|fr)(\\/.*|\\?.*)?/",
                        substitution: "example.com?prev=$1",
                    },
                ],
            },
        ]);
        expect(out).toBe("http://example.com?prev=de");
    });

    it("replaces every occurrence with the g flag", () => {
        const out = run("http://a.test/x-a-y-a-z", [
            { siteRegex: "/a\\.test/", rules: [{ kind: "replace", regex: "/a/g", substitution: "b" }] },
        ]);
        expect(out).toBe("http://b.test/x-b-y-b-z");
    });

    it("keeps sticky replace rules deterministic across consecutive runs", () => {
        const compiled = compileRules([
            {
                siteRegex: "/a\\.test/",
                rules: [{ kind: "replace", regex: "/https/y", substitution: "wss" }],
            },
        ]);
        const url = "https://a.test/page";
        const first = applyRules(url, compiled);
        const second = applyRules(url, compiled);
        expect(first.url).toBe("wss://a.test/page");
        expect(second.url).toBe(first.url);
        expect(second.changed).toBe(first.changed);
    });

    it("replaces only the first occurrence without the g flag", () => {
        const out = run("http://a.test/x-a-y-a-z", [
            { siteRegex: "/a\\.test/", rules: [{ kind: "replace", regex: "/a/", substitution: "b" }] },
        ]);
        expect(out).toBe("http://b.test/x-a-y-a-z");
    });

    it("leaves the url untouched when no site gate matches", () => {
        const out = run("http://other.test/page", [
            { siteRegex: "/example\\.de/", rules: [{ kind: "replace", regex: "/other/", substitution: "x" }] },
        ]);
        expect(out).toBe("http://other.test/page");
    });

    it("leaves the url untouched when a gate matches but the rule does not", () => {
        const out = run("http://example.com/other", [
            { siteRegex: "/example\\.com/", rules: [{ kind: "replace", regex: "/\\/page/", substitution: "x" }] },
        ]);
        expect(out).toBe("http://example.com/other");
    });
});

describe("applyRules — appendQuery rules", () => {
    it("appends params when the optional gate matches", () => {
        const out = run("https://x.test/page", [
            {
                siteRegex: "/x\\.test/",
                rules: [{ kind: "appendQuery", regex: "/\\/page/", params: "base=1" }],
            },
        ]);
        expect(out).toBe("https://x.test/page?base=1");
    });

    it("skips the rule when the optional gate does not match", () => {
        const out = run("https://x.test/other", [
            {
                siteRegex: "/x\\.test/",
                rules: [{ kind: "appendQuery", regex: "/\\/page/", params: "base=1" }],
            },
        ]);
        expect(out).toBe("https://x.test/other");
    });

    it("appends without a gate whenever the site matches", () => {
        const out = run("https://x.test/anything", [
            { siteRegex: "/x\\.test/", rules: [{ kind: "appendQuery", params: "a=1" }] },
        ]);
        expect(out).toBe("https://x.test/anything?a=1");
    });
});

describe("applyRules — appendQuery gates match the query-DECODED surface", () => {
    // * The fuq.com loop: pages deliver keys percent-encoded, gates are
    //   authored raw — a raw-exact gate test appended duplicates until the page
    //   bounced back (A→B→A). Gates now see the decoded query; edits stay raw.
    /** Negativ-lookahead gate "param missing" in authored /…/ notation (canonical `^…` placement). */
    const absentGate = (key: string): string => `/^(?!.*filter\\[${key}\\]=).*$/`;

    it("blocks the append when the param exists percent-encoded (fuq scenario)", () => {
        const url = "https://www.fuq.com/category/taboo-fantasy?filter%5Bquality%5D=hd&filter%5Bduration%5D=1200";
        const out = run(url, [
            {
                siteRegex: "/www\\.fuq\\.com\\/\\w+/",
                rules: [{ kind: "appendQuery", regex: absentGate("quality"), params: "filter[quality]=hd" }],
            },
        ]);
        expect(out).toBe(url);
    });

    it("blocks the append when the param exists in EITHER form (raw or encoded)", () => {
        const site: SiteRule = {
            siteRegex: "/fuq\\.com/",
            rules: [{ kind: "appendQuery", regex: absentGate("quality"), params: "filter[quality]=hd" }],
        };
        expect(run("https://fuq.com/c?filter%5Bquality%5D=hd", [site])).toBe(
            "https://fuq.com/c?filter%5Bquality%5D=hd",
        );
        expect(run("https://fuq.com/c?filter[quality]=hd", [site])).toBe("https://fuq.com/c?filter[quality]=hd");
    });

    it("appends when the encoded form is genuinely absent", () => {
        const out = run("https://fuq.com/c?filter%5Bduration%5D=1200", [
            {
                siteRegex: "/fuq\\.com/",
                rules: [{ kind: "appendQuery", regex: absentGate("quality"), params: "filter[quality]=hd" }],
            },
        ]);
        expect(out).toBe("https://fuq.com/c?filter%5Bduration%5D=1200&filter[quality]=hd");
    });

    it("decodes whole escapes for gates beyond the parseRegex whitespace rewrite", () => {
        // * `parseRegex` normalizes whitespace variants — this pin needs another
        //   escape class: `%3D` → `=` is ONLY visible on the decoded surface.
        const out = run("https://x.test/p?v=a%3Db", [
            { siteRegex: "/x\\.test/", rules: [{ kind: "appendQuery", regex: "/\\?v=a=b$/", params: "hit=1" }] },
        ]);
        expect(out).toBe("https://x.test/p?v=a%3Db&hit=1");
    });

    it("decodes + as a space for gates (query surface)", () => {
        const out = run("https://x.test/p?q=a+b", [
            { siteRegex: "/x\\.test/", rules: [{ kind: "appendQuery", regex: "/q=a b/", params: "hit=1" }] },
        ]);
        expect(out).toBe("https://x.test/p?q=a+b&hit=1");
    });

    it("keeps the site gate raw (site gates are NOT decoded)", () => {
        const out = run("https://x.test/c?q=%5B", [
            { siteRegex: "/q=%5B/", rules: [{ kind: "appendQuery", params: "a=1" }] },
        ]);
        expect(out).toBe("https://x.test/c?q=%5B&a=1");
    });
});

describe("applyRules — sequencing", () => {
    it("applies rules of a site sequentially, each on the previous result", () => {
        const out = run("https://x.test/page", [
            {
                siteRegex: "/x\\.test/",
                rules: [
                    { kind: "appendQuery", params: "base=1" },
                    { kind: "appendQuery", params: "extra=2" },
                ],
            },
        ]);
        expect(out).toBe("https://x.test/page?base=1&extra=2");
    });

    it("applies ALL matching site rules in order", () => {
        const out = run("https://x.test/page", [
            { siteRegex: "/x\\.test/", rules: [{ kind: "appendQuery", params: "first=1" }] },
            { siteRegex: "/test/", rules: [{ kind: "appendQuery", params: "second=2" }] },
        ]);
        expect(out).toBe("https://x.test/page?first=1&second=2");
    });

    it("applies only site rules that matched the ORIGINAL url (legacy single pass)", () => {
        // * The gates are evaluated once against the input url — a rewrite into
        //   another group's scope does NOT trigger that group in the same run
        //   (it applies on the next page load, after the redirect).
        const out = run("https://a.test/page", [
            { siteRegex: "/a\\.test/", rules: [{ kind: "replace", regex: "/a\\.test/", substitution: "b.test" }] },
            { siteRegex: "/b\\.test/", rules: [{ kind: "appendQuery", params: "after=1" }] },
        ]);
        expect(out).toBe("https://b.test/page");
    });
});

describe("applyRules — result bookkeeping", () => {
    it("reports changed=false and no applied records when nothing matches", () => {
        const result = applyRules("http://x.test/", compileRules([]));
        expect(result.changed).toBe(false);
        expect(result.applied).toHaveLength(0);
        expect(result.url).toBe("http://x.test/");
    });

    it("records every applied rule in order", () => {
        const result = applyRules(
            "https://x.test/page",
            compileRules([
                {
                    siteRegex: "/x\\.test/",
                    rules: [
                        { kind: "replace", regex: "/page/", substitution: "site" },
                        { kind: "appendQuery", params: "a=1" },
                    ],
                },
            ]),
        );
        expect(result.changed).toBe(true);
        expect(result.applied).toHaveLength(2);
        expect(result.applied[0]).toMatchObject({ oldUrl: "https://x.test/page", newUrl: "https://x.test/site" });
        expect(result.applied[1]).toMatchObject({ oldUrl: "https://x.test/site", newUrl: "https://x.test/site?a=1" });
    });
});

describe("compileRules — checkpoint rules", () => {
    it("compiles a checkpoint with a stripped gate regex", () => {
        const compiled = compileRules([
            {
                siteRegex: "/x\\.test/",
                rules: [{ kind: "checkpoint", regex: "/session=on/g", mode: "continue" }],
            },
        ]);
        expect(compiled[0].rules[0].kind).toBe("checkpoint");
        expect((compiled[0].rules[0] as any).checkpointRe.global).toBe(false);
    });

    it("drops checkpoint rules with invalid regex", () => {
        const compiled = compileRules([
            {
                siteRegex: "/x\\.test/",
                rules: [
                    { kind: "checkpoint", regex: "/([unclosed/", mode: "continue" },
                    { kind: "replace", regex: "/a/", substitution: "b" },
                ],
            },
        ]);
        expect(compiled[0].rules).toHaveLength(1);
        expect(compiled[0].rules[0].kind).toBe("replace");
    });
});

describe("applyRules — checkpoint rules", () => {
    it("continues and applies following rules when continue-mode matches", () => {
        const out = run("https://x.test/track?session=on", [
            {
                siteRegex: "/x\\.test/",
                rules: [
                    { kind: "checkpoint", regex: "/session=on/", mode: "continue" },
                    { kind: "replace", regex: "/track/", substitution: "clean" },
                ],
            },
        ]);
        expect(out).toBe("https://x.test/clean?session=on");
    });

    it("aborts following rules when continue-mode does not match", () => {
        const out = run("https://x.test/track", [
            {
                siteRegex: "/x\\.test/",
                rules: [
                    { kind: "checkpoint", regex: "/session=on/", mode: "continue" },
                    { kind: "replace", regex: "/track/", substitution: "clean" },
                ],
            },
        ]);
        expect(out).toBe("https://x.test/track");
    });

    it("aborts following rules when stop-mode matches", () => {
        const out = run("https://x.test/page", [
            {
                siteRegex: "/x\\.test/",
                rules: [
                    { kind: "replace", regex: "/page/", substitution: "done" },
                    { kind: "checkpoint", regex: "/\\/done/", mode: "stop" },
                    { kind: "appendQuery", params: "again=1" },
                ],
            },
        ]);
        expect(out).toBe("https://x.test/done");
    });

    it("continues following rules when stop-mode does not match", () => {
        const out = run("https://x.test/page", [
            {
                siteRegex: "/x\\.test/",
                rules: [
                    { kind: "replace", regex: "/page/", substitution: "done" },
                    { kind: "checkpoint", regex: "/\\/never/", mode: "stop" },
                    { kind: "appendQuery", params: "again=1" },
                ],
            },
        ]);
        expect(out).toBe("https://x.test/done?again=1");
    });

    it("drops an empty checkpoint regex at compile", () => {
        const siteRules: SiteRule[] = [
            {
                siteRegex: "/x\\.test/",
                rules: [
                    { kind: "checkpoint", regex: "", mode: "stop" },
                    { kind: "appendQuery", params: "again=1" },
                ],
            },
        ];
        const compiled = compileRules(siteRules);
        expect(compiled[0].rules.map((rule) => rule.kind)).toEqual(["appendQuery"]);
        expect(applyRules("https://x.test/page", compiled).url).toBe("https://x.test/page?again=1");
    });

    it("does not record checkpoints in applied", () => {
        const result = applyRules(
            "https://x.test/page?session=on",
            compileRules([
                {
                    siteRegex: "/x\\.test/",
                    rules: [
                        { kind: "checkpoint", regex: "/session=on/", mode: "continue" },
                        { kind: "replace", regex: "/page/", substitution: "done" },
                    ],
                },
            ]),
        );
        expect(result.url).toBe("https://x.test/done?session=on");
        expect(result.applied).toHaveLength(1);
        expect(result.applied[0].rule.kind).toBe("replace");
    });

    it("limits checkpoint abort to the current group", () => {
        const out = run("https://x.test/page", [
            {
                siteRegex: "/x\\.test/",
                rules: [
                    { kind: "checkpoint", regex: "/nomatch/", mode: "continue" },
                    { kind: "appendQuery", params: "first=1" },
                ],
            },
            { siteRegex: "/x\\.test/", rules: [{ kind: "appendQuery", params: "second=2" }] },
        ]);
        expect(out).toBe("https://x.test/page?second=2");
    });
});

describe("applyRules — debug correlation", () => {
    it("puts the watcher runId into engine debug payloads", () => {
        const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
        setLogLevel("debug");
        try {
            applyRules(
                "https://x.test/page",
                compileRules([
                    { siteRegex: "/x\\.test/", rules: [{ kind: "replace", regex: "/page/", substitution: "next" }] },
                ]),
                { runId: 7 },
            );
            const payloads = debug.mock.calls
                .map((args) => args[5])
                .filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null);
            expect(payloads.some((payload) => payload.runId === 7)).toBe(true);
        } finally {
            setLogLevel("info");
            debug.mockRestore();
        }
    });

    it("does not emit debug payloads at info", () => {
        const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
        setLogLevel("info");
        try {
            applyRules(
                "https://x.test/page",
                compileRules([
                    { siteRegex: "/x\\.test/", rules: [{ kind: "replace", regex: "/page/", substitution: "next" }] },
                ]),
                { runId: 8 },
            );
            expect(debug).not.toHaveBeenCalled();
        } finally {
            debug.mockRestore();
        }
    });
});

describe("removeQuery rules", () => {
    const group: SiteRule = {
        siteRegex: "/^https?:\\/\\/x\\.test\\//",
        rules: [{ kind: "removeQuery", regex: "", keys: "utm_*&fbclid" }],
    };

    it("compiles and applies the key removal", () => {
        expect(run("https://x.test/p?utm_source=a&id=1&fbclid=x", [group])).toBe("https://x.test/p?id=1");
    });

    it("respects an authored gate against the decoded query", () => {
        const gated: SiteRule = {
            siteRegex: "/^https?:\\/\\/x\\.test\\//",
            rules: [{ kind: "removeQuery", regex: "/keep/", keys: "utm_*" }],
        };
        expect(run("https://x.test/p?utm_source=a&keep=1", [gated])).toBe("https://x.test/p?keep=1");
        expect(run("https://x.test/p?utm_source=a&id=1", [gated])).toBe("https://x.test/p?utm_source=a&id=1");
    });

    it("drops removeQuery rules with an invalid gate regex", () => {
        const compiled = compileRules([
            {
                siteRegex: "/ok\\.test/",
                rules: [
                    { kind: "removeQuery", regex: "/([unclosed/", keys: "a" },
                    { kind: "removeQuery", keys: "b" },
                ],
            },
        ]);
        expect(compiled[0].rules).toHaveLength(1);
        expect(compiled[0].rules[0].kind).toBe("removeQuery");
    });
});
