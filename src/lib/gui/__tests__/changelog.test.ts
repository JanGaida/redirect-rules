import { describe, it, expect } from "vitest";

import { parseChangelog, renderChangelog, type ChangelogLabels } from "../changelog";

const LABELS: ChangelogLabels = {
    current: "Current",
    types: {
        feat: "Features",
        fix: "Bug Fixes",
        perf: "Performance",
        revert: "Reverts",
        docs: "Documentation",
    },
};

const DE_LABELS: ChangelogLabels = {
    current: "Aktuell",
    types: {
        feat: "Features",
        fix: "Bugfixes",
        perf: "Performance",
        revert: "Reverts",
        docs: "Dokumentation",
    },
};

function render(markdown: string, locale = "en", labels = LABELS): string {
    return renderChangelog(parseChangelog(markdown), { locale, labels });
}

describe("parseChangelog", () => {
    it("keeps the preamble and skips the changelog title", () => {
        const model = parseChangelog("# Changelog\n\nIntro text\n\n## 1.0.0\n\n- item");

        expect(model.preamble).toEqual(["Intro text"]);
        expect(model.releases).toHaveLength(1);
        expect(model.looseItems).toEqual([]);
    });

    it("joins wrapped lines into one paragraph", () => {
        const model = parseChangelog("# Changelog\n\nline one\nline two\n\n## 1.0.0\n\n- item");

        expect(model.preamble).toEqual(["line one line two"]);
    });

    it("parses the optional release date", () => {
        const dated = parseChangelog("## 1.2.3 (2026-10-26)");
        const plain = parseChangelog("## 1.2.3");

        expect(dated.releases[0]).toMatchObject({ version: "1.2.3", date: "2026-10-26" });
        expect(plain.releases[0]).toMatchObject({ version: "1.2.3", date: null });
    });

    it("maps known sections and keeps unknown ones under their original label", () => {
        const model = parseChangelog(
            [
                "## 1.0.0",
                "",
                "### Features",
                "",
                "- a",
                "",
                "### Bug Fixes",
                "",
                "- b",
                "",
                "### Performance Improvements",
                "",
                "- c",
                "",
                "### Reverts",
                "",
                "- d",
                "",
                "### Documentation",
                "",
                "- e",
                "",
                "### Chores",
                "",
                "- f",
            ].join("\n"),
        );

        expect(model.releases[0].groups.map((group) => [group.type, group.label])).toEqual([
            ["feat", null],
            ["fix", null],
            ["perf", null],
            ["revert", null],
            ["docs", null],
            ["other", "Chores"],
        ]);
    });

    it("keeps group order from the markdown", () => {
        const model = parseChangelog("## 1.0.0\n\n### Documentation\n\n- d\n\n### Features\n\n- f");

        expect(model.releases[0].groups.map((group) => group.type)).toEqual(["docs", "feat"]);
    });

    it("extracts a leading scope but not URL schemes", () => {
        const model = parseChangelog(
            [
                "## 1.0.0",
                "",
                "### Features",
                "",
                "- rebrand: restarted the project",
                "- https://example.com is not a scope",
                "- http: //example.com is not a scope either",
            ].join("\n"),
        );
        const items = model.releases[0].groups[0].items;

        expect(items[0].scope).toBe("rebrand");
        expect(items[0].html).toBe("restarted the project");
        expect(items[1].scope).toBeNull();
        expect(items[2].scope).toBeNull();
    });

    it("collects bullets without a section as loose items", () => {
        const model = parseChangelog("## 1.0.0\n\n- one\n\n- two");

        expect(model.releases[0].looseItems).toEqual(["one", "two"]);
    });
});

