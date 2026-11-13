import { describe, expect, it } from "vitest";
import { applyRules, compileRules } from "../redirect-engine";
import { previewGroup } from "../preview";
import { EXAMPLE_RULES } from "../settings";

/** Compiled once with the opt-in groups included — the engine oracle for these specs. */
const COMPILED = compileRules(EXAMPLE_RULES, { includeDisabled: true });

/** Applies the shipped default groups to one URL. */
function apply(url: string): string {
    return applyRules(url, COMPILED).url;
}

describe("EXAMPLE_RULES — first-boot defaults", () => {
    it("ships the twenty-seven real-world site groups", () => {
        expect(EXAMPLE_RULES).toHaveLength(27);
    });

    it("fills every authored string and ships every group DISABLED (ADR 0038)", () => {
        for (const site of EXAMPLE_RULES) {
            expect(site.siteRegex.trim()).not.toBe("");
            expect(site.description?.trim() ?? "").not.toBe("");
            expect(site.disabled).toBe(true);
            expect(site.rules.length).toBeGreaterThan(0);
            expect(site.previewEntries?.length ?? 0).toBeGreaterThan(0);
            for (const entry of site.previewEntries ?? []) {
                expect(entry.url.trim()).not.toBe("");
                expect(entry.testOutputUri.trim()).not.toBe("");
                expect(entry.description?.trim() ?? "").not.toBe("");
            }
            for (const rule of site.rules) {
                if (rule.kind === "appendQuery") {
                    // * An empty gate is intentional: the site gate scopes the rule.
                    expect(rule.params.trim()).not.toBe("");
                    continue;
                }
                if (rule.kind === "removeQuery") {
                    // * An empty gate is intentional: the site gate scopes the rule.
                    expect(rule.keys.trim()).not.toBe("");
                    continue;
                }
                expect(rule.regex.trim()).not.toBe("");
            }
        }
    });

    it("pins every preview entry to the group replay", () => {
        for (const site of EXAMPLE_RULES) {
            for (const entry of site.previewEntries ?? []) {
                expect(previewGroup(entry.url, site).finalUrl).toBe(entry.testOutputUri);
            }
        }
    });

    it("reaches every pinned output through the real engine", () => {
        for (const site of EXAMPLE_RULES) {
            for (const entry of site.previewEntries ?? []) {
                expect(apply(entry.url)).toBe(entry.testOutputUri);
            }
        }
    });

    it("is idempotent for every pinned and extra input", () => {
        // * G9 + G10 are deliberately two-phase: tree file -> blob -> raw. The
        //   single-pass loop excludes their tree inputs; the next test pins the pair.
        const treeInputs = new Set(
            EXAMPLE_RULES.flatMap((site) => (site.previewEntries ?? []).map((entry) => entry.url)).filter((url) =>
                url.includes("/tree/"),
            ),
        );
        const urls = [
            ...EXAMPLE_RULES.flatMap((site) => (site.previewEntries ?? []).map((entry) => entry.url)),
            "https://m.youtube.com/watch?v=abc",
            "https://youtube.com/shorts/abc/?si=x",
            "https://youtu.be/abc123?si=xyz&t=42",
            "https://www.google.com/amp/s/example.com/article?amp=1#top",
            "https://www.google.com/search?q=x&num=50&udm=48",
            "https://www.google.com/search?q=x&sxsrf=abc&ei=def",
            "https://www.google.com/maps/place/X?entry=ttu&g_ep=abc",
            "https://stackoverflow.com/questions/1/x?utm_source=y",
            "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F",
            "https://www.bing.com/search?q=x&cvid=y&form=QBLH",
            "https://r.search.yahoo.com/_ylt=x/RU=https%3A%2F%2Fexample.com%2F/RK=2",
            "https://redd.it/abc123?share_id=x",
            "https://github.com/o/r/blob/main/a.ts",
            "https://gist.github.com/u/abcdef/raw/a.sh",
            "https://commons.wikimedia.org/wiki/File:Example.jpg",
            "https://example.com/p?utm_source=a&id=1",
            "https://www.amazon.de/dp/ASIN/ref=sr_1_1?psc=1",
            "https://open.spotify.com/track/ID?si=x",
            "https://www.linkedin.com/posts/x?trk=public_post",
            "https://www.instagram.com/p/X/?igsh=x",
            "https://www.facebook.com/share/p/x/?mibextid=x",
            "https://www.tiktok.com/@u/video/1?_t=1",
            "https://www.ebay.de/itm/1?hash=item1",
            "https://www.reddit.com/r/x/comments/y/?share_id=z",
            "https://example.com/?utm_source=x#frag",
        ];
        for (const url of urls) {
            if (treeInputs.has(url)) continue;
            const once = apply(url);
            expect(apply(once), url).toBe(once);
        }
    });

    it("pins the GitHub tree→blob→raw two-phase normalization", () => {
        const treeFile = "https://github.com/owner/repo/tree/main/src/index.ts";
        const blob = apply(treeFile);
        expect(blob).toBe("https://github.com/owner/repo/blob/main/src/index.ts");
        const raw = apply(blob);
        expect(raw).toBe("https://raw.githubusercontent.com/owner/repo/main/src/index.ts");
        expect(apply(raw)).toBe(raw);
    });

    it("normalizes mobile, Shorts, short links, variants, search, AMP and tracking", () => {
        const cases: ReadonlyArray<readonly [input: string, expected: string]> = [
            ["https://de.m.wikipedia.org/wiki/X?foo=1", "https://de.wikipedia.org/wiki/X?foo=1"],
            ["https://m.youtube.com/watch?v=abc", "https://www.youtube.com/watch?v=abc"],
            ["https://youtube.com/shorts/abc/?si=x", "https://www.youtube.com/watch?v=abc"],
            ["https://youtu.be/abc123", "https://www.youtube.com/watch?v=abc123"],
            ["https://youtu.be/abc123?t=42", "https://www.youtube.com/watch?v=abc123&t=42"],
            ["https://youtu.be/abc123?si=xyz&t=42", "https://www.youtube.com/watch?v=abc123&t=42"],
            ["https://www.youtube.com/watch?v=abc123&si=xyz", "https://www.youtube.com/watch?v=abc123"],
            ["https://www.youtube.com/embed/abc123?start=5", "https://www.youtube.com/watch?v=abc123&start=5"],
            ["https://old.reddit.com/r/x?sort=new", "https://www.reddit.com/r/x?sort=new"],
            ["https://new.reddit.com/r/x", "https://www.reddit.com/r/x"],
            ["https://i.reddit.com/r/x", "https://www.reddit.com/r/x"],
            ["https://np.reddit.com/r/x", "https://www.reddit.com/r/x"],
            ["https://www.google.com/search?q=x&num=50&udm=48", "https://www.google.com/search?q=x&num=100&udm=48"],
            ["https://www.google.com/search?q=x&udm=2", "https://www.google.com/search?q=x&udm=2&num=100"],
            ["https://www.google.com/search?q=x&tbm=isch", "https://www.google.com/search?q=x&tbm=isch&num=100"],
            ["https://www.google.com/amp/s/example.com/article?amp=1#top", "https://example.com/article#top"],
            ["https://www.google.com/amp/s/example.com/article/amp?foo=1", "https://example.com/article?foo=1"],
            ["https://www.google.com/amp/s/example.com/article?amp=1&foo=2", "https://example.com/article?foo=2"],
            ["https://example.com/p?utm_source=a&id=1", "https://example.com/p?id=1"],
            ["https://example.com/p?id=1&utm_source=a#frag", "https://example.com/p?id=1#frag"],
        ];
        for (const [input, expected] of cases) expect(apply(input), input).toBe(expected);
    });

    it("cleans real-world shopping and social share links", () => {
        const cases: ReadonlyArray<readonly [input: string, expected: string]> = [
            [
                "https://www.amazon.de/dp/B08N5WRWNW/ref=sr_1_1?tag=foo&pd_rd_w=abc&qid=123&psc=1",
                "https://www.amazon.de/dp/B08N5WRWNW?psc=1",
            ],
            ["https://open.spotify.com/track/ID?si=abc", "https://open.spotify.com/track/ID"],
            [
                "https://www.linkedin.com/posts/foo-activity-123?utm_source=share&rcm=abc",
                "https://www.linkedin.com/posts/foo-activity-123",
            ],
            [
                "https://www.instagram.com/p/Cabc123/?igsh=xyz&utm_source=copy_link",
                "https://www.instagram.com/p/Cabc123/",
            ],
            ["https://www.facebook.com/share/p/abc/?mibextid=xyz&fbclid=def", "https://www.facebook.com/share/p/abc/"],
            [
                "https://www.tiktok.com/@user/video/123?_t=8abc&_r=1&is_from_webapp=1",
                "https://www.tiktok.com/@user/video/123",
            ],
            [
                "https://www.ebay.de/itm/123456789?_trkparms=abc&_trksid=p123&campid=456&hash=item1",
                "https://www.ebay.de/itm/123456789?hash=item1",
            ],
            [
                "https://www.reddit.com/r/test/comments/abc/title/?share_id=xyz&utm_source=share&correlation_id=def",
                "https://www.reddit.com/r/test/comments/abc/title/",
            ],
            ["https://old.reddit.com/r/x?share_id=z", "https://www.reddit.com/r/x"],
            ["https://example.com/p?id=1&gbraid=x&srsltid=y&ref_src=z", "https://example.com/p?id=1"],
        ];
        for (const [input, expected] of cases) expect(apply(input), input).toBe(expected);
    });

    it("normalizes search, wrapper, developer and file links", () => {
        const cases: ReadonlyArray<readonly [input: string, expected: string]> = [
            [
                "https://www.google.com/search?q=x&num=100&udm=2&sxsrf=abc&ei=def",
                "https://www.google.com/search?q=x&num=100&udm=2",
            ],
            ["https://www.google.com/maps/place/X?entry=ttu&g_ep=abc", "https://www.google.com/maps/place/X"],
            [
                "https://stackoverflow.com/questions/1/x?utm_source=share&answertab=votes",
                "https://stackoverflow.com/questions/1/x?answertab=votes",
            ],
            ["https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage%3Fa%3D1", "https://example.com/page?a=1"],
            [
                "https://www.google.com/imgres?imgurl=https%3A%2F%2Fexample.com%2Fa.jpg&tbnid=x",
                "https://example.com/a.jpg",
            ],
            ["https://www.bing.com/search?q=x&cvid=abc&form=QBLH", "https://www.bing.com/search?q=x"],
            ["https://r.search.yahoo.com/_ylt=x/RU=https%3a%2f%2fexample.com%2f/RK=2", "https://example.com/"],
            ["https://redd.it/abc123?share_id=x", "https://www.reddit.com/comments/abc123"],
            ["https://github.com/o/r/blob/main/a.ts", "https://raw.githubusercontent.com/o/r/main/a.ts"],
            ["https://github.com/o/r/tree/main/a.ts", "https://github.com/o/r/blob/main/a.ts"],
            ["https://gist.github.com/u/abcdef", "https://gist.githubusercontent.com/u/abcdef/raw"],
            [
                "https://commons.wikimedia.org/wiki/File:Example.jpg",
                "https://commons.wikimedia.org/wiki/Special:Redirect/file/Example.jpg",
            ],
        ];
        for (const [input, expected] of cases) expect(apply(input), input).toBe(expected);
    });

    it("preserves non-tracking YouTube params through the rewrite", () => {
        expect(apply("https://www.youtube.com/shorts/abc?list=PL1&t=42")).toBe(
            "https://www.youtube.com/watch?v=abc&list=PL1&t=42",
        );
        expect(apply("https://www.youtube.com/watch?v=abc&list=PL1")).toBe(
            "https://www.youtube.com/watch?v=abc&list=PL1",
        );
    });

    it("never rewrites wrapper URLs that merely contain a gated host", () => {
        const wrappers = [
            "https://www.google.com/url?q=https://old.reddit.com/r/test/",
            "https://example.com/?next=https://de.m.wikipedia.org/wiki/Beispiel",
            "https://example.com/?u=https://www.google.com/search?q=x",
            "https://example.com/?u=https://m.youtube.com/shorts/abc123",
            "https://example.com/?u=https://youtu.be/abc123",
            "https://example.com/?u=https://www.youtube.com/embed/abc123",
        ];
        for (const url of wrappers) expect(apply(url), url).toBe(url);
    });

    it("strips tracking on wrappers without touching the embedded target", () => {
        expect(apply("https://example.com/?next=https://de.m.wikipedia.org/wiki/Beispiel&utm_source=news")).toBe(
            "https://example.com/?next=https://de.m.wikipedia.org/wiki/Beispiel",
        );
    });

    it("leaves deliberate non-goals untouched", () => {
        const unchanged = [
            "https://www.youtube.com/live/abc123",
            "https://www.youtube.com/watch?v=abc123&t=10",
            "https://www.youtube.com/watch?v=abc123&list=PL123&index=2",
            "https://aws.amazon.com/console/",
            "https://open.spotify.com/track/ID?context=spotify:playlist:123",
            "https://www.instagram.com/p/X/?img_index=2",
            "https://www.amazon.de/dp/ASIN?psc=1",
            "https://www.amazon.de/dp/ASIN?th=1",
            "https://www.ebay.de/itm/1?hash=item1",
            "https://www.facebook.com/permalink.php?story_fbid=123&id=456",
        ];
        for (const url of unchanged) expect(apply(url), url).toBe(url);
    });

    it("carries no fictional demo rules", () => {
        const serialized = JSON.stringify(EXAMPLE_RULES);
        expect(serialized).not.toContain("example.de");
        expect(serialized).not.toContain("startpage.com");
    });
});
