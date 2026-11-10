/**
 * Changelog model + renderer — sanitized HTML for the embedded CHANGELOG.md payload.
 *
 * - `parseChangelog`: markdown subset -> preamble, releases, groups, loose items.
 * - `renderChangelog`: locale-aware release cards; all folded until the user opens one.
 * - Inline: escape first, then code/bold/links; ADR/docs links stay plain text.
 * - Unknown release-please sections stay visible under their original label.
 */

import { icons, type IconName } from "./icon";

export type ChangelogType = "feat" | "fix" | "perf" | "revert" | "docs" | "other";

export interface ChangelogItem {
    scope: string | null;
    html: string;
}

export interface ChangelogGroup {
    type: ChangelogType;
    label: string | null;
    items: ChangelogItem[];
}

export interface ChangelogRelease {
    version: string;
    date: string | null;
    paragraphs: string[];
    looseItems: string[];
    groups: ChangelogGroup[];
}

export interface ChangelogModel {
    preamble: string[];
    releases: ChangelogRelease[];
    looseItems: string[];
}

export interface ChangelogLabels {
    current: string;
    types: Record<Exclude<ChangelogType, "other">, string>;
}

/** release-please section titles -> known type; anything else becomes `other`. */
const SECTION_TYPES: Readonly<Record<string, ChangelogType>> = {
    features: "feat",
    "bug fixes": "fix",
    "performance improvements": "perf",
    reverts: "revert",
    documentation: "docs",
};

/** Stable order for header counters (independent of document order). */
const COUNT_ORDER: readonly ChangelogType[] = ["feat", "fix", "perf", "revert", "docs", "other"];

const TYPE_ICONS: Readonly<Record<ChangelogType, IconName>> = {
    feat: "add",
    fix: "bugReport",
    perf: "bolt",
    revert: "undo",
    docs: "developerGuide",
    other: "info",
};

/** `token:` prefixes that are URL/protocol schemes, never release scopes. */
const SCOPE_SCHEMES = new Set(["http", "https", "mailto", "ftp", "javascript", "data"]);

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function safeUrl(url: string): string {
    // * Backslashes are another off-origin bypass (`/\evil.com`) — reject any.
    if (url.includes("\\")) return "#";
    if (/^https?:\/\//i.test(url)) return url;
    // * Reject protocol-relative `//host`: it would escape to an external origin.
    if (url.startsWith("//")) return "#";
    // * A single leading slash stays same-origin; `./` and `#` are safe.
    if (/^[./#]/.test(url)) return url;
    return "#";
}

function inlineMarkdown(value: string): string {
    return value
        .replace(/`([^`]+)`/g, (_, code: string) => `<code>${code}</code>`)
        .replace(/\*\*([^*]+)\*\*/g, (_, bold: string) => `<strong>${bold}</strong>`)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text: string, url: string) => {
            // * ADR / doc references stay plain text — no deep links.
            if (/\badr\b|docs\//i.test(url)) return text;
            const safe = safeUrl(url.trim());
            // * Callers escape HTML first — the URL is attribute-safe exactly once.
            return `<a href="${safe}" target="_blank" rel="noreferrer">${text}</a>`;
        });
}

/** Splits an optional leading `scope: ` / `**scope:** ` token from a bullet. */
function splitScope(value: string): { scope: string | null; text: string } {
    const bold = value.match(/^\*\*([A-Za-z0-9][\w.-]{0,31}):\*\*\s+(.+)$/);
    const plain = value.match(/^([A-Za-z0-9][\w.-]{0,31}):\s+(.+)$/);
    const match = bold ?? plain;
    if (!match) return { scope: null, text: value };
    const token = match[1];
    if (SCOPE_SCHEMES.has(token.toLowerCase())) return { scope: null, text: value };
    if (match[2].startsWith("//")) return { scope: null, text: value };
    return { scope: token, text: match[2] };
}

function paragraph(markdown: string, lead = false): string {
    const cls = lead ? "rr-changelog-p rr-changelog-lead" : "rr-changelog-p";
    return `<p class="${cls}">${inlineMarkdown(escapeHtml(markdown))}</p>`;
}

function looseList(items: readonly string[]): string {
    if (items.length === 0) return "";
    const entries = items.map((item) => `<li>${inlineMarkdown(escapeHtml(item))}</li>`).join("");
    return `<ul class="rr-changelog-list">${entries}</ul>`;
}

/**
 * Parses the embedded markdown into a locale-free model.
 *
 * @param markdown - Raw CHANGELOG.md text.
 */
export function parseChangelog(markdown: string): ChangelogModel {
    const model: ChangelogModel = { preamble: [], releases: [], looseItems: [] };
    let release: ChangelogRelease | null = null;
    let group: ChangelogGroup | null = null;
    let paragraphBuffer: string[] = [];

    const flushParagraph = (): void => {
        if (paragraphBuffer.length === 0) return;
        const text = paragraphBuffer.join(" ");
        paragraphBuffer = [];
        if (release === null) model.preamble.push(text);
        else release.paragraphs.push(text);
    };

    const finishGroup = (): void => {
        if (release !== null && group !== null && group.items.length === 0) {
            const index = release.groups.indexOf(group);
            if (index >= 0) release.groups.splice(index, 1);
        }
        group = null;
    };

    for (const raw of markdown.split(/\r?\n/)) {
        const line = raw.trim();
        if (line === "") {
            flushParagraph();
            continue;
        }

        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
            const level = heading[1].length;
            const title = heading[2].trim();
            flushParagraph();

            if (level === 1) {
                if (title.toLowerCase() === "changelog") continue;
                (release === null ? model.preamble : release.paragraphs).push(line);
                continue;
            }

            if (level === 2) {
                finishGroup();
                const match = title.match(/^(.+?)(?:\s+\((\d{4}-\d{2}-\d{2})\))?\s*$/);
                release = {
                    version: (match?.[1] ?? title).trim(),
                    date: match?.[2] ?? null,
                    paragraphs: [],
                    looseItems: [],
                    groups: [],
                };
                model.releases.push(release);
                continue;
            }

            if (release !== null) {
                finishGroup();
                const type = SECTION_TYPES[title.toLowerCase()] ?? "other";
                group = { type, label: type === "other" ? title : null, items: [] };
                release.groups.push(group);
                continue;
            }
        }

        const bullet = line.match(/^[-*]\s+(.+)$/);
        if (bullet) {
            flushParagraph();
            if (release === null) {
                model.looseItems.push(bullet[1]);
            } else if (group !== null) {
                const { scope, text } = splitScope(bullet[1]);
                group.items.push({ scope, html: inlineMarkdown(escapeHtml(text)) });
            } else {
                release.looseItems.push(bullet[1]);
            }
            continue;
        }

        // * A plain paragraph ends the current section; wrapped lines join with a space.
        if (paragraphBuffer.length === 0) finishGroup();
        paragraphBuffer.push(line);
    }

    flushParagraph();
    finishGroup();
    return model;
}

function formatDate(date: string, locale: string): string {
    try {
        const parsed = new Date(`${date}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime())) return date;
        return new Intl.DateTimeFormat(locale, {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
        }).format(parsed);
    } catch {
        return date;
    }
}