describe("renderChangelog", () => {
    it("renders the preamble as a lead line", () => {
        const html = render("# Changelog\n\nIntro text\n\n## 1.0.0\n\n- item");

        expect(html).not.toContain("Changelog</");
        expect(html).toContain('<p class="rr-changelog-p rr-changelog-lead">Intro text</p>');
    });

    it("renders version, localized date, and datetime", () => {
        const html = render("## 1.2.3 (2026-10-26)\n\n- item");

        expect(html).toContain('<span class="rr-changelog-version">v1.2.3</span>');
        expect(html).toContain('<time class="rr-changelog-date" datetime="2026-10-26">Oct 26, 2026</time>');
    });

    it("renders without a date when it is missing", () => {
        const html = render("## 1.2.3\n\n- item");

        expect(html).not.toContain("rr-changelog-date");
    });

    it("folds every release until the user opens one", () => {
        const html = render("## 2.0.0\n\n- a\n\n## 1.0.0\n\n- b");

        expect(html).toContain('<details class="rr-changelog-release is-latest">');
        expect(html).not.toContain(" open>");
        expect(html.match(/class="rr-changelog-release"/g)).toHaveLength(1);
        expect(html.indexOf("v2.0.0")).toBeLessThan(html.indexOf("v1.0.0"));
    });

    it("renders group headings, icons, and per-release counters", () => {
        const html = render("## 1.0.0\n\n### Features\n\n- a\n\n- b\n\n### Bug Fixes\n\n- c");

        expect(html).toContain("rr-changelog-tone--feat");
        expect(html).toContain('<span class="rr-changelog-group-count">2</span>');
        expect(html).toContain('aria-label="Features: 2"');
        expect(html).toContain('aria-label="Bug Fixes: 1"');
        expect(html).toContain('class="rr-icon rr-changelog-group-icon"');
    });

    it("renders unknown sections with their original label and the other tone", () => {
        const html = render("## 1.0.0\n\n### Chores\n\n- tidy up");

        expect(html).toContain("rr-changelog-tone--other");
        expect(html).toContain(">Chores</span>");
    });

    it("renders scope chips", () => {
        const html = render("## 1.0.0\n\n### Features\n\n- rebrand: restarted the project");

        expect(html).toContain('<span class="rr-changelog-scope">rebrand</span>');
        expect(html).toContain("restarted the project");
    });

    it("sanitizes unsafe link schemes", () => {
        const html = render("## 1.0.0\n\nSee [x](javascript:alert(1)).");

        expect(html).toContain('<a href="#" target="_blank" rel="noreferrer">x</a>');
        expect(html).not.toContain("javascript:");
    });

    it("rejects backslash path bypasses", () => {
        const html = render("## 1.0.0\n\nSee [x](/\\evil.com).");

        expect(html).toContain('<a href="#" target="_blank" rel="noreferrer">x</a>');
        expect(html).not.toContain("evil.com");
    });

    it("escapes link href ampersands exactly once", () => {
        const html = render("## 1.0.0\n\nSee [x](https://example.com/?a=1&b=2).");

        expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
        expect(html).not.toContain("&amp;amp;");
    });

    it("keeps ADR and docs references as plain text", () => {
        const html = render("## 1.0.0\n\nSee [ADR 0001](docs/adr/0001.md) and [docs](https://example.com/docs/x).");

        expect(html).not.toContain("<a ");
        expect(html).toContain("ADR 0001");
        expect(html).toContain("docs");
    });

    it("escapes HTML before rendering inline markup", () => {
        const html = render("## 1.0.0\n\n<script>alert(1)</script> & more");

        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more");
    });

    it("renders inline code and bold", () => {
        const html = render("## 1.0.0\n\nUse `npm` and **now**.");

        expect(html).toContain("<code>npm</code>");
        expect(html).toContain("<strong>now</strong>");
    });

    it("falls back to preamble plus loose items when no release heading exists", () => {
        const html = render("Intro\n\n- item");

        expect(html).not.toContain("rr-changelog-release");
        expect(html).toContain('<p class="rr-changelog-p rr-changelog-lead">Intro</p>');
        expect(html).toContain("<li>item</li>");
    });

    it("returns an empty string for empty input", () => {
        expect(render("")).toBe("");
    });

    it("localizes labels and dates for German", () => {
        const html = render("## 1.0.0 (2026-10-26)\n\n### Bug Fixes\n\n- fixed", "de", DE_LABELS);

        expect(html).toContain(">Aktuell</span>");
        expect(html).toContain('<time class="rr-changelog-date" datetime="2026-10-26">26. Okt. 2026</time>');
        expect(html).toContain("Bugfixes");
    });
});
