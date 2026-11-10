<script lang="ts">
    // ─────────────────────────────────────────────────────────────────────────
    // MARK: AssistantTab — copy → prompt → import, no wizard
    // ─────────────────────────────────────────────────────────────────────────
    // * Card 1 copies the LIVE `renderChatTemplate` output; the target group is
    //   OPTIONAL and the disclosure is open. A selected group is dumped whole.
    // * Card 2 parses a single-rule or group proposal, resolves the target
    //   automatically (semantic gate match, else a new group) and appends.
    // * The tab never writes lastSelection; imports are append-only object refs.
    import { tick } from "svelte";
    import { t, tPlural, resolveLocale } from "../i18n.svelte";
    import { store } from "../../stores/settings.svelte";
    import { showToast } from "../ui-state.svelte";
    import { copyToClipboard } from "../clipboard";
    import Icon from "../components/Icon.svelte";
    import ProviderLinks from "../components/ProviderLinks.svelte";
    import { renderChatTemplate, renderChatErrorTemplate } from "../../core/chat-template";
    import { parseAssistantProposal, resolveProposal, type AssistantGroupTarget } from "../../core/assistant-proposal";
    import { ruleLabel } from "../../core/preview";
    import { siteCaption } from "../site-caption";
    import type { SiteRule } from "../../core/settings";
    import type { ImportedRuleEntry } from "../../stores/settings.svelte";
    import { createLogger } from "../../core/log";

    const log = createLogger("assistant");

    interface Props {
        /** Switches to the Rules tab and reveals the imported rule. */
        onOpenRule: (siteIndex: number, ruleIndex: number) => void;
    }

    let { onOpenRule }: Props = $props();

    /** Default target: last selection's group, else the only group, else none. */
    function initialTargetSite(): SiteRule | null {
        const rules = store.settings.rules;
        const persisted = store.settings.lastSelection;
        if (persisted !== undefined && rules[persisted.siteIndex] !== undefined) return rules[persisted.siteIndex];
        return rules.length === 1 ? rules[0] : null;
    }

    // * Object refs, not indexes: the Rules tab may reorder sites/rules while this
    //   keep-alive tab is hidden. Indexes are resolved on every use.
    let targetSiteRef = $state<SiteRule | null>(initialTargetSite());
    let importText = $state("");
    let gateInput = $state("");
    let imported = $state<ImportedRuleEntry[]>([]);
    let lastImported = $state<ImportedRuleEntry[]>([]);
    let copyFailed = $state(false);
    let errorCopied = $state(false);
    let announce = $state("");
    let promptFallbackEl = $state<HTMLTextAreaElement | null>(null);
    let importEl = $state<HTMLTextAreaElement | null>(null);

    const locale = $derived(resolveLocale(store.settings.locale));
    const targetSiteIndex = $derived(targetSiteRef !== null ? store.settings.rules.indexOf(targetSiteRef) : null);
    const targetSite = $derived(
        targetSiteIndex !== null && targetSiteIndex >= 0 ? store.settings.rules[targetSiteIndex] : undefined,
    );
    const template = $derived(renderChatTemplate(targetSite, locale));

    const fallbackGate = $derived(gateInput.trim() !== "" ? gateInput.trim() : (targetSite?.siteRegex ?? ""));
    const parseResult = $derived(importText.trim() === "" ? null : parseAssistantProposal(importText, fallbackGate));
    const parseError = $derived(parseResult !== null && !parseResult.ok ? parseResult : null);
    const proposal = $derived.by(() => {
        const result = parseResult;
        if (result === null || !result.ok) return null;
        return resolveProposal(store.settings.rules, result.parsed);
    });

    const targetsWithRules = $derived(proposal?.groups.filter((group) => group.rules.length > 0) ?? []);
    const newRuleTotal = $derived(targetsWithRules.reduce((sum, group) => sum + group.rules.length, 0));
    const duplicateTotal = $derived(proposal?.groups.reduce((sum, group) => sum + group.duplicates.length, 0) ?? 0);
    const needsGate = $derived(parseError?.code === "needsGate");
    const showGateField = $derived(needsGate || gateInput !== "");
    const canImport = $derived(targetsWithRules.length > 0);

    const validationText = $derived.by(() => {
        if (importText.trim() === "") return "";
        if (parseError !== null) return t("chat.import.invalid");
        if (proposal === null) return "";
        return proposal.noNewRules ? t("assistant.import.nothingNew") : t("chat.validity.valid");
    });
    const statusClass = $derived(
        validationText === ""
            ? ""
            : parseError !== null || proposal?.noNewRules === true
              ? "rr-asst-status--bad"
              : "rr-asst-status--ok",
    );

    const targetOptions = $derived(
        store.settings.rules.map((site, index) => ({ value: String(index), label: siteCaption(site) })),
    );
    const visibleImported = $derived(
        imported.filter((entry) => store.settings.rules.includes(entry.site) && entry.site.rules.includes(entry.rule)),
    );

    // * Remote edits (another dashboard / the Rules tab) can delete either ref;
    //   drop it so the prompt never points at a vanished row.
    $effect(() => {
        if (targetSiteRef !== null && !store.settings.rules.includes(targetSiteRef)) {
            targetSiteRef = null;
        }
    });

    function selectTarget(value: string): void {
        targetSiteRef = value === "" ? null : (store.settings.rules[Number(value)] ?? null);
        log.debug("assistant target selected", { siteIndex: value === "" ? null : Number(value) });
    }

    async function copyTemplate(): Promise<void> {
        copyFailed = false;
        try {
            await copyToClipboard(template, promptFallbackEl ?? undefined);
            log.debug("assistant prompt copied", { chars: template.length });
            showToast(t("chat.toast"));
            announce = t("assistant.copyPrompt.done");
            void tick().then(() => importEl?.focus());
        } catch (e) {
            copyFailed = true;
            log.warn("assistant prompt copy failed", { error: String(e) });
            showToast(t("chat.copy.failed"));
        }
    }

    /** Best-effort clipboard read; the fallback is a focused field + Ctrl+V hint. */
    async function pasteFromClipboard(): Promise<void> {
        try {
            const text = await navigator.clipboard.readText();
            if (text.trim() !== "") importText = text;
            log.debug("assistant clipboard read", { chars: text.length });
            importEl?.focus();
        } catch (e) {
            log.warn("assistant clipboard read failed", { error: String(e) });
            importEl?.focus();
            showToast(t("assistant.paste.failed"));
        }
    }

    async function copyError(): Promise<void> {
        if (parseError === null || importText.trim() === "") return;
        try {
            await copyToClipboard(renderChatErrorTemplate(importText, parseError.message, locale));
            errorCopied = true;
            log.debug("assistant error prompt copied", { code: parseError.code });
            window.setTimeout(() => (errorCopied = false), 1500);
        } catch (e) {
            log.warn("assistant error prompt copy failed", { error: String(e) });
            showToast(t("chat.copy.failed"));
        }
    }

    function targetLabel(group: AssistantGroupTarget): string {
        if (group.matchIndex !== null) {
            const site = store.settings.rules[group.matchIndex];
            return site !== undefined ? t("assistant.dest.existing", { group: site.siteRegex }) : group.siteRegex;
        }
        return t("assistant.dest.new", { gate: group.siteRegex });
    }

    function doImport(): void {
        if (!canImport) return;
        const created: ImportedRuleEntry[] = [];
        for (const group of targetsWithRules) {
            if (group.matchIndex !== null) {
                created.push(...store.appendImportedRules(group.matchIndex, group.rules, group.previewEntries));
            } else {
                created.push(...store.createSiteRuleWithRules(group.siteRegex, group.rules, group.previewEntries));
            }
        }
        if (created.length === 0) return;

        log.debug("assistant rules imported", {
            groups: targetsWithRules.length,
            rules: created.length,
            newGroups: targetsWithRules.filter((group) => group.matchIndex === null).length,
        });
        imported.push(...created);
        lastImported = created;
        importText = "";
        gateInput = "";
        showToast(t("chat.import.success"));
        announce = t("assistant.success.count", { n: created.length });
    }

    function resetForAnother(): void {
        log.debug("assistant reset for another import");
        lastImported = [];
        importText = "";
        gateInput = "";
        announce = "";
        void tick().then(() => importEl?.focus());
    }

    function openImported(entry: ImportedRuleEntry): void {
        const siteIndex = store.settings.rules.indexOf(entry.site);
        if (siteIndex < 0) return;
        const ruleIndex = entry.site.rules.indexOf(entry.rule);
        if (ruleIndex < 0) return;
        log.debug("assistant imported rule opened", { siteIndex, ruleIndex });
        onOpenRule(siteIndex, ruleIndex);
    }

    function openLastImported(): void {
        const first = lastImported[0];
        if (first !== undefined) openImported(first);
    }
