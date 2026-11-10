<script lang="ts">
    /**
     * InfoTab (About tab) — hero, build details, and the embedded changelog.
     *
     * - Hero: app icon, name, version badge, tagline, external CTAs (ADR 0026).
     * - Details card: author, repository, license, build SHA/date.
     * - Build SHA: copy button + direct commit link (hidden for "unknown").
     * - Changelog card: release cards (all folded until opened) with
     *   localized type groups; no inner scroll region or sticky heading.
     */
    import { resolveLocale, t, tPlural } from "../i18n.svelte";
    import { decodeText } from "../../core/encoding";
    import { parseChangelog, renderChangelog, type ChangelogLabels } from "../changelog";
    import { copyToClipboard } from "../clipboard";
    import { showToast } from "../ui-state.svelte";
    import Icon from "../components/Icon.svelte";
    import { createLogger } from "../../core/log";
    import { store } from "../../stores/settings.svelte";

    const log = createLogger("info");
    const changelogRaw = decodeText(__CHANGELOG_B64__.join(""));
    const changelog = $derived(parseChangelog(changelogRaw));
    const locale = $derived(resolveLocale(store.settings.locale));
    const changelogLabels: ChangelogLabels = $derived({
        current: t("info.changelog.current"),
        types: {
            feat: t("info.changelog.type.features"),
            fix: t("info.changelog.type.fixes"),
            perf: t("info.changelog.type.performance"),
            revert: t("info.changelog.type.reverts"),
            docs: t("info.changelog.type.docs"),
        },
    });
    const changelogHtml = $derived(renderChangelog(changelog, { locale, labels: changelogLabels }));

    const VERSION = GM_info.script.version;
    const AUTHOR = GM_info.script.author ?? "Jan Gaida";
    const REPOSITORY = "https://github.com/JanGaida/redirect-rules";
    const AUTHOR_URL = "https://github.com/JanGaida";
    const LICENSE = "GPL-3.0";
    const LICENSE_URL = `${REPOSITORY}/blob/HEAD/LICENSE`;
    const ISSUE_URL = `${REPOSITORY}/issues/new`;

    function openExternal(url: string, event?: MouseEvent): void {
        event?.preventDefault();
        log.debug("external link opened", { url });
        if (typeof GM_openInTab === "function") {
            GM_openInTab(url, { active: true });
        } else {
            window.open(url, "_blank", "noopener,noreferrer");
        }
    }

    const BUILD_SHA = __BUILD_SHA__;
    const BUILD_DATE = __BUILD_DATE__;
    const COMMIT_URL = `${REPOSITORY}/commit/${BUILD_SHA}`;
    const COMMIT_LINKABLE = /^[0-9a-f]{7,40}$/i.test(BUILD_SHA);

    async function copyBuildSha(): Promise<void> {
        try {
            await copyToClipboard(BUILD_SHA);
            log.debug("build sha copied", { sha: BUILD_SHA });
            showToast(t("info.copyBuild.done"));
        } catch (e) {
            log.warn("build sha copy failed", { error: String(e) });
            showToast(t("info.copyBuild.failed"));
        }
    }
</script>