function groupTitle(group: ChangelogGroup, labels: ChangelogLabels): string {
    if (group.type === "other") return group.label ?? "";
    return labels.types[group.type];
}

function releaseCounts(release: ChangelogRelease): Array<{ type: ChangelogType; count: number }> {
    const totals = new Map<ChangelogType, number>();
    for (const group of release.groups) {
        totals.set(group.type, (totals.get(group.type) ?? 0) + group.items.length);
    }
    return COUNT_ORDER.filter((type) => (totals.get(type) ?? 0) > 0).map((type) => ({
        type,
        count: totals.get(type) ?? 0,
    }));
}

function renderCounts(release: ChangelogRelease, labels: ChangelogLabels): string {
    return releaseCounts(release)
        .map(({ type, count }) => {
            const label =
                type === "other"
                    ? (release.groups.find((g) => g.type === "other")?.label ?? "other")
                    : labels.types[type];
            return `<span class="rr-changelog-count" aria-label="${escapeHtml(label)}: ${count}" title="${escapeHtml(label)}: ${count}"><i class="rr-changelog-dot rr-changelog-dot--${type}" aria-hidden="true"></i>${count}</span>`;
        })
        .join("");
}

function renderGroup(group: ChangelogGroup, labels: ChangelogLabels): string {
    const title = escapeHtml(groupTitle(group, labels));
    const icon = icons[TYPE_ICONS[group.type]];
    const notes = group.items
        .map((item) => {
            const scope =
                item.scope === null ? "" : `<span class="rr-changelog-scope">${escapeHtml(item.scope)}</span>`;
            return `<li class="rr-changelog-note">${scope}${item.html}</li>`;
        })
        .join("");
    return [
        `<div class="rr-changelog-group rr-changelog-tone--${group.type}">`,
        '<div class="rr-changelog-group-head">',
        `<span class="rr-changelog-group-title"><span class="rr-icon rr-changelog-group-icon" aria-hidden="true">${icon}</span>${title}</span>`,
        `<span class="rr-changelog-group-count">${group.items.length}</span>`,
        "</div>",
        `<ul class="rr-changelog-notes">${notes}</ul>`,
        "</div>",
    ].join("");
}

function renderRelease(
    release: ChangelogRelease,
    index: number,
    options: { locale: string; labels: ChangelogLabels },
): string {
    const version = /^v/i.test(release.version) ? release.version : `v${release.version}`;
    const head = [`<span class="rr-changelog-version">${escapeHtml(version)}</span>`];
    if (release.date !== null) {
        head.push(
            `<time class="rr-changelog-date" datetime="${escapeHtml(release.date)}">${escapeHtml(formatDate(release.date, options.locale))}</time>`,
        );
    }
    if (index === 0) head.push(`<span class="rr-changelog-current">${escapeHtml(options.labels.current)}</span>`);
    head.push(
        `<span class="rr-changelog-release-side"><span class="rr-changelog-counts">${renderCounts(release, options.labels)}</span><span class="rr-changelog-chevron" aria-hidden="true"></span></span>`,
    );

    const body = [
        ...release.paragraphs.map((value) => paragraph(value)),
        ...release.groups.map((group) => renderGroup(group, options.labels)),
        looseList(release.looseItems),
    ].join("");

    const latest = index === 0 ? " is-latest" : "";
    return `<details class="rr-changelog-release${latest}"><summary class="rr-changelog-release-head">${head.join("")}</summary><div class="rr-changelog-release-body">${body}</div></details>`;
}

/**
 * Renders the parsed model to sanitized HTML release cards.
 *
 * @param model   - Result of `parseChangelog`.
 * @param options - Resolved locale plus localized labels.
 */
export function renderChangelog(model: ChangelogModel, options: { locale: string; labels: ChangelogLabels }): string {
    const out = model.preamble.map((value) => paragraph(value, true));
    if (model.releases.length === 0) {
        out.push(looseList(model.looseItems));
        return out.filter(Boolean).join("\n");
    }
    out.push(looseList(model.looseItems));
    model.releases.forEach((release, index) => out.push(renderRelease(release, index, options)));
    return out.filter(Boolean).join("\n");
}
