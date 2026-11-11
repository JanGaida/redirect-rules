<script module lang="ts">
    /** Cached ms formatters — one per locale instead of one per preview entry. */
    const MS_FORMATTERS = new Map<string, Intl.NumberFormat>();

    function msFormatter(locale: string): Intl.NumberFormat {
        let formatter = MS_FORMATTERS.get(locale);
        if (formatter === undefined) {
            formatter = new Intl.NumberFormat(locale, {
                style: "unit",
                unit: "millisecond",
                maximumFractionDigits: 1,
            });
            MS_FORMATTERS.set(locale, formatter);
        }
        return formatter;
    }
</script>

<script lang="ts">
    /**
     * RuleEditor — the dedicated editor pane.
     *
     * * Fields per rule kind (kind switch carries the regex over — legacy
     *   parity), live regex validation (red = blocks saving). The dock fields
     *   are MULTILINE textareas with progressive autogrow.
     * * Preview: the preview shows the WHOLE
     *   GROUP — ONE collapsible step per AUTHORED rule (applied OR skipped,
     *   via a status chip + per-step reason), all steps FOLDED by default
     *   (manual folding via the <details> toggle). The chip numbering is the
     *   RULE NUMBER within the group (explorer parity), the step summary
     *   carries the RULE LABEL (regex/params) instead of url changes, and the
     *   SELECTED rule is only HIGHLIGHTED (never auto-unfolding). An unfolded
     *   step leads with its OWN reason (first element inside the details). A
     *   PROMINENT total block compares start vs. end. Test cases live ON
     *   THE SITE GROUP as `previewEntries` (persisted — group binding).
     * * Test-case rows: the row summary
     *   is a description-first caption (`InlineCaption` — pencil/double-click/F2
     *   edits; `previewCaption` is description-only, empty shows `—`) with a
     *   short icon-less status chip (`ok`/`fail`/`—`, long label as tooltip +
     *   accessible name) leading it, plus hover-revealed RowActions. Under the
     *   caption an inline-editable Input/Output URL block (`previewSummaryUrls`,
     *   both rows always render so empty values stay editable) renders a panel
     *   per row with URI tones and the input↔expected-output diff
     *   (`PreviewSpans`); double-click/pencil opens the same zero-jump overlay.
     *   The body no longer carries URL or description fields — the summary is
     *   the only editing surface for both. The TOTAL block is hidden only when
     *   a pinned test passes (its start/end pair is then identical to the rows).
     * * Reference popovers: every trigger sits in the
     *   field's trailing affix — the regex carries the manual, substitution/
     *   params the token reference. Both open top-layer popovers via
     *   `InfoPopover` (all rule kinds).
     * * MODE SPLIT: the pane renders EITHER
     *   the field section (`mode="fields"` — inline in the rule row) OR the
     *   preview sections (`mode="preview"` — the top-right preview cell). Both
     *   modes share the same derivations (pure, cheap), so two instances can
     *   live in different grid cells of the same layout. The preview needs only
     *   the GROUP (ruleIndex -1 = no rule selected — steps render, reason hides);
     *   the fields need the selected RULE. `mode="full"` keeps the legacy
     *   single-pane behavior.
     */
    import { t, tPlural, resolveLocale } from "../i18n.svelte";
    import { showToast, UNDO_TOAST_MS } from "../ui-state.svelte";
    import { hideSkippedFor, hasLocalVisibilityOverride, toggleLocalVisibility } from "../preview-visibility.svelte";
    import { store } from "../../stores/settings.svelte";
    import { isValidRegex, regexToReadableLiteral } from "../../core/parse-regex";
    import { compileRules } from "../../core/redirect-engine";
    import { previewGroupCompiled, testStatus } from "../../core/preview";
    import { switchRuleKind } from "../rule-kind-drafts";
    import { motionFastDuration } from "../motion";
    import { createLogger } from "../../core/log";

    const log = createLogger("editor");
    import TextArea from "./TextArea.svelte";
    import ChoiceGroup from "./ChoiceGroup.svelte";
    import Icon from "./Icon.svelte";
    import DragHandle from "./DragHandle.svelte";
    import InlineCaption from "./InlineCaption.svelte";
    import PreviewSpans from "./PreviewSpans.svelte";
    import RowActions from "./RowActions.svelte";
    import TokenReference from "./TokenReference.svelte";
    import RegexManualReference from "./RegexManualReference.svelte";
    import { previewCaption } from "../preview-caption";
    import { previewSummaryUrls } from "../preview-summary-urls";
    import { moveIndex, remapIndex, shiftIndexAfterInsert, shiftIndexAfterRemove } from "../reorder";
    import { createListDrag, type DropTarget } from "../drag-controller";
    import { onDestroy } from "svelte";
    import { flip } from "svelte/animate";

    interface Props {
        siteIndex: number;
        /** -1 = no rule selected (preview-only render; fields + reason hide). */
        ruleIndex: number;
        /** Selects a chain step's rule (master-detail selection change). */
        onSelectStep: (siteIndex: number, ruleIndex: number) => void;
        /** Which part of the pane to render (restyle port). */
        mode?: "fields" | "preview" | "full";
    }

    let { siteIndex, ruleIndex, onSelectStep, mode = "full" }: Props = $props();

    // * Visible row labels live in the grid, outside TextArea — associate by id.
    const fieldUid = $props.id();
    const regexLabelId = `${fieldUid}-regex`;
    const substitutionLabelId = `${fieldUid}-substitution`;
    const paramsLabelId = `${fieldUid}-params`;

    const site = $derived(store.settings.rules[siteIndex]);
    const rule = $derived(ruleIndex >= 0 ? site?.rules[ruleIndex] : undefined);

    const kindChoiceOptions = $derived([
        {
            value: "replace",
            label: t("rules.kindShort.replace"),
            title: t("rules.kind.replace"),
            icon: "findReplace" as const,
        },
        {
            value: "appendQuery",
            label: t("rules.kindShort.appendQuery"),
            title: t("rules.kind.appendQuery"),
            icon: "addLink" as const,
        },
        {
            value: "removeQuery",
            label: t("rules.kindShort.removeQuery"),
            title: t("rules.kind.removeQuery"),
            icon: "delete" as const,
        },
        {
            value: "checkpoint",
            label: t("rules.kindShort.checkpoint"),
            title: t("rules.kind.checkpoint"),
            icon: "flag" as const,
        },
    ]);
    const checkpointModeChoiceOptions = $derived([
        { value: "continue", label: t("rules.mode.continue"), icon: "playArrow" as const },
        { value: "stop", label: t("rules.mode.stop"), icon: "stopCircle" as const },
    ]);

    // * Skipped-step visibility: global default + per-group session override
    //   (ADR 0040). Precedence lives in `preview-visibility.svelte.ts`.
    const hideSkipped = $derived(hideSkippedFor(site));
    const hasVisibilityOverride = $derived(site !== undefined && hasLocalVisibilityOverride(site));
    const visibilityAction = $derived(
        (hideSkipped ? t("preview.showSkipped") : t("preview.hideSkipped")) +
            (hasVisibilityOverride ? ` — ${t("preview.localOverride")}` : ""),
    );

    // * Engine-truth previews over the LIVE settings — recomputed on every edit.
    // * Group binding: each `previewEntries` url replays the whole chain; the chain
    //   renders EVERY authored rule (applied or skipped — chip status), each
    //   step carries its own reason. The SELECTED rule is only HIGHLIGHTED
    //   (never auto-unfolding — folding is manual, default = all folded). An
    //   unfolded step leads with its OWN reason text (first element).
    // * Chain-Stat: the group replay is TIMED — the toolbar shows the
    //   rule count + duration next to the "Rules chain" title.
    const previewEntries = $derived(site?.previewEntries ?? []);
    const previews = $derived.by(() => {
        if (!site) return [];
        // * Compile ONCE per recompute — every test case replays the same chain.
        const compileStart = performance.now();
        const group = compileRules([site], { includeDisabled: true })[0];
        const compileMs = performance.now() - compileStart;
        const formatMs = msFormatter(resolveLocale(store.settings.locale) === "de" ? "de-DE" : "en-US");
        return previewEntries.map((entry, index) => {
            const t0 = performance.now();
            const chain = previewGroupCompiled(entry.url, site, group);
            // * Keep the old metric meaning: shared compile + this entry's replay.
            const ms = compileMs + (performance.now() - t0);
            const msText = ms < 1 ? t("preview.msFast") : formatMs.format(ms);
            const status = testStatus(chain.finalUrl, entry.testOutputUri);
            // * Shared executor result; empty gates keep the match-all authoring display
            //   (compileRules drops them, so chain.gateMatched is false).
            const siteGateMatches = site.siteRegex === "" ? true : chain.gateMatched;
            return {
                index,
                entry,
                url: entry.url,
                testOutputUri: entry.testOutputUri,
                chain,
                ms,
                msText,
                status,
                siteGateMatches,
                summaryUrls: previewSummaryUrls(entry),
            };
        });
    });

    // * Outer fold per preview block (independent fold/unfold).
    let openPreviews = $state<Record<number, boolean>>({});
    let previewFilter = $state("");
    // * Inline caption edit — one row at a time (parent-keyed, ADR 0030).
    let editingPreview = $state<number | null>(null);
    // * Inline URL edit — `${previewIndex}:${field}`, one overlay at a time.
    let editingUrl = $state<string | null>(null);
    // * Pointer reorder state (session only) — visual positions; the controller
    //   owns the drag gesture, the rows keep their DOM order.
    let previewListEl = $state<HTMLElement | null>(null);
    let previewDragFrom = $state<number | null>(null);
    let previewDrop = $state<DropTarget | null>(null);

    const motionFastMs = $derived(motionFastDuration(store.settings.motion));

    // * Fields-only mode renders no preview list — skip the preview derivation
    //   entirely (the inline rule editor mounts one instance per open rule).
    $effect(() => {
        if (mode === "fields") return;
        const n = previews.length;
        let changed = false;
        const next = { ...openPreviews };
        for (let i = 0; i < n; i += 1) {
            if (next[i] === undefined) {
                next[i] = false;
                changed = true;
            }
        }
        if (changed) openPreviews = next;
    });

    /** Remaps numeric fold keys across a preview move. */
    function remapNumericRecord(record: Record<number, boolean>, from: number, to: number): Record<number, boolean> {
        const next: Record<number, boolean> = {};
        for (const [key, value] of Object.entries(record)) next[remapIndex(Number(key), from, to)] = value;
        return next;
    }

    /** Remaps `${previewIndex}:${ruleKey}` step keys across a preview move. */
    function remapStepRecord(record: Record<string, boolean>, from: number, to: number): Record<string, boolean> {
        const next: Record<string, boolean> = {};
        for (const [key, value] of Object.entries(record)) {
            const [previewIndex, ruleKey] = key.split(":");
            next[`${remapIndex(Number(previewIndex), from, to)}:${ruleKey}`] = value;
        }
        return next;
    }

    /** Drops a preview's fold keys and shifts later previews down. */
    function removeNumericRecord(record: Record<number, boolean>, removed: number): Record<number, boolean> {
        const next: Record<number, boolean> = {};
        for (const [key, value] of Object.entries(record)) {
            const index = Number(key);
            if (index === removed) continue;
            next[shiftIndexAfterRemove(index, removed)] = value;
        }
        return next;
    }

    /** Drops a preview's step keys and shifts later previews down. */
    function removeStepRecord(record: Record<string, boolean>, removed: number): Record<string, boolean> {
        const next: Record<string, boolean> = {};
        for (const [key, value] of Object.entries(record)) {
            const [previewIndex, ruleKey] = key.split(":");
            const index = Number(previewIndex);
            if (index === removed) continue;
            next[`${shiftIndexAfterRemove(index, removed)}:${ruleKey}`] = value;
        }
        return next;
    }

    /** Duplicates a preview's fold keys at index+1 and shifts later previews up. */
    function cloneNumericRecord(record: Record<number, boolean>, index: number): Record<number, boolean> {
        const next: Record<number, boolean> = {};
        for (const [key, value] of Object.entries(record)) {
            const current = Number(key);
            if (current === index) {
                next[current] = value;
                next[current + 1] = value;
            } else {
                next[shiftIndexAfterInsert(current, index + 1)] = value;
            }
        }
        return next;
    }

    /** Duplicates a preview's step keys at index+1 and shifts later previews up. */
    function cloneStepRecord(record: Record<string, boolean>, index: number): Record<string, boolean> {
        const next: Record<string, boolean> = {};
        for (const [key, value] of Object.entries(record)) {
            const [previewIndex, ruleKey] = key.split(":");
            const current = Number(previewIndex);
            if (current === index) {
                next[`${current}:${ruleKey}`] = value;
                next[`${current + 1}:${ruleKey}`] = value;
            } else {
                next[`${shiftIndexAfterInsert(current, index + 1)}:${ruleKey}`] = value;
            }
        }
        return next;
    }

    function reorderPreviews(from: number, to: number): void {
        if (from === to) return;
        const entries = site?.previewEntries;
        if (!entries) return;
        log.debug("preview entry reordered", { siteIndex, from, to });
        const [entry] = entries.splice(from, 1);
        entries.splice(to, 0, entry);
        openPreviews = remapNumericRecord(openPreviews, from, to);
        openSiteGates = remapNumericRecord(openSiteGates, from, to);
        openSteps = remapStepRecord(openSteps, from, to);
    }

    /** Keyboard reorder: mirrors the drop math with the next VISIBLE neighbor. */
    function movePreviewBy(index: number, delta: -1 | 1): void {
        const pos = displayPreviews.findIndex((preview) => preview.index === index);
        if (pos === -1) return;
        const target = displayPreviews[pos + delta];
        if (!target) return;
        reorderPreviews(index, moveIndex(index, target.index, delta > 0, previews.length));
    }

    /** Preview-card pointer drag: visual positions → raw indexes → moveIndex. */
    const previewDrag = createListDrag({
        getItems: () =>
            Array.from(previewListEl?.querySelectorAll<HTMLElement>(":scope > details.rr-ed-preview") ?? []),
        getAnchor: () => previewListEl,
        onHover: (target) => (previewDrop = target),
        onDrop: (fromPos, target) => {
            const from = displayPreviews[fromPos];
            const to = displayPreviews[target.pos];
            if (!from || !to) return;
            reorderPreviews(from.index, moveIndex(from.index, to.index, target.insertAfter, previews.length));
        },
        onCancel: () => {},
        onEnd: () => {
            previewDragFrom = null;
            previewDrop = null;
        },
    });

    onDestroy(() => previewDrag.destroy());

    // * Controlled chain folding: per-step open flags per preview block.
    // Keyed `${previewIndex}:${stableRuleKey}` so a rule reorder keeps its fold.
    let openSteps = $state<Record<string, boolean>>({});
    let openSiteGates = $state<Record<number, boolean>>({});

    // * Stable rule identity for session state — WeakMap survives reorder/clone.
    const ruleStepKeys = new WeakMap<object, string>();
    let nextRuleStepSeq = 0;

    function ruleStepKey(ruleIndex: number): string {
        const current = site?.rules[ruleIndex];
        if (!current) return `i${ruleIndex}`;
        let key = ruleStepKeys.get(current);
        if (key === undefined) {
            nextRuleStepSeq += 1;
            key = `r${nextRuleStepSeq}`;
            ruleStepKeys.set(current, key);
        }
        return key;
    }

    function previewStepKey(previewIndex: number, ruleIndex: number): string {
        return `${previewIndex}:${ruleStepKey(ruleIndex)}`;
    }

    function allPreviewStepsOpen(preview: (typeof previews)[number]): boolean {
        return (
            (openSiteGates[preview.index] ?? false) &&
            (preview.chain.steps.length === 0 ||
                preview.chain.steps.every((step) => openSteps[previewStepKey(preview.index, step.ruleIndex)]))
        );
    }

    function togglePreviewSteps(preview: (typeof previews)[number]): void {
        const target = !allPreviewStepsOpen(preview);
        log.debug("preview steps toggled", { siteIndex, previewIndex: preview.index, open: target });
        openSiteGates[preview.index] = target;
        for (const step of preview.chain.steps) openSteps[previewStepKey(preview.index, step.ruleIndex)] = target;
    }

    function addPreview(): void {
        const nextIndex = previewEntries.length;
        openPreviews = { ...openPreviews, [nextIndex]: false };
        store.addPreviewEntry(siteIndex);
    }

    const previewFilterNeedle = $derived(previewFilter.trim().toLowerCase());
    const displayPreviews = $derived.by(() => {
        const needle = previewFilterNeedle;
        if (needle === "") return previews;
        return previews.filter((preview) => {
            const haystack = [
                preview.url ?? "",
                preview.testOutputUri ?? "",
                preview.entry.description ?? "",
                preview.status ?? "",
            ]
                .join(" ")
                .toLowerCase();
            return haystack.includes(needle);
        });
    });

    function startPreviewEdit(index: number): void {
        editingUrl = null;
        editingPreview = index;
    }

    /** Stable inline-URL overlay key (one editor at a time). */
    function previewUrlKey(index: number, field: "url" | "testOutputUri"): string {
        return `${index}:${field}`;
    }

    function removePreview(index: number): void {
        const removed = store.settings.rules[siteIndex]?.previewEntries?.[index];
        if (removed === undefined) return;
        store.removePreviewEntry(siteIndex, index);
        // * The click commits/blurs the overlay first; clear anyway so a stale
        //   index can never point at a shifted entry.
        editingPreview = null;
        editingUrl = null;
        openPreviews = removeNumericRecord(openPreviews, index);
        openSiteGates = removeNumericRecord(openSiteGates, index);
        openSteps = removeStepRecord(openSteps, index);
        showToast(t("common.delete.toast.preview"), {
            durationMs: UNDO_TOAST_MS,
            action: {
                label: t("common.undo"),
                run: () => {
                    if (store.insertPreviewEntry(siteIndex, index, removed) < 0) {
                        showToast(t("common.delete.undoFailed"));
                    }
                },
            },
        });
    }

    function clonePreview(index: number): void {
        store.clonePreviewEntry(siteIndex, index);
        editingPreview = null;
        editingUrl = null;
        openPreviews = cloneNumericRecord(openPreviews, index);
        openSiteGates = cloneNumericRecord(openSiteGates, index);
        openSteps = cloneStepRecord(openSteps, index);
    }

    function regexInvalid(regex: string | undefined): boolean {
        return regex !== undefined && regex !== "" && !isValidRegex(regex);
    }

    /**
     * Switches the rule's kind — the authored regex carries over, the target
     * kind's distinct fields come from its session draft (empty/default on
     * first use). In-place mutation keeps the identity the draft map uses.
     */
    function switchKind(kind: string): void {
        if (!site || !rule) return;
        if (rule.kind !== kind) log.debug("rule kind changed", { siteIndex, ruleIndex, from: rule.kind, to: kind });
        switchRuleKind(rule, kind);
    }

    /** Accessible/tooltip test status — the chip shows only the short label. */
    function statusText(status: string): string {
        if (status === "success") return t("preview.test.successful");
        if (status === "failed") return t("preview.test.failed");
        return t("preview.test.noTest");
    }

    /** Language-neutral short label for the status chip. */
    function statusShortText(status: string): string {
        if (status === "success") return t("preview.test.short.success");
        if (status === "failed") return t("preview.test.short.failed");
        return t("preview.test.short.noTest");
    }
