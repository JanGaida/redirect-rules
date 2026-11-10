/**
 * stats-view — pure derivations for the Stats tab.
 *
 * - Rows come from settings + counters; orphan counter hashes are ignored.
 * - All configured rules/sites stay visible (zero rows are dimmed by CSS).
 * - `ruleGroups` feed the accordion; `topRules` feed the ranked top list.
 * - Readable labels for display; raw rule/gate text only in tooltips.
 * - `stats.total` counts redirects; `appliedTotal` counts applied rule hits.
 *   A chain can apply several rules per redirect, so `appliedTotal` may exceed
 *   `stats.total`.
 */
import { ruleHash, type Stats } from "../core/stats";
import { regexToReadableLiteral } from "../core/parse-regex";
import type { SiteRule, UrlRule } from "../core/settings";
import type { Locale } from "../core/locale";
import { siteCaption } from "./site-caption";

export interface StatsRuleRow {
    id: string;
    /** 1-based chain position inside the group (Rules-tab parity). */
    position: number;
    /** Readable one-line rule label — the primary text of the row. */
    name: string;
    /** Raw rule summary — tooltip only. */
    raw: string;
    /** appendQuery gate in readable form; "" for other kinds / no gate. */
    gate: string;
    /** Checkpoint mode — undefined for other kinds. */
    mode?: "continue" | "stop";
    kind: UrlRule["kind"];
    count: number;
}

export interface StatsSiteGroup {
    id: string;
    /** Description-first site label (`siteCaption`). */
    label: string;
    /** Raw site gate — tooltip only. */
    raw: string;
    count: number;
    ruleCount: number;
    /** Source order — the chain order, never sorted. */
    rules: StatsRuleRow[];
}

export interface StatsSiteRow {
    id: string;
    label: string;
    raw: string;
    count: number;
    ruleCount: number;
    /** Share of all applied rule counts in percent. */
    share: number;
}

export interface StatsTopRule extends StatsRuleRow {
    siteId: string;
    siteLabel: string;
    siteRaw: string;
    /** Share of all applied rule counts in percent. */
    share: number;
}

export interface StatsKindRow {
    kind: UrlRule["kind"];
    count: number;
    /** Share of all applied rule counts in percent (0 when there are none). */
    share: number;
}

export interface StatsView {
    ruleGroups: StatsSiteGroup[];
    perSite: StatsSiteRow[];
    /** Active rules only (count > 0), full ranking — the component slices it. */
    topRules: StatsTopRule[];
    /** Exactly 4 rows in fixed `KIND_ORDER`, including zero-count kinds. */
    byKind: StatsKindRow[];
    /** Sum of every applied-rule counter (may exceed `stats.total`). */
    appliedTotal: number;
    /** Rules with count > 0. */
    activeRules: number;
    /** Configured rules minus active rules. */
    zeroRules: number;
    maxRule: number;
    maxSite: number;
    maxKind: number;
}

/** Fixed donut/legend order — never derived from counts. */
const KIND_ORDER = ["replace", "appendQuery", "removeQuery", "checkpoint"] as const;

function percentage(count: number, total: number): number {
    return total > 0 ? (count / total) * 100 : 0;
}

function readableRegex(regex: string): string {
    return regex ? regexToReadableLiteral(regex) : "";
}

/** Readable one-line description of a rule for the per-rule card. */
export function ruleSummary(rule: UrlRule): string {
    if (rule.kind === "replace") return `${readableRegex(rule.regex) || "—"} → ${rule.substitution || "—"}`;
    if (rule.kind === "appendQuery") return rule.params || "—";
    if (rule.kind === "removeQuery") return rule.keys || "—";
    return readableRegex(rule.regex) || "—";
}

/** Raw one-line rule text — tooltip only, never the visible label. */
export function ruleRawSummary(rule: UrlRule): string {
    if (rule.kind === "replace") return `${rule.regex || "—"} → ${rule.substitution || "—"}`;
    if (rule.kind === "appendQuery") return `${rule.params || "—"}${rule.regex ? ` (${rule.regex})` : ""}`;
    if (rule.kind === "removeQuery") return `${rule.keys || "—"}${rule.regex ? ` (${rule.regex})` : ""}`;
    return `${rule.regex || "—"} (${rule.mode})`;
}