<div class="rr-tab-root rr-tab-root--lane">
    <div class="rr-info-body rr-centered-root">
        <section class="rr-info-hero rr-hero" aria-labelledby="rr-info-hero-title">
            <div class="rr-info-hero-copy">
                <h3 id="rr-info-hero-title" class="rr-info-hero-name">{t("dashboard.title")}</h3>
                <p class="rr-info-hero-tagline">{t("info.tagline")}</p>
                <div class="rr-info-hero-meta">
                    <span class="rr-info-version-badge">
                        <span class="rr-info-version-dot" aria-hidden="true"></span>
                        <span class="rr-visually-hidden">{t("info.version")}: </span>
                        v{VERSION}
                    </span>
                </div>
            </div>
            <div class="rr-info-hero-actions">
                <a
                    class="rr-btn rr-btn--accent"
                    href={REPOSITORY}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t("info.repository")}
                    onclick={(e) => openExternal(REPOSITORY, e)}
                >
                    <Icon name="github" />
                    {t("info.repository")}
                </a>
                <a
                    class="rr-btn"
                    href={ISSUE_URL}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t("info.createIssue")}
                    onclick={(e) => openExternal(ISSUE_URL, e)}
                >
                    <Icon name="bugReport" />
                    {t("info.createIssue")}
                </a>
            </div>
        </section>

        <section class="rr-info-card rr-card" aria-labelledby="rr-info-details-title">
            <header class="rr-info-card-head rr-card-head">
                <Icon name="info" class="rr-info-card-icon rr-card-icon" />
                <h3 id="rr-info-details-title" class="rr-info-card-title rr-card-title">{t("info.group.about")}</h3>
            </header>
            <dl class="rr-info-details">
                <div class="rr-info-detail">
                    <dt>{t("info.author")}</dt>
                    <dd>
                        <a
                            href={AUTHOR_URL}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`GitHub: ${AUTHOR}`}
                            onclick={(e) => openExternal(AUTHOR_URL, e)}
                        >
                            {AUTHOR}
                            <Icon name="github" />
                        </a>
                    </dd>
                </div>
                <div class="rr-info-detail">
                    <dt>{t("info.repository")}</dt>
                    <dd>
                        <a
                            href={REPOSITORY}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={t("info.repository")}
                            onclick={(e) => openExternal(REPOSITORY, e)}
                        >
                            redirect-rules
                            <Icon name="github" />
                        </a>
                    </dd>
                </div>
                <div class="rr-info-detail">
                    <dt>{t("info.license")}</dt>
                    <dd>
                        <a
                            href={LICENSE_URL}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={t("info.license")}
                            onclick={(e) => openExternal(LICENSE_URL, e)}
                        >
                            <Icon name="balance" />
                            {LICENSE}
                        </a>
                    </dd>
                </div>
                <div class="rr-info-detail">
                    <dt>{t("info.buildSha")}</dt>
                    <dd class="rr-info-build">
                        <code>{BUILD_SHA}</code>
                        <button
                            type="button"
                            class="rr-info-icon-btn"
                            aria-label={t("info.copyBuild")}
                            title={t("info.copyBuild")}
                            data-testid="build-sha-copy"
                            onclick={copyBuildSha}
                        >
                            <Icon name="contentCopy" />
                        </button>
                        {#if COMMIT_LINKABLE}
                            <a
                                class="rr-info-icon-btn"
                                href={COMMIT_URL}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t("info.viewCommit")}
                                title={t("info.viewCommit")}
                                data-testid="build-sha-commit"
                                onclick={(e) => openExternal(COMMIT_URL, e)}
                            >
                                <Icon name="openInNew" />
                            </a>
                        {/if}
                    </dd>
                </div>
                <div class="rr-info-detail">
                    <dt>{t("info.buildDate")}</dt>
                    <dd>{BUILD_DATE}</dd>
                </div>
            </dl>
        </section>

        <section class="rr-info-card rr-info-changelog-card rr-card" aria-labelledby="rr-info-changelog-title">
            <header class="rr-info-card-head rr-card-head">
                <Icon name="chatInfo" class="rr-info-card-icon rr-card-icon" />
                <h3 id="rr-info-changelog-title" class="rr-info-card-title rr-card-title">{t("info.changelog")}</h3>
                {#if changelog.releases.length > 0}
                    <span class="rr-changelog-meta">
                        {tPlural("info.changelog.releaseCount", changelog.releases.length)} · {t(
                            "info.changelog.newestFirst",
                        )}
                    </span>
                {/if}
            </header>
            <div class="rr-changelog">{@html changelogHtml}</div>
        </section>
    </div>
</div>
