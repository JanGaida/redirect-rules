import { describe, expect, it } from "vitest";
import { applyRules, compileRules } from "../redirect-engine";
import type { SiteRule } from "../settings";

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Ported legacy corpus
// ─────────────────────────────────────────────────────────────────────────────
// * Table-driven port of the legacy in-browser sample set (~75 no-change URLs,
//   ~40 expected changes, rules 1–12) mapped onto the typed rule model.
// * Rule 12's legacy `$&&param` query-merge hack became three appendQuery rules.
// * Documented deviations from the never-green legacy suite: rule 4 was a literal
//   (ported with /…/), rule 6 expected a trailing slash, rule 12 lost the fragment.

const RULES: SiteRule[] = [
    // * Rule 1: example.de|fr → example.com
    {
        siteRegex: "/example\\.(de|fr)/",
        rules: [{ kind: "replace", regex: "/example\\.(de|fr)(\\/.*|\\?.*)?/", substitution: "example.com?prev=$1" }],
    },
    // * Rule 2: sub.example.com → sub.example.org
    {
        siteRegex: "/sub\\.example\\.com/",
        rules: [{ kind: "replace", regex: "/sub\\.example\\.com/", substitution: "sub.example.org" }],
    },
    // * Rule 3: secure.example.com → login.example.com (port consumed)
    {
        siteRegex: "/secure\\.example\\.com/",
        rules: [{ kind: "replace", regex: "/secure\\.example\\.com(:[0-9]+)?/", substitution: "login.example.com" }],
    },
    // * Rule 4: example.baz → example.baz/new (fixed notation, see header note 1)
    {
        siteRegex: "/example\\.baz/",
        rules: [{ kind: "replace", regex: "/^(https?:\\/\\/example\\.baz)(\\/.*)?/", substitution: "$1/new$2" }],
    },
    // * Rule 5: longpath.example.com → shortened.example.com
    {
        siteRegex: "/longpath\\.example\\.com/",
        rules: [{ kind: "replace", regex: "/longpath\\.example\\.com/", substitution: "shortened.example.com" }],
    },
    // * Rule 6: :8080 → :9090
    {
        siteRegex: "/example\\.qux:8080/",
        rules: [{ kind: "replace", regex: "/:8080/", substitution: ":9090" }],
    },
    // * Rule 7: example.foo → example.com
    {
        siteRegex: "/example\\.foo/",
        rules: [{ kind: "replace", regex: "/example\\.foo/", substitution: "example.com" }],
    },
    // * Rule 8: /route-path/to/ → /routed/to/
    {
        siteRegex: "/example\\.com/",
        rules: [{ kind: "replace", regex: "/\\/route-path\\/to\\//", substitution: "/routed/to/" }],
    },
    // * Rule 9: example.com/page → example.com/page?id=123 (existing query consumed)
    {
        siteRegex: "/example\\.com/",
        rules: [{ kind: "replace", regex: "/(example\\.com\\/page)(\\?.*)?/", substitution: "$1?id=123" }],
    },
    // * Rule 10: case-insensitive EXAMPLE.COM → example.com
    {
        siteRegex: "/example\\.com/i",
        rules: [{ kind: "replace", regex: "/EXAMPLE\\.COM/i", substitution: "example.com" }],
    },
    // * Rule 11: pathofexile2.wiki.fextralife.com → poe2wiki.net
    {
        siteRegex: "/pathofexile2\\.wiki\\.fextralife\\.com/",
        rules: [
            {
                kind: "replace",
                regex: "/^(https?:)\\/\\/pathofexile2\\.wiki\\.fextralife\\.com\\/Path\\+of\\+Exile\\+2\\+Wiki/",
                substitution: "$1//www.poe2wiki.net/wiki/Path_of_Exile_2_Wiki",
            },
            {
                kind: "replace",
                regex: "/^(https?:)\\/\\/pathofexile2\\.wiki\\.fextralife\\.com\\/(?!Path\\+of\\+Exile\\+2\\+Wiki)(.+)/",
                substitution: "$1//www.poe2wiki.net/index.php?search=$2&title=Special:Search&go=Go",
            },
        ],
    },
    // * Rule 12: query-param merging (legacy `$&&` hack → appendQuery, gate on /page)
    {
        siteRegex: "/merge\\.example\\.zap/",
        rules: [
            { kind: "appendQuery", regex: "/merge\\.example\\.zap\\/page/", params: "base=1" },
            { kind: "appendQuery", regex: "/merge\\.example\\.zap\\/page/", params: "extra=2" },
            { kind: "appendQuery", regex: "/merge\\.example\\.zap\\/page/", params: "deep=3" },
        ],
    },
];

const COMPILED = compileRules(RULES);

/** Applies the full corpus rule set to one url. */
function through(url: string): string {
    return applyRules(url, COMPILED).url;
}

