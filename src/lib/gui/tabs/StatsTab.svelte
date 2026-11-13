<script lang="ts">
    /**
     * StatsTab — insight layout (hero + donut, field-style last card).
     *
     * - Hero: total redirects, site/active-rule facts, applied-hits donut.
     * - Last card: Rules-tab field surface with URI-toned URL spans.
     * - Top rules (max 6 active) and site groups share one grid row.
     * - Accordion folds every configured group; it starts fully closed.
     * - Data comes from the sink/poll block below; rendering is pure (stats-view).
     */
    import { onDestroy, untrack } from "svelte";
    import { resolveLocale, t, tPlural } from "../i18n.svelte";
    import { store } from "../../stores/settings.svelte";
    import { getStatsSink, normalizeStats, type Stats } from "../../core/stats";
    import { STORAGE_KEY_STATS, storageGet } from "../../core/storage";
    import { splitUrlComponents, type PreviewSpan } from "../../core/preview";
    import { buildStatsView, formatStatsTimestamp } from "../stats-view";
    import Icon from "../components/Icon.svelte";
    import PreviewSpans from "../components/PreviewSpans.svelte";

    interface Props {
        /** Switches to the Settings tab (performance-mode control hand-off). */
        onsettings: () => void;
        /** Whether the Stats tab is visible — the fallback poll runs only while true. */
        active: boolean;
    }

    let { onsettings, active }: Props = $props();

    function storageGetSafe(): unknown {
        return storageGet<unknown>(STORAGE_KEY_STATS, null);
    }

    const sink = getStatsSink();
    let stats = $state<Stats>(sink.snapshot());

    const unsubscribe = sink.subscribe((next) => {
        stats = next;
    });

    if (typeof GM_addValueChangeListener === "function") {
        GM_addValueChangeListener(STORAGE_KEY_STATS, (_name, _oldValue, newValue, remote) => {
            if (!remote) return;
            stats = normalizeStats(newValue);
        });
    }

    // * Fallback for environments where value-change events do not fire between
    //   userscript contexts (or are delivered late): keep reading the GM key.
    // * ! App keeps the panel MOUNTED (inert) after the first visit, so the poll
    //   must stop when the tab is not active. `stats` is read UNTRACKED — a plain
    //   read would make every stats update restart the interval. The immediate
    //   refresh avoids showing stale counters for the first second.
    $effect(() => {
        if (!active) return;
        const refresh = () => {
            const next = normalizeStats(storageGetSafe());
            if (JSON.stringify(next) !== JSON.stringify(untrack(() => stats))) stats = next;
        };
        refresh();
        const poll = window.setInterval(refresh, 1000);
        return () => window.clearInterval(poll);
    });

    onDestroy(() => {
        unsubscribe();
    });

    const locale = $derived(resolveLocale(store.settings.locale));
    const view = $derived(buildStatsView(store.settings.rules, stats, locale));
    const totalRules = $derived(store.settings.rules.reduce((sum, site) => sum + site.rules.length, 0));
    const topRows = $derived(view.topRules.slice(0, 6));
    const hits = $derived(view.appliedTotal);
    const largestSite = $derived(view.perSite.at(0));
    const fmtInt = $derived(new Intl.NumberFormat(locale));
    const fmtPct = $derived(new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }));
    const lastTimestamp = $derived(
        stats.last && Number.isFinite(stats.last.ts) ? formatStatsTimestamp(stats.last.ts, locale) : "",
    );
    const lastIso = $derived(stats.last ? safeIso(stats.last.ts) : "");
    const replaceShare = $derived(view.byKind.find((row) => row.kind === "replace")?.share ?? 0);
    const appendShare = $derived(view.byKind.find((row) => row.kind === "appendQuery")?.share ?? 0);
    const removeShare = $derived(view.byKind.find((row) => row.kind === "removeQuery")?.share ?? 0);
    const avgPerRule = $derived(Math.round(hits / Math.max(1, totalRules)));
    const donutAria = $derived(
        `${t("system.stats.distribution")}: ${view.byKind
            .map((row) => `${kindLabel(row.kind)} ${fmtPct.format(row.share / 100)}`)
            .join(", ")}`,
    );

    /** ISO timestamp for the `<time datetime>` attribute — out-of-range safe. */
    function safeIso(ts: number): string {
        if (!Number.isFinite(ts) || Math.abs(ts) > 8.64e15) return "";
        try {
            return new Date(ts).toISOString();
        } catch {
            return "";
        }
    }

    function kindLabel(kind: string): string {
        if (kind === "replace") return t("stats.kind.replace");
        if (kind === "appendQuery") return t("stats.kind.appendQuery");
        if (kind === "removeQuery") return t("stats.kind.removeQuery");
        if (kind === "unwrap") return t("stats.kind.unwrap");
        return t("stats.kind.checkpoint");
    }

    function urlSpans(url: string): PreviewSpan[] {
        return splitUrlComponents(url).map((segment) => ({
            text: segment.text,
            component: segment.component,
            diff: null,
        }));
    }

    const barWidth = (count: number, max: number): number => Math.round((count / Math.max(1, max)) * 100);