</script>

{#if site}
    <!-- * MODE "fields" / "full": the field block (the inline rule row; "full"
          keeps the legacy section header). The row summary carries the rule
          context — the fields section itself is chromeless here. -->
    {#if (mode === "fields" || mode === "full") && rule}
        <section class="rr-section rr-ed-fields">
            {#if mode === "full"}
                <div class="rr-section-header">
                    <h3 class="rr-section-title">
                        {t("rules.siteRegex")} #{siteIndex + 1} · {t("rules.list.rule")} #{ruleIndex + 1}
                    </h3>
                </div>
            {/if}
            <!-- * Inline field rows: kind + regex + substitution/params (label
                 left, field right). Reference triggers sit at the field end in
                 the trailing affix; each opens a top-layer popover. -->
            <div class="rr-rule-grid">
                <div class="rr-col-fields">
                    <div class="rr-ed-row">
                        <span class="rr-row-label" title={t("rules.kind")}>{t("rules.kind")}</span>
                        <ChoiceGroup
                            name={`rule-kind-${siteIndex}-${ruleIndex}`}
                            label={t("rules.kind")}
                            legendHidden
                            value={rule.kind}
                            options={kindChoiceOptions}
                            onchange={switchKind}
                        />
                    </div>
                    <div class="rr-ed-row">
                        <span
                            class="rr-row-label"
                            id={regexLabelId}
                            title={t(
                                rule.kind === "replace" || rule.kind === "checkpoint"
                                    ? "rules.regex.hint"
                                    : "rules.gateRegex.hint",
                            )}
                        >
                            {t("rules.regex")}
                        </span>
                        <TextArea
                            bind:value={rule.regex}
                            invalid={regexInvalid(rule.regex)}
                            highlight="regex"
                            ariaLabelledby={regexLabelId}
                            title={t(rule.kind === "replace" ? "rules.regex.hint" : "rules.gateRegex.hint")}
                        >
                            {#snippet leading()}.*{/snippet}
                            {#snippet trailing()}<RegexManualReference />{/snippet}
                        </TextArea>
                    </div>
                    {#if rule.kind === "replace"}
                        <div class="rr-ed-row">
                            <span class="rr-row-label" id={substitutionLabelId} title={t("rules.substitution.hint")}
                                >{t("rules.substitution")}</span
                            >
                            <TextArea
                                bind:value={rule.substitution}
                                highlight="substitution"
                                ariaLabelledby={substitutionLabelId}
                                title={t("rules.substitution.hint")}
                            >
                                {#snippet trailing()}<TokenReference kind={rule.kind} />{/snippet}
                            </TextArea>
                        </div>
                    {:else if rule.kind === "appendQuery"}
                        <div class="rr-ed-row">
                            <span class="rr-row-label" id={paramsLabelId} title={t("rules.params.hint")}
                                >{t("rules.params")}</span
                            >
                            <TextArea
                                bind:value={rule.params}
                                ariaLabelledby={paramsLabelId}
                                title={t("rules.params.hint")}
                            >
                                {#snippet trailing()}<TokenReference kind={rule.kind} />{/snippet}
                            </TextArea>
                        </div>
                    {:else if rule.kind === "removeQuery"}
                        <div class="rr-ed-row">
                            <span class="rr-row-label" id={paramsLabelId} title={t("rules.keys.hint")}
                                >{t("rules.keys")}</span
                            >
                            <TextArea
                                bind:value={rule.keys}
                                ariaLabelledby={paramsLabelId}
                                title={t("rules.keys.hint")}
                            />
                        </div>
                    {/if}
                    {#if rule.kind === "checkpoint"}
                        <div class="rr-ed-row">
                            <span class="rr-row-label" title={t("rules.mode.hint")}>{t("rules.mode")}</span>
                            <ChoiceGroup
                                name={`rule-mode-${siteIndex}-${ruleIndex}`}
                                label={t("rules.mode")}
                                legendHidden
                                value={rule.mode}
                                options={checkpointModeChoiceOptions}
                                onchange={(v: string) => {
                                    if (rule) rule.mode = v === "stop" ? "stop" : "continue";
                                }}
                            />
                        </div>
                    {/if}
                </div>
            </div>
        </section>
    {/if}

    <!-- * MODE "preview" / "full": ONE card — URL row, RULES CHAIN of the
          GROUP (EVERY rule is a collapsible step — applied or skipped via a
          status chip, each with its own before/after, ALL folded by default;
          chip = rule no. in the group, summary = rule label), the selection
          reason ABOVE-BELOW, then divider + total. -->
    {#if mode === "preview" || mode === "full"}
        <section class="rr-ed-preview" role="presentation">
            <div class="rr-filter-sticky">
                <div class="rr-filter-field">
                    <span class="rr-filter-icon" aria-hidden="true"><Icon name="search" /></span>
                    <input
                        class="rr-input rr-filter"
                        autocomplete="off"
                        data-bwignore="true"
                        data-1p-ignore="true"
                        data-lpignore="true"
                        data-protonpass-ignore="true"
                        data-form-type="other"
                        placeholder={t("preview.filter")}
                        title={t("preview.filter")}
                        aria-label={t("preview.filter")}
                        bind:value={previewFilter}
                        onkeydown={(e) => {
                            if (e.key !== "Escape") return;
                            e.preventDefault();
                            e.stopPropagation();
                            previewFilter = "";
                        }}
                    />
                    {#if previewFilter !== ""}
                        <button
                            class="rr-btn rr-btn-compact rr-btn--filter-clear"
                            aria-label={t("a11y.clearFilter")}
                            title={t("a11y.clearFilter")}
                            onclick={() => (previewFilter = "")}
                        >
                            <Icon name="close" />
                        </button>
                    {/if}
                </div>
                <hr class="rr-filter-divider" />
            </div>

            {#if site.disabled === true}
                <p class="rr-hint rr-hint-block">{t("preview.groupDisabled")}</p>
            {/if}

            {#if previews.length === 0}
                <div class="rr-section rr-empty-skeleton">
                    <span class="rr-empty-skeleton-content">
                        <Icon name="dataInfoAlert" />
                        <span>{t("preview.emptyEntries")}</span>
                    </span>
                </div>
            {:else}
                <div class="rr-preview-list" bind:this={previewListEl} role="presentation">
                    {#each displayPreviews as preview, pos (preview.entry)}
                        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                        <details
                            class="rr-master-site rr-section rr-ed-preview"
                            class:rr-drag-ghost={previewDragFrom === pos}
                            class:rr-drop-target={previewDrop?.pos === pos && previewDragFrom !== null}
                            animate:flip={{ duration: motionFastMs }}
                            bind:open={openPreviews[preview.index]}
                        >
                            <summary
                                class="rr-group-summary"
                                onkeydown={(e) => {
                                    if (e.key === "F2" && editingPreview === null && editingUrl === null) {
                                        e.preventDefault();
                                        startPreviewEdit(preview.index);
                                    }
                                }}
                            >
                                <span class="rr-preview-leading">
                                    {#if previews.length >= 2}
                                        <DragHandle
                                            label={t("a11y.reorderPreview")}
                                            hint={t("a11y.reorderHint")}
                                            onPointerDown={(e) => {
                                                previewDragFrom = pos;
                                                previewDrag.start(e, pos);
                                            }}
                                            onMove={(delta) => movePreviewBy(preview.index, delta)}
                                        />
                                    {/if}
                                    <Icon name="chevronRight" class="rr-tri" />
                                    <span class="rr-preview-status">
                                        <span
                                            class="rr-chip rr-chip-test-{preview.status}"
                                            title={statusText(preview.status)}
                                        >
                                            <span class="rr-chip-text" aria-hidden="true"
                                                >{statusShortText(preview.status)}</span
                                            >
                                            <span class="rr-visually-hidden">{statusText(preview.status)}</span>
                                        </span>
                                    </span>
                                </span>
                                <span class="rr-summary-lead">
                                    <InlineCaption
                                        caption={previewCaption(preview.entry)}
                                        value={preview.entry.description ?? ""}
                                        editing={editingPreview === preview.index}
                                        placeholder={t("preview.caption.placeholder")}
                                        hint={t("preview.caption.hint")}
                                        ariaLabel={t("preview.caption.label")}
                                        editLabel={t("a11y.edit")}
                                        onEditingChange={(v) => {
                                            if (v) editingUrl = null;
                                            editingPreview = v ? preview.index : null;
                                        }}
                                        onCommit={(value) => {
                                            const entry = site.previewEntries?.[preview.index];
                                            // * Normalize always emits a string description —
                                            //   an empty commit stays a string (canonical shape).
                                            if (entry) entry.description = value.trim();
                                        }}
                                    />
                                </span>
                                {#if preview.summaryUrls.length > 0}
                                    <span class="rr-summary-urls">
                                        {#each preview.summaryUrls as row (row.key)}
                                            {@const urlKey = previewUrlKey(preview.index, row.field)}
                                            <span class="rr-summary-url-row">
                                                <span class="rr-summary-url-label">{t(row.labelKey)}</span>
                                                <span class="rr-summary-url-value rr-preview-panel" role="presentation">
                                                    <InlineCaption
                                                        caption={row.value || "—"}
                                                        value={row.value}
                                                        editing={editingUrl === urlKey}
                                                        placeholder={t(row.labelKey)}
                                                        hint={t(row.editKey)}
                                                        ariaLabel={t(row.labelKey)}
                                                        editLabel={t(row.editKey)}
                                                        onEditingChange={(v) => {
                                                            if (v) editingPreview = null;
                                                            if (v) editingUrl = urlKey;
                                                            else if (editingUrl === urlKey) editingUrl = null;
                                                        }}
                                                        onCommit={(value) => {
                                                            const entry = site.previewEntries?.[preview.index];
                                                            if (entry) entry[row.field] = value;
                                                        }}
                                                    >
                                                        {#snippet children()}{#if row.spans.length > 0}<PreviewSpans
                                                                    spans={row.spans}
                                                                />{:else}<span class="rr-summary-url-empty">—</span
                                                                >{/if}{/snippet}
                                                    </InlineCaption>
                                                </span>
                                            </span>
                                        {/each}
                                    </span>
                                {/if}
                                <RowActions
                                    onClone={() => clonePreview(preview.index)}
                                    onDelete={() => removePreview(preview.index)}
                                />
                            </summary>
                            <div class="rr-site-shell">
                                <div class="rr-site-body">
                                    {#if preview.status !== "success"}
                                        <div class="rr-total">
                                            <div class="rr-preview-grid">
                                                <p class="rr-preview-panel-title">{t("preview.before")}</p>
                                                <div class="rr-preview-panel" role="presentation">
                                                    <p class="rr-preview-text">
                                                        <PreviewSpans spans={preview.chain.sourceSpans} />
                                                    </p>
                                                </div>
                                                <p class="rr-preview-panel-title">{t("preview.after")}</p>
                                                <div class="rr-preview-panel" role="presentation">
                                                    <p class="rr-preview-text">
                                                        <PreviewSpans spans={preview.chain.targetSpans} />
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    {/if}

                                    <div class="rr-chain-toolbar">
                                        <button
                                            class="rr-btn rr-btn-compact rr-btn--add"
                                            aria-label={allPreviewStepsOpen(preview)
                                                ? t("preview.foldAll")
                                                : t("preview.unfoldAll")}
                                            title={allPreviewStepsOpen(preview)
                                                ? t("preview.foldAll")
                                                : t("preview.unfoldAll")}
                                            disabled={preview.chain.steps.length === 0}
                                            onclick={() => togglePreviewSteps(preview)}
                                        >
                                            <Icon name={allPreviewStepsOpen(preview) ? "unfoldLess" : "unfoldMore"} />
                                        </button>
                                        <button
                                            class="rr-btn rr-btn-compact rr-btn--visibility"
                                            class:rr-btn--local-override={hasVisibilityOverride}
                                            aria-label={visibilityAction}
                                            title={visibilityAction}
                                            onclick={() => {
                                                if (site) toggleLocalVisibility(site);
                                            }}
                                        >
                                            <Icon
                                                name={hideSkipped ? "visibilityOff" : "visibility"}
                                                class="rr-toggle-skipped"
                                            />
                                        </button>
                                        <span class="rr-chain-stat">
                                            {tPlural("preview.chainStat", preview.chain.steps.length)} ·
                                            {t("preview.chainStat.time", { ms: preview.msText })}
                                        </span>
                                    </div>

                                    <div class="rr-steps">
                                        <details
                                            class="rr-step-group"
                                            class:selected={false}
                                            bind:open={openSiteGates[preview.index]}
                                        >
                                            <summary>
                                                <Icon name="chevronRight" class="rr-step-tri" />
                                                <span class="rr-chips">
                                                    <span class="rr-chip rr-chip-index">0</span>
                                                    <span class="rr-chip rr-chip-kind rr-chip-site"
                                                        >{t("rules.chain.site")}</span
                                                    >
                                                    <span
                                                        class="rr-chip rr-chip-status rr-chip-{preview.siteGateMatches
                                                            ? 'applied'
                                                            : 'danger'}"
                                                        title={t(
                                                            preview.siteGateMatches
                                                                ? "preview.reason.site-match"
                                                                : "preview.reason.site-no-match",
                                                        )}
                                                        >{t(
                                                            preview.siteGateMatches
                                                                ? "preview.site.match"
                                                                : "preview.site.noMatch",
                                                        )}</span
                                                    >
                                                </span>
                                                <span class="rr-step-urls">{site.siteRegex || "—"}</span>
                                            </summary>
                                            <p class="rr-preview-reason">
                                                {t(
                                                    preview.siteGateMatches
                                                        ? "preview.reason.site-match"
                                                        : "preview.reason.site-no-match",
                                                )}
                                            </p>
                                        </details>
                                        {#if preview.chain && preview.chain.steps.length === 0}
                                            <p class="rr-hint">{t("preview.unchangedUrl")}</p>
                                        {/if}
                                        {#each preview.chain.steps.filter((s) => !hideSkipped || s.status !== "skipped" || s.kind === "checkpoint") as step (step.ruleIndex)}
                                            <details
                                                class="rr-step-group"
                                                class:selected={step.ruleIndex === ruleIndex}
                                                bind:open={openSteps[previewStepKey(preview.index, step.ruleIndex)]}
                                            >
                                                <summary onclick={() => onSelectStep(siteIndex, step.ruleIndex)}>
                                                    <Icon name="chevronRight" class="rr-step-tri" />
                                                    <span class="rr-chips">
                                                        <span class="rr-chip rr-chip-index">{step.ruleIndex + 1}</span>
                                                        <span
                                                            class="rr-chip rr-chip-kind rr-chip-{step.kind.toLowerCase()}"
                                                            >{t(`rules.kindShort.${step.kind}`)}</span
                                                        >
                                                        {#if step.kind !== "checkpoint" || !step.reason.startsWith("checkpoint-")}
                                                            <span
                                                                class="rr-chip rr-chip-status rr-chip-{step.status}"
                                                                title={t(`preview.reason.${step.reason}`)}
                                                                >{t(`preview.status.${step.status}`)}</span
                                                            >
                                                        {:else}
                                                            <span
                                                                class="rr-chip rr-chip-status rr-chip-checkpoint rr-chip-checkpoint-{step.reason ===
                                                                'checkpoint-continue'
                                                                    ? 'continue'
                                                                    : 'stopped'}"
                                                                title={t(`preview.reason.${step.reason}`)}
                                                                >{t(
                                                                    step.reason === "checkpoint-continue"
                                                                        ? "preview.checkpoint.continue"
                                                                        : "preview.checkpoint.stopped",
                                                                )}</span
                                                            >
                                                        {/if}
                                                    </span>
                                                    <span class="rr-step-urls">{step.label || "—"}</span>
                                                </summary>
                                                <p class="rr-preview-reason">{t(`preview.reason.${step.reason}`)}</p>
                                                <div class="rr-preview-grid">
                                                    <p class="rr-preview-panel-title">{t("preview.before")}</p>
                                                    <div class="rr-preview-panel" role="presentation">
                                                        <p class="rr-preview-text">
                                                            <PreviewSpans spans={step.oldSpans} />
                                                        </p>
                                                    </div>
                                                    <p class="rr-preview-panel-title">{t("preview.after")}</p>
                                                    <div class="rr-preview-panel" role="presentation">
                                                        <p class="rr-preview-text">
                                                            <PreviewSpans spans={step.newSpans} />
                                                        </p>
                                                    </div>
                                                </div>
                                            </details>
                                        {/each}
                                    </div>
                                </div>
                            </div>
                        </details>
                    {/each}
                </div>
                {#if previewFilterNeedle !== "" && displayPreviews.length === 0}
                    <p class="rr-hint">{t("preview.filter.empty")}</p>
                {/if}
            {/if}
            <!-- * Always rendered (also without entries) — otherwise a group with
                 no test case has no way to create its first one. -->
            <button
                type="button"
                class="rr-section rr-add-skeleton rr-skeleton-item-padding"
                aria-label={t("rules.addPreview")}
                title={t("rules.addPreview")}
                onclick={addPreview}
            >
                <span class="rr-add-skeleton-content">
                    <Icon name="add" />
                    {t("rules.addPreview")}
                </span>
            </button>
        </section>
    {/if}
{/if}