</script>

<div class="rr-tab-root rr-tab-root--lane">
    <div class="rr-assistant rr-centered-root">
        <section class="rr-hero rr-asst-hero" aria-labelledby="rr-asst-hero-title">
            <div class="rr-asst-hero-copy">
                <h3 id="rr-asst-hero-title" class="rr-asst-title">{t("assistant.hero.title")}</h3>
                <p class="rr-asst-lead">{t("assistant.hero.lead")}</p>
            </div>
            <ProviderLinks />
        </section>

        <p class="rr-visually-hidden" aria-live="polite">{announce}</p>

        <div class="rr-asst-workbench">
            <section class="rr-card rr-asst-card" aria-labelledby="rr-asst-copy-title">
                <header class="rr-card-head">
                    <Icon name="contentCopy" class="rr-card-icon" />
                    <h3 id="rr-asst-copy-title" class="rr-card-title">{t("assistant.card.copy.title")}</h3>
                </header>
                <div class="rr-card-body rr-asst-card-body">
                    <p class="rr-asst-hint">{t("assistant.card.copy.hint")}</p>

                    <div class="rr-asst-target">
                        <label class="rr-asst-label" for="assistant-target-site">{t("assistant.targetSite")}</label>
                        <div class="rr-asst-select">
                            <Icon name="travelExplore" class="rr-asst-select-icon" />
                            <select
                                id="assistant-target-site"
                                class="rr-asst-select-input"
                                data-testid="assistant-target-site"
                                value={targetSiteIndex === null || targetSiteIndex < 0 ? "" : String(targetSiteIndex)}
                                onchange={(event) => selectTarget(event.currentTarget.value)}
                            >
                                <option value="">{t("assistant.targetSite.auto")}</option>
                                {#each targetOptions as option (option.value)}
                                    <option value={option.value}>{option.label}</option>
                                {/each}
                            </select>
                            <Icon name="unfoldMore" class="rr-asst-select-chevron" />
                        </div>
                        <p class="rr-asst-target-meta">
                            {#if targetSite}
                                {tPlural("rules.count.site", targetSite.rules.length)}
                            {:else}
                                {t("assistant.targetSite.autoHint")}
                            {/if}
                        </p>
                    </div>

                    <div class="rr-asst-summary">
                        <span class="rr-asst-summary-cell">
                            <span class="rr-asst-summary-key">{t("assistant.summary.gate")}</span>
                            <code>{targetSite?.siteRegex ?? t("assistant.summary.auto")}</code>
                        </span>
                        <span class="rr-asst-summary-cell">
                            <span class="rr-asst-summary-key">{t("assistant.summary.rules")}</span>
                            <code>{targetSite ? String(targetSite.rules.length) : "—"}</code>
                        </span>
                        <span class="rr-asst-summary-cell">
                            <span class="rr-asst-summary-key">{t("assistant.summary.format")}</span>
                            <code>JSON</code>
                        </span>
                    </div>

                    <details class="rr-asst-prompt-preview" data-testid="assistant-prompt-preview">
                        <summary>{t("assistant.promptPreview")}</summary>
                        <pre class="rr-asst-prompt-pre">{template}</pre>
                    </details>

                    <button
                        class="rr-btn rr-btn--accent rr-asst-primary rr-asst-copy-btn"
                        data-testid="assistant-copy-prompt"
                        onclick={copyTemplate}
                    >
                        <Icon name="contentCopy" />
                        {t("assistant.copyPrompt")}
                    </button>

                    {#if copyFailed}
                        <div class="rr-asst-prompt-fallback">
                            <p class="rr-asst-hint">{t("assistant.promptFallback")}</p>
                            <pre class="rr-asst-prompt-pre">{template}</pre>
                        </div>
                    {/if}
                </div>
            </section>

            <section class="rr-card rr-asst-card" aria-labelledby="rr-asst-import-title">
                <header class="rr-card-head">
                    <Icon name="download" class="rr-card-icon" />
                    <h3 id="rr-asst-import-title" class="rr-card-title">{t("assistant.card.import.title")}</h3>
                </header>
                <div class="rr-card-body rr-asst-card-body">
                    <p class="rr-asst-hint">{t("assistant.card.import.hint")}</p>

                    {#if lastImported.length > 0}
                        <div class="rr-asst-success" data-testid="assistant-import-success">
                            <div class="rr-asst-success-copy">
                                <span class="rr-asst-success-icon" aria-hidden="true"><Icon name="check" /></span>
                                <div class="rr-asst-success-text">
                                    <h4 class="rr-asst-success-title">{t("assistant.success.title")}</h4>
                                    <p class="rr-asst-success-rule">
                                        {t("assistant.success.count", { n: lastImported.length })}
                                    </p>
                                    <ul class="rr-asst-success-list">
                                        {#each lastImported as entry (entry.rule)}
                                            <li>
                                                <button class="rr-asst-open-link" onclick={() => openImported(entry)}>
                                                    <span class="rr-asst-open-label"
                                                        >{ruleLabel(entry.rule) || "—"}</span
                                                    >
                                                    <span class="rr-asst-open-action">{siteCaption(entry.site)}</span>
                                                </button>
                                            </li>
                                        {/each}
                                    </ul>
                                </div>
                            </div>
                            <div class="rr-asst-actions">
                                <button class="rr-btn rr-btn--accent rr-asst-primary" onclick={openLastImported}>
                                    {t("assistant.openInRules")}
                                </button>
                                <button class="rr-btn" onclick={resetForAnother}>{t("assistant.success.again")}</button>
                            </div>
                        </div>
                    {:else}
                        <div class="rr-asst-import-wrap">
                            <textarea
                                id="chat-import-box"
                                data-testid="chat-import-box"
                                class="rr-textarea rr-asst-import {importText.trim()
                                    ? parseError !== null
                                        ? 'rr-textarea--invalid'
                                        : 'rr-textarea--valid'
                                    : ''}"
                                rows="3"
                                autocomplete="off"
                                data-bwignore="true"
                                data-1p-ignore="true"
                                data-lpignore="true"
                                data-protonpass-ignore="true"
                                data-form-type="other"
                                bind:value={importText}
                                bind:this={importEl}
                                spellcheck="false"
                                placeholder={t("chat.import.placeholder")}
                                aria-label={t("chat.import.label")}
                                aria-invalid={parseError !== null}></textarea>
                            <button
                                class="rr-asst-paste-inline"
                                data-testid="assistant-paste"
                                onclick={pasteFromClipboard}
                                title={t("assistant.paste")}
                            >
                                <Icon name="contentCopy" />
                                <span>{t("assistant.paste")}</span>
                            </button>
                        </div>

                        {#if showGateField}
                            <div class="rr-asst-field">
                                <label class="rr-asst-label" for="assistant-gate">{t("assistant.gate.label")}</label>
                                <div class="rr-asst-url-edit">
                                    <input
                                        id="assistant-gate"
                                        class="rr-input"
                                        data-testid="assistant-gate-input"
                                        autocomplete="off"
                                        data-bwignore="true"
                                        data-1p-ignore="true"
                                        data-lpignore="true"
                                        data-protonpass-ignore="true"
                                        data-form-type="other"
                                        bind:value={gateInput}
                                        placeholder="example\\.com"
                                        spellcheck="false"
                                        aria-describedby="assistant-gate-hint"
                                    />
                                    <p id="assistant-gate-hint" class="rr-asst-hint">{t("assistant.gate.hint")}</p>
                                </div>
                            </div>
                        {/if}

                        {#if proposal !== null && proposal.groups.length > 0}
                            <ul class="rr-asst-dest-list">
                                {#each proposal.groups as group, index (index)}
                                    <li class="rr-asst-dest">
                                        <span class="rr-asst-dest-target">{targetLabel(group)}</span>
                                        <span class="rr-asst-dest-count">
                                            {t("assistant.rules.count", { n: group.rules.length })}
                                        </span>
                                        {#if group.duplicates.length > 0}
                                            <span class="rr-asst-dest-dup">
                                                {t("assistant.rules.duplicates", { n: group.duplicates.length })}
                                            </span>
                                        {/if}
                                        {#if group.proposedGate !== group.siteRegex}
                                            <span class="rr-asst-dest-mismatch">
                                                {t("assistant.dest.mismatch", {
                                                    proposed: group.proposedGate,
                                                    target: group.siteRegex,
                                                })}
                                            </span>
                                        {/if}
                                    </li>
                                {/each}
                            </ul>
                        {/if}

                        {#if duplicateTotal > 0 && newRuleTotal === 0}
                            <p class="rr-asst-hint">{t("assistant.import.nothingNew")}</p>
                        {/if}

                        <div class="rr-asst-import-actions">
                            <span class="rr-asst-status {statusClass}" aria-live="polite">{validationText}</span>
                            <div class="rr-asst-buttons">
                                {#if parseError !== null}
                                    <button
                                        class="rr-btn rr-btn--danger"
                                        data-testid="assistant-error-template-copy"
                                        onclick={copyError}
                                    >
                                        <Icon name="autoFixHigh" />
                                        {errorCopied ? t("chat.errorTemplate.copied") : t("chat.errorTemplate.copy")}
                                    </button>
                                {/if}
                                <button
                                    class="rr-btn rr-btn--accent rr-asst-primary"
                                    data-testid="assistant-import"
                                    onclick={doImport}
                                    disabled={!canImport}
                                >
                                    {t("chat.import.button")}
                                </button>
                            </div>
                        </div>
                    {/if}

                    {#if visibleImported.length > 0}
                        <div class="rr-asst-imported">
                            <h4 class="rr-asst-imported-title">{t("assistant.imported")}</h4>
                            <ul class="rr-asst-imported-list">
                                {#each visibleImported as entry (entry.rule)}
                                    <li>
                                        <button class="rr-asst-open-link" onclick={() => openImported(entry)}>
                                            <span class="rr-asst-open-label">{ruleLabel(entry.rule) || "—"}</span>
                                            <span class="rr-asst-open-action">{t("assistant.openInRules")}</span>
                                        </button>
                                    </li>
                                {/each}
                            </ul>
                        </div>
                    {/if}
                </div>
            </section>
        </div>

        <textarea
            class="rr-visually-hidden"
            data-testid="assistant-prompt-fallback"
            bind:this={promptFallbackEl}
            value={template}
            readonly
            tabindex="-1"
            aria-hidden="true"></textarea>
    </div>
</div>