</script>

<div class="rr-tab-root rr-tab-root--lane">
    <div class="rr-info-body rr-centered-root">
        {#if store.settings.performanceMode}
            <section class="rr-stats-performance-banner" aria-labelledby="rr-stats-performance-title">
                <Icon name="bolt" class="rr-stats-performance-icon" />
                <div class="rr-stats-performance-copy">
                    <h3 id="rr-stats-performance-title" class="rr-stats-performance-title">
                        {t("system.stats.performance.title")}
                    </h3>
                    <p class="rr-stats-performance-body">{t("system.stats.performance.body")}</p>
                </div>
                <button class="rr-stats-performance-link" type="button" onclick={onsettings}>
                    {t("system.stats.performance.openSettings")}
                </button>
            </section>
        {/if}

        <section class="rr-hero rr-stats-hero rr-stats-hero--insight" aria-labelledby="rr-stats-hero-title">
            <div class="rr-stats-hero-copy">
                <h3 id="rr-stats-hero-title" class="rr-stats-hero-label">{t("system.stats.total")}</h3>
                <p class="rr-stats-hero-total">{fmtInt.format(stats.total)}</p>
                <div class="rr-stats-facts">
                    <span class="rr-stats-fact">
                        {t("system.stats.sites")}
                        <strong>{fmtInt.format(view.perSite.length)}</strong>
                    </span>
                    <span class="rr-stats-fact">
                        {t("system.stats.activeRules")}
                        <strong>{fmtInt.format(view.activeRules)}/{fmtInt.format(totalRules)}</strong>
                    </span>
                </div>
            </div>
            <div class="rr-stats-donut-block">
                <div
                    class="rr-stats-donut"
                    class:is-empty={hits === 0}
                    style="--rr-share-replace:{replaceShare}%;--rr-share-append:{appendShare}%;--rr-share-remove:{removeShare}%"
                    role="img"
                    aria-label={donutAria}
                >
                    <span class="rr-stats-donut-center">
                        <strong>{fmtInt.format(hits)}</strong>
                        <span>{t("system.stats.hits")}</span>
                    </span>
                </div>
                <ul class="rr-stats-donut-legend">
                    {#each view.byKind as row (row.kind)}
                        <li>
                            <span class="rr-stats-donut-dot rr-stats-donut-dot--{row.kind}" aria-hidden="true"></span>
                            <span>{kindLabel(row.kind)}</span>
                            <strong>{fmtInt.format(row.count)}</strong>
                            <span class="rr-stats-donut-share">{fmtPct.format(row.share / 100)}</span>
                        </li>
                    {/each}
                </ul>
            </div>
        </section>

        <section class="rr-card rr-stats-last-card" aria-labelledby="rr-stats-last-title">
            <header class="rr-card-head">
                <Icon name="timer" class="rr-card-icon" />
                <h3 id="rr-stats-last-title" class="rr-card-title">{t("system.stats.last")}</h3>
                {#if lastTimestamp}
                    <time class="rr-stats-last-time" datetime={lastIso} title={lastIso}>{lastTimestamp}</time>
                {/if}
            </header>
            <div class="rr-card-body">
                {#if stats.last}
                    <dl class="rr-preview-grid rr-stats-last-fields">
                        <dt class="rr-preview-panel-title">{t("stats.last.from")}</dt>
                        <dd>
                            <div class="rr-preview-panel" role="presentation">
                                <p class="rr-preview-text"><PreviewSpans spans={urlSpans(stats.last.from)} /></p>
                            </div>
                        </dd>
                        <dt class="rr-preview-panel-title">{t("stats.last.to")}</dt>
                        <dd>
                            <div class="rr-preview-panel" role="presentation">
                                <p class="rr-preview-text"><PreviewSpans spans={urlSpans(stats.last.to)} /></p>
                            </div>
                        </dd>
                    </dl>
                {:else}
                    <p class="rr-stats-empty">{t("system.stats.never")}</p>
                {/if}
            </div>
        </section>

        <div class="rr-stats-cards">
            <section class="rr-card rr-stats-card--fill" aria-labelledby="rr-stats-top-title">
                <header class="rr-card-head">
                    <Icon name="queryStats" class="rr-card-icon" />
                    <h3 id="rr-stats-top-title" class="rr-card-title">{t("system.stats.topRules")}</h3>
                    {#if topRows.length > 0}
                        <span class="rr-count-chip">{t("system.stats.top", { count: topRows.length })}</span>
                    {/if}
                </header>
                <div class="rr-card-body" class:is-empty={topRows.length === 0}>
                    {#if topRows.length === 0}
                        <p class="rr-stats-empty">{t("system.stats.topEmpty")}</p>
                    {:else}
                        <div class="rr-stats-top-list">
                            {#each topRows as row, index (row.id)}
                                <div
                                    class="rr-stats-top-row rr-stats-top-row--{row.kind}"
                                    style="--rr-fill:{barWidth(row.count, view.maxRule)}%"
                                >
                                    <span class="rr-stats-pos rr-stats-top-pos">{index + 1}</span>
                                    <div class="rr-stats-top-main">
                                        <span class="rr-stats-top-name" title={row.raw}>{row.name}</span>
                                        <span class="rr-stats-top-sub">
                                            <span class="rr-chip rr-chip-{row.kind.toLowerCase()}">
                                                {t(`rules.kindShort.${row.kind}`)}
                                            </span>
                                            <span class="rr-stats-top-site" title={row.siteRaw}>{row.siteLabel}</span>
                                            <span class="rr-stats-top-share">{fmtPct.format(row.share / 100)}</span>
                                        </span>
                                    </div>
                                    <span class="rr-stats-top-count">{fmtInt.format(row.count)}</span>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            </section>

            <section class="rr-card rr-stats-card--fill" aria-labelledby="rr-stats-sites-title">
                <header class="rr-card-head">
                    <Icon name="travelExplore" class="rr-card-icon" />
                    <h3 id="rr-stats-sites-title" class="rr-card-title">{t("system.stats.groups")}</h3>
                    <span class="rr-count-chip">{fmtInt.format(view.perSite.length)}</span>
                </header>
                <div class="rr-card-body">
                    {#if view.perSite.length === 0}
                        <p class="rr-stats-empty">{t("stats.empty.groups")}</p>
                    {:else}
                        <div class="rr-stats-bars">
                            {#each view.perSite as row (row.id)}
                                <div class="rr-stats-bar-row" class:is-empty={row.count === 0}>
                                    <span class="rr-stats-bar-label" title={row.raw}>
                                        <span class="rr-stats-bar-name">{row.label}</span>
                                        <span class="rr-stats-bar-meta">
                                            {tPlural("rules.count.site", row.ruleCount)}
                                        </span>
                                    </span>
                                    <div class="rr-stats-bar-track" aria-hidden="true">
                                        <div
                                            class="rr-stats-bar-fill rr-stats-bar-fill--site"
                                            style="width:{barWidth(row.count, view.maxSite)}%"
                                        ></div>
                                    </div>
                                    <span class="rr-stats-bar-count">{fmtInt.format(row.count)}</span>
                                </div>
                            {/each}
                        </div>
                        {#if largestSite}
                            <div class="rr-stats-card-foot">
                                <div class="rr-stats-foot-cell">
                                    <span class="rr-stats-foot-label">{t("system.stats.largestGroup")}</span>
                                    <span class="rr-stats-foot-value" title={largestSite.raw}>{largestSite.label}</span>
                                    <span class="rr-stats-foot-sub">
                                        {fmtInt.format(largestSite.count)} ·
                                        {fmtPct.format(largestSite.share / 100)}
                                    </span>
                                </div>
                                <div class="rr-stats-foot-cell">
                                    <span class="rr-stats-foot-label">{t("system.stats.avgPerRule")}</span>
                                    <span class="rr-stats-foot-value">{fmtInt.format(avgPerRule)}</span>
                                    <span class="rr-stats-foot-sub">
                                        {fmtInt.format(hits)} / {fmtInt.format(totalRules)}
                                    </span>
                                </div>
                                <div class="rr-stats-foot-cell">
                                    <span class="rr-stats-foot-label">{t("system.stats.noHits")}</span>
                                    <span class="rr-stats-foot-value">{fmtInt.format(view.zeroRules)}</span>
                                    <span class="rr-stats-foot-sub">
                                        {t("system.stats.ofRules", { count: view.zeroRules, total: totalRules })}
                                    </span>
                                </div>
                            </div>
                        {/if}
                    {/if}
                </div>
            </section>
        </div>

        <section class="rr-card" aria-labelledby="rr-stats-per-group-title">
            <header class="rr-card-head">
                <Icon name="queryStats" class="rr-card-icon" />
                <h3 id="rr-stats-per-group-title" class="rr-card-title">{t("system.stats.perGroup")}</h3>
                <span class="rr-count-chip">{fmtInt.format(view.ruleGroups.length)}</span>
            </header>
            <div class="rr-card-body">
                {#if view.ruleGroups.length === 0}
                    <p class="rr-stats-empty">{t("stats.empty.rules")}</p>
                {:else}
                    <div class="rr-stats-accordion">
                        {#each view.ruleGroups as group (group.id)}
                            <details class="rr-stats-acc" class:is-empty={group.count === 0}>
                                <summary>
                                    <span class="rr-stats-acc-chevron" aria-hidden="true"></span>
                                    <span class="rr-stats-acc-name" title={group.raw}>{group.label}</span>
                                    <span class="rr-stats-acc-meta">{tPlural("rules.count.site", group.ruleCount)}</span
                                    >
                                    <span class="rr-stats-acc-count">{fmtInt.format(group.count)}</span>
                                </summary>
                                <div class="rr-stats-acc-body">
                                    {#each group.rules as row (row.id)}
                                        <div class="rr-stats-bar-row" class:is-empty={row.count === 0}>
                                            <span class="rr-stats-bar-label">
                                                <span class="rr-stats-bar-line">
                                                    <span class="rr-stats-pos">{row.position}</span>
                                                    <span class="rr-chip rr-chip-{row.kind.toLowerCase()}">
                                                        {t(`rules.kindShort.${row.kind}`)}
                                                    </span>
                                                    <span class="rr-stats-bar-name" title={row.raw}>{row.name}</span>
                                                </span>
                                                {#if row.kind === "appendQuery" && row.gate}
                                                    <span class="rr-stats-bar-meta" title={row.gate}>{row.gate}</span>
                                                {:else if row.mode}
                                                    <span class="rr-stats-bar-meta">{t(`rules.mode.${row.mode}`)}</span>
                                                {/if}
                                            </span>
                                            <div class="rr-stats-bar-track" aria-hidden="true">
                                                <div
                                                    class="rr-stats-bar-fill rr-stats-bar-fill--{row.kind}"
                                                    style="width:{barWidth(row.count, view.maxRule)}%"
                                                ></div>
                                            </div>
                                            <span class="rr-stats-bar-count">{fmtInt.format(row.count)}</span>
                                        </div>
                                    {/each}
                                </div>
                            </details>
                        {/each}
                    </div>
                {/if}
            </div>
        </section>
    </div>
</div>