// * Verbatim port of the legacy no-change sample set (kept in the original order
//   incl. legacy duplicates — fidelity over dedupe). None of these may match any
//   site gate or change in any other way.
const NO_CHANGE: string[] = [
    "http://te!st.com/weird*path?query=string#frag=ment",
    "http://www.test.com/verylongpath/that/keeps/going/on/and/on/and/on/and/on/and/on/and/on/and/on/and/on/and/on/and/on/and/on",
    "http://sub.sub.sub.sub.sub.test.com",
    "http://www.test.com:8080",
    "http://user:pass@www.test.com",
    "http://www.test.com/path/to/resource#fragment",
    "http://192.168.1.1",
    "ttp://www.test.com:12345",
    "http://www.test.xyz",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
    "ftp://ftp.test.com",
    "https://secure.test.com",
    "http://www.test.com/path?param1=value1&param2=value2#fragment",
    "http://www.test.com/path?param1=value1&param1=value2#fragment",
    "http://www.test.com/path%20with%20spaces",
    "http://www.test.com/path%3Fwith%3Fencoded%3Fchars",
    "http://www.täst.com/ümläüts",
    "http://www.test.com/../path/to/resource",
    "http://www.test.com//path//with//double//slashes",
    "http://www.test.com/path with spaces",
    "http://test.com:80/path/to/resource",
    "http://test.com/path/to/resource?query=string#fragment",
    "http://test.com/path/to/resource?query=string#fragment",
    "https://te!st.com/weird*path?query=string#frag=ment",
    "https://www.test.com/verylongpath/that/keeps/going/on/and/on/and/on/and/on/and/on/and/on/and/on/and/on/and/on/and/on",
    "https://www.test.com/MiXeDcAsE",
    "https://sub.sub.sub.sub.sub.test.com",
    "https://www.test.com:8080",
    "https://user:pass@www.test.com",
    "https://www.test.com/path/to/resource#fragment",
    "https://192.168.1.1",
    "ttp://www.test.com:12345",
    "https://www.test.xyz",
    "https://127.0.0.1:8080",
    "https://[::1]:8080",
    "ftps://ftp.test.com",
    "https://secure.test.com",
    "https://www.test.com/path?param1=value1&param2=value2#fragment",
    "https://www.test.com/path?param1=value1&param1=value2#fragment",
    "https://www.test.com/path%20with%20spaces",
    "https://www.test.com/path%3Fwith%3Fencoded%3Fchars",
    "https://www.exämple.com/ümläüts",
    "https://www.test.com/../path/to/resource",
    "https://www.test.com//path//with//double//slashes",
    "https://www.test.com/path with spaces",
    "https://test.com:80/path/to/resource",
    "https://test.com/path/to/resource?query=string#fragment",
    "https://test.com/path/to/resource?query=string#fragment",
    "te!st.com/weird*path?query=string#frag=ment",
    "www.test.com/verylongpath/that/keeps/going/on/and/on/and/on/and/on/and/on/and/on/and/on/and/on/and/on/and/on",
    "www.test.com/MiXeDcAsE",
    "sub.sub.sub.sub.sub.test.com",
    "www.test.com:8080",
    "user:pass@www.test.com",
    "www.test.com/path/to/resource#fragment",
    "192.168.1.1",
    "w.test.com:12345",
    "www.test.xyz",
    "127.0.0.1:8080",
    "[::1]:8080",
    "ftp.test.com",
    "secure.test.com",
    "www.test.com/path?param1=value1&param2=value2#fragment",
    "www.test.com/path?param1=value1&param1=value2#fragment",
    "www.test.com/path%20with%20spaces",
    "www.test.com/path%3Fwith%3Fencoded%3Fchars",
    "www.exämple.com/ümläüts",
    "www.test.com/../path/to/resource",
    "www.test.com//path//with//double//slashes",
    "www.test.com/path with spaces",
    "test.com:80/path/to/resource",
    "test.com/path/to/resource?query=string#fragment",
    "test.com/path/to/resource?query=string#fragment",
];

interface ChangeCase {
    url: string;
    expected: string;
}