function sortRows<T extends { count: number; label: string; id: string }>(rows: T[], locale: Locale): T[] {
    return rows.sort((a, b) => {
        if (a.count !== b.count) return b.count - a.count;
        const byLabel = a.label.localeCompare(b.label, locale);
        if (byLabel !== 0) return byLabel;
        return Number(a.id) - Number(b.id);
    });
}

/** Deterministic top-rules ranking: count, name, site, source id, position. */
function compareTopRules(a: StatsTopRule, b: StatsTopRule, locale: Locale): number {
    if (a.count !== b.count) return b.count - a.count;
    const byName = a.name.localeCompare(b.name, locale);
    if (byName !== 0) return byName;
    const bySite = a.siteLabel.localeCompare(b.siteLabel, locale);
    if (bySite !== 0) return bySite;
    const byId = Number(a.siteId) - Number(b.siteId);
    if (byId !== 0) return byId;
    return a.position - b.position;
}

/**
 * Builds the insight collections from the live settings and counters.
 *
 * @param groups - Current site rules (`store.settings.rules`).
 * @param stats  - The persisted stats snapshot.
 * @param locale - Resolved locale for deterministic label ordering.
 */
export function buildStatsView(groups: SiteRule[], stats: Stats, locale: Locale): StatsView {
    const ruleGroups: StatsSiteGroup[] = [];
    const perSite: StatsSiteRow[] = [];
    const perKind = new Map<UrlRule["kind"], number>();
    let appliedTotal = 0;
    let configuredRules = 0;

    groups.forEach((site, siteIndex) => {
        const label = siteCaption(site);
        const raw = site.siteRegex || "—";
        const rows: StatsRuleRow[] = [];
        let siteCount = 0;

        site.rules.forEach((rule, ruleIndex) => {
            const count = stats.counts[ruleHash(site.siteRegex, rule)] ?? 0;
            siteCount += count;
            appliedTotal += count;
            perKind.set(rule.kind, (perKind.get(rule.kind) ?? 0) + count);
            rows.push({
                id: `${siteIndex}:${ruleIndex}`,
                position: ruleIndex + 1,
                name: ruleSummary(rule),
                raw: ruleRawSummary(rule),
                gate: rule.kind === "appendQuery" || rule.kind === "removeQuery" ? readableRegex(rule.regex ?? "") : "",
                ...(rule.kind === "checkpoint" ? { mode: rule.mode } : {}),
                kind: rule.kind,
                count,
            });
        });

        configuredRules += site.rules.length;
        ruleGroups.push({
            id: String(siteIndex),
            label,
            raw,
            count: siteCount,
            ruleCount: site.rules.length,
            rules: rows,
        });
        perSite.push({
            id: String(siteIndex),
            label,
            raw,
            count: siteCount,
            ruleCount: site.rules.length,
            share: 0,
        });
    });

    // * appliedTotal is final here — backfill the site shares once.
    for (const row of perSite) row.share = percentage(row.count, appliedTotal);

    const byKind: StatsKindRow[] = KIND_ORDER.map((kind) => {
        const count = perKind.get(kind) ?? 0;
        return { kind, count, share: percentage(count, appliedTotal) };
    });

    sortRows(ruleGroups, locale);
    sortRows(perSite, locale);

    const topRules: StatsTopRule[] = ruleGroups
        .flatMap((group) =>
            group.rules.map((row) => ({
                ...row,
                siteId: group.id,
                siteLabel: group.label,
                siteRaw: group.raw,
                share: percentage(row.count, appliedTotal),
            })),
        )
        .filter((row) => row.count > 0)
        .sort((a, b) => compareTopRules(a, b, locale));

    const maxRule = Math.max(1, ...ruleGroups.flatMap((group) => group.rules.map((row) => row.count)));

    return {
        ruleGroups,
        perSite,
        topRules,
        byKind,
        appliedTotal,
        activeRules: topRules.length,
        zeroRules: configuredRules - topRules.length,
        maxRule,
        maxSite: Math.max(1, ...perSite.map((row) => row.count)),
        maxKind: Math.max(1, ...byKind.map((row) => row.count)),
    };
}

/**
 * Formats the last-redirect epoch for the hero. Fail-soft: a non-finite value
 * renders the em-dash placeholder instead of throwing.
 */
export function formatStatsTimestamp(ts: number, locale: Locale): string {
    if (!Number.isFinite(ts)) return "—";
    try {
        return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ts));
    } catch {
        return "—";
    }
}
