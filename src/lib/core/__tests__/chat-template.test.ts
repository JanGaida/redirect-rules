import { describe, expect, it } from "vitest";
import { renderChatTemplate, renderChatErrorTemplate } from "../chat-template";
import type { SiteRule } from "../settings";

const SITE: SiteRule = {
    siteRegex: "example\\.de",
    description: "Docs",
    previewEntries: [{ url: "https://example.de/alt", testOutputUri: "https://example.de/neu" }],
    rules: [
        {
            kind: "replace",
            regex: "/^https:\\/\\/example\\.de\\/alte-seite\\/(.*)$/",
            substitution: "https://example.de/neu/$1",
        },
        { kind: "appendQuery", params: "ref=rr&log=1" },
        { kind: "removeQuery", keys: "utm_*" },
    ],
};

describe("renderChatTemplate", () => {
    it("dumps the full selected group setting as JSON (de)", () => {
        const out = renderChatTemplate(SITE, "de");
        expect(out).toContain("Redirect Rules");
        expect(out).toContain("## Ziel-Gruppe (optional)");
        expect(out).toContain("```json");
        expect(out).toContain('"siteRegex": "example\\\\.de"');
        expect(out).toContain('"description": "Docs"');
        expect(out).toContain('"previewEntries"');
        expect(out).toContain('"kind": "replace"');
        expect(out).toContain('"kind": "appendQuery"');
        expect(out).toContain('"kind": "removeQuery"');
        expect(out).toContain("| `removeQuery` |");
        expect(out).toContain("| `unwrap` |");
        expect(out).toContain("Meine Wünsche");
    });

    it("asks the LLM for the target site and page url when no group is selected", () => {
        const out = renderChatTemplate(undefined, "de");
        expect(out).toContain("## Ziel-Gruppe (optional)");
        expect(out).toContain("(keine — frag im Chat nach der Zielseite.)");
        expect(out).toContain("höchstens zwei kurze Rückfragen");
        expect(out).toContain("Seiten-URL");
        expect(out).not.toContain("```json");
    });

    it("does not carry a page url or starting-rule block anymore", () => {
        const out = renderChatTemplate(SITE, "de");
        expect(out).not.toContain("aktuelle Seite");
        expect(out).not.toContain("Startregel");
        expect(out).not.toContain("{pageUrl}");
        expect(out).not.toContain("{existingContext}");
    });

    it("switches to the English body for locale en", () => {
        const out = renderChatTemplate(SITE, "en");
        expect(out).toContain("## Target group (optional)");
        expect(out).toContain("My wishes");
        expect(out).toContain('"siteRegex": "example\\\\.de"');
    });

    it("tells the LLM to add only new rules for a provided group", () => {
        const out = renderChatTemplate(SITE, "en");
        expect(out).toContain("return ONLY the rules to ADD");
        expect(out).toContain("Do NOT add rules or test cases that already exist");
    });

    it("documents every rule kind in the shared contract table", () => {
        for (const locale of ["de", "en"] as const) {
            const out = renderChatTemplate(SITE, locale);
            for (const kind of ["replace", "appendQuery", "removeQuery", "checkpoint", "unwrap"]) {
                expect(out).toContain(`| \`${kind}\` |`);
            }
        }
    });

    it("asks for one verification entry per rule kind with a no-example fallback (de)", () => {
        const out = renderChatTemplate(SITE, "de");
        expect(out).toContain("## Testfälle (Pflicht)");
        expect(out).toContain("JEDEN Regel-Typ");
        expect(out).toContain("genau einen `previewEntries`-Eintrag");
        expect(out).toContain('"previewEntries"');
        expect(out).toContain('"description": "replace"');
        expect(out).toContain(
            "Es gibt keine exakte Beispiel-URL, anhand derer sich das gewünschte Verhalten überprüfen ließe.",
        );
    });

    it("mirrors the verification contract in the English body", () => {
        const out = renderChatTemplate(SITE, "en");
        expect(out).toContain("## Test cases (required)");
        expect(out).toContain("EVERY rule kind");
        expect(out).toContain("exactly one `previewEntries` entry");
        expect(out).toContain('"previewEntries"');
        expect(out).toContain("There is no exact example URL against which the desired behavior could be verified.");
    });

    it("carries a canonical example marked as form-only", () => {
        const de = renderChatTemplate(SITE, "de");
        expect(de).toContain("GENAU EINEM JSON-Objekt");
        expect(de).toContain("https://example.com/old/seite");
        expect(de).toContain("übernimm NIE seine URLs");

        const en = renderChatTemplate(SITE, "en");
        expect(en).toContain("EXACTLY ONE JSON object");
        expect(en).toContain("https://example.com/old/seite");
        expect(en).toContain("NEVER reuse its URLs");
    });

    it("resolves the shared contract include in every template", () => {
        for (const locale of ["de", "en"] as const) {
            expect(renderChatTemplate(SITE, locale)).not.toContain("{{include:");
            expect(renderChatTemplate(undefined, locale)).not.toContain("{{include:");
            expect(renderChatErrorTemplate("{}", "bad", locale)).not.toContain("{{include:");
        }
    });

    it("keeps $-tokens in the group dump verbatim (no replaceAll interpretation)", () => {
        const dollar: SiteRule = {
            siteRegex: "example.de",
            rules: [{ kind: "replace", regex: "/a/", substitution: "[$&][$1][$$]" }],
        };
        const out = renderChatTemplate(dollar, "de");
        expect(out).toContain('"substitution": "[$&][$1][$$]"');
    });
});

describe("renderChatErrorTemplate", () => {
    it("names the allowed JSON shapes and keeps the original input", () => {
        const out = renderChatErrorTemplate("{not json", "Unexpected token", "en");
        expect(out).toContain("{not json");
        expect(out).toContain("Unexpected token");
        expect(out).toContain('"siteRegex"');
        expect(out).toContain('"rules"');
        expect(out).toContain('"previewEntries"');
    });

    it("shares the rule model and the no-example sentence", () => {
        const de = renderChatErrorTemplate("{not json", "Unexpected token", "de");
        expect(de).toContain("## Regel-Modell");
        expect(de).toContain("| `checkpoint` |");
        expect(de).toContain(
            "Es gibt keine exakte Beispiel-URL, anhand derer sich das gewünschte Verhalten überprüfen ließe.",
        );

        const en = renderChatErrorTemplate("{not json", "Unexpected token", "en");
        expect(en).toContain("## Rule model");
        expect(en).toContain("| `checkpoint` |");
        expect(en).toContain("There is no exact example URL against which the desired behavior could be verified.");
    });

    it("keeps $-tokens in the input verbatim", () => {
        const out = renderChatErrorTemplate('{"substitution":"$&"}', "bad", "de");
        expect(out).toContain('{"substitution":"$&"}');
    });
});