const CHANGES: ChangeCase[] = [
    // * Rule 1
    { url: "http://example.de/home", expected: "http://example.com?prev=de" },
    { url: "http://example.fr/about", expected: "http://example.com?prev=fr" },
    { url: "http://example.de?foo=bar", expected: "http://example.com?prev=de" },
    // * Rule 2
    { url: "http://sub.example.com/path", expected: "http://sub.example.org/path" },
    { url: "http://sub.example.com/about?x=1", expected: "http://sub.example.org/about?x=1" },
    { url: "http://sub.example.com/", expected: "http://sub.example.org/" },
    // * Rule 3
    { url: "http://secure.example.com/login", expected: "http://login.example.com/login" },
    { url: "http://secure.example.com/path/to/page", expected: "http://login.example.com/path/to/page" },
    { url: "http://secure.example.com:8080", expected: "http://login.example.com" },
    // * Rule 4 (notation fixed — see header note 1)
    { url: "http://example.baz/page1", expected: "http://example.baz/new/page1" },
    { url: "http://example.baz/page2?bar=baz", expected: "http://example.baz/new/page2?bar=baz" },
    { url: "http://example.baz", expected: "http://example.baz/new" },
    // * Rule 5
    { url: "http://longpath.example.com/a/b/c/d/e", expected: "http://shortened.example.com/a/b/c/d/e" },
    { url: "http://longpath.example.com/x/y/z", expected: "http://shortened.example.com/x/y/z" },
    { url: "http://longpath.example.com/123/456/789", expected: "http://shortened.example.com/123/456/789" },
    // * Rule 6 (trailing-slash expectation fixed — see header note 2)
    { url: "http://www.example.qux:8080/path", expected: "http://www.example.qux:9090/path" },
    { url: "http://secure.example.qux:8080/login", expected: "http://secure.example.qux:9090/login" },
    { url: "http://example.qux:8080", expected: "http://example.qux:9090" },
    // * Rule 7
    { url: "http://example.foo", expected: "http://example.com" },
    { url: "http://example.foo/about", expected: "http://example.com/about" },
    { url: "http://example.foo/contact?prev=home", expected: "http://example.com/contact?prev=home" },
    // * Rule 8
    { url: "http://example.com/route-path/to/resource", expected: "http://example.com/routed/to/resource" },
    { url: "http://example.com/route-path/from/data", expected: "http://example.com/route-path/from/data" },
    { url: "http://example.com/route-path/to/data", expected: "http://example.com/routed/to/data" },
    // * Rule 9
    { url: "http://example.com/page", expected: "http://example.com/page?id=123" },
    { url: "http://example.com/page?unique=2", expected: "http://example.com/page?id=123" },
    { url: "http://example.com/", expected: "http://example.com/" },
    // * Rule 10
    { url: "http://EXAMPLE.COM/UPPERCASE", expected: "http://example.com/UPPERCASE" },
    { url: "http://Example.com/MiXeD", expected: "http://example.com/MiXeD" },
    { url: "http://EXaMpLe.com/Path/With/MIXED", expected: "http://example.com/Path/With/MIXED" },
    // * Rule 11
    {
        url: "https://pathofexile2.wiki.fextralife.com/Path+of+Exile+2+Wiki",
        expected: "https://www.poe2wiki.net/wiki/Path_of_Exile_2_Wiki",
    },
    {
        url: "https://pathofexile2.wiki.fextralife.com/Headhunter+Heavy+Belt",
        expected: "https://www.poe2wiki.net/index.php?search=Headhunter+Heavy+Belt&title=Special:Search&go=Go",
    },
    {
        url: "https://pathofexile2.wiki.fextralife.com/Exalted+Orb",
        expected: "https://www.poe2wiki.net/index.php?search=Exalted+Orb&title=Special:Search&go=Go",
    },
    // * Rule 12 — appendQuery (base=1 now present in the fragment case, see header note 3)
    { url: "https://merge.example.zap/page", expected: "https://merge.example.zap/page?base=1&extra=2&deep=3" },
    {
        url: "https://merge.example.zap/page?foo=bar",
        expected: "https://merge.example.zap/page?foo=bar&base=1&extra=2&deep=3",
    },
    {
        url: "https://merge.example.zap/page?search=Headhunter+Heavy+Belt",
        expected: "https://merge.example.zap/page?search=Headhunter+Heavy+Belt&base=1&extra=2&deep=3",
    },
    { url: "https://merge.example.zap/page/", expected: "https://merge.example.zap/page/?base=1&extra=2&deep=3" },
    {
        url: "https://merge.example.zap/page?foo=bar&search=Exalted+Orb",
        expected: "https://merge.example.zap/page?foo=bar&search=Exalted+Orb&base=1&extra=2&deep=3",
    },
    {
        url: "https://merge.example.zap/page?foo=bar#section1",
        expected: "https://merge.example.zap/page?foo=bar&base=1&extra=2&deep=3#section1",
    },
    {
        url: "https://merge.example.zap/page#section2",
        expected: "https://merge.example.zap/page?base=1&extra=2&deep=3#section2",
    },
];

describe("corpus — ported legacy unit-test sample set", () => {
    it("compiles the full rule set without dropping anything", () => {
        // * If a rule typo slipped in, compileRules would fail-soft DROP it and the
        //   expectations below would mysteriously fail — assert the shape up front.
        expect(COMPILED).toHaveLength(RULES.length);
        expect(COMPILED.map((s) => s.rules.length).reduce((a, b) => a + b, 0)).toBe(
            RULES.map((s) => s.rules.length).reduce((a, b) => a + b, 0),
        );
    });

    describe.each(NO_CHANGE.map((url) => [url]))("no change: %s", (url: string) => {
        it("stays unchanged", () => {
            expect(through(url)).toBe(url);
        });
    });

    describe.each(CHANGES.map((c) => [c.url, c.expected]))("change: %s", (url: string, expected: string) => {
        it(`rewrites to ${expected}`, () => {
            expect(through(url)).toBe(expected);
        });
    });
});
