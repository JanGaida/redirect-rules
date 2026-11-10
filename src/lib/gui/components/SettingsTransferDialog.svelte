<script lang="ts">
    /**
     * SettingsTransferDialog — full backup/merge/replace workflow in one native
     * `<dialog>` (dashboard context; App owns the tab).
     *
     * * Export mode: one current-value column, all units selected by default;
     *   Apply builds the v1 envelope and downloads it.
     * * Import mode: merge (default) or replace (only complete+valid files).
     * * No store mutation here — `current` comes from SystemTab, `onapply`
     *   hands the next Settings object back (SystemTab does replace + flush).
     * * Invalid imported units are visible but not selectable; export marks
     *   incomplete live units but keeps them selectable (raw backup).
     */
    import { tick } from "svelte";
    import { resolveLocale, t, tPlural } from "../i18n.svelte";
    import { store } from "../../stores/settings.svelte";
    import type { Settings } from "../../core/settings";
    import {
        applyMerge,
        applyReplace,
        buildExportEnvelope,
        defaultMergeSelection,
        diffTransfer,
        isFullAndValid,
        type ParsedTransfer,
        type TransferErrorCode,
        type TransferProblem,
        type TransferSelection,
    } from "../../core/settings-transfer";
    import { createLogger } from "../../core/log";

    const log = createLogger("transfer");
    import {
        allSelectableSelection,
        buildExportRows,
        buildFieldSections,
        buildMergeRows,
        checkState,
        emptySelection,
        fieldKey,
        filterFieldRows,
        filterGroupRows,
        fullExportSelection,
        groupCheckState,
        groupParentDisabled,
        groupUnitCounts,
        isApplyDisabled,
        isFieldSelected,
        isRuleSelected,
        metaKey,
        ruleCheckboxDisabled,
        ruleKey,
        sectionCheckState,
        selectedUnitCount,
        selectionHasInvalid,
        toggleField,
        toggleFieldSection,
        toggleGroup,
        toggleGroupRule,
        type FieldRow,
        type GroupRow,
        type RuleRow,
        type TransferRows,
    } from "../settings-transfer-view";
    import { downloadJson, exportFilename } from "../download";
    import Icon from "./Icon.svelte";

    interface Props {
        mode: "export" | "import";
        current: Settings;
        parsed: ParsedTransfer | null;
        fileName: string;
        error: TransferErrorCode | "read" | null;
        onclose: () => void;
        onapply: (next: Settings, kind: "merge" | "replace") => void;
    }

    let { mode, current, parsed, fileName, error, onclose, onapply }: Props = $props();

    let dialogEl = $state<HTMLDialogElement | null>(null);
    let importMode = $state<"merge" | "replace">("merge");
    let onlyDifferences = $state(true);
    let openSections = $state<Record<string, boolean>>({
        general: false,
        appearance: false,
        advanced: false,
        rules: false,
    });
    let openGroups = $state<Record<string, boolean>>({});

    // svelte-ignore state_referenced_locally
    let selection = $state<TransferSelection>(
        mode === "export"
            ? fullExportSelection(current)
            : parsed !== null
              ? defaultMergeSelection(diffTransfer(current, parsed))
              : emptySelection(),
    );

    // * Units the user has seen selected at least once stay visible in the
    //   "only differences" filter even after unchecking them.
    let touched = $state<Record<string, boolean>>({});
    // svelte-ignore state_referenced_locally
    for (const field of selection.fields) touched[fieldKey(field)] = true;
    // svelte-ignore state_referenced_locally
    for (const group of selection.groups) {
        if (group.meta) touched[metaKey(group.groupIndex)] = true;
        for (const ruleIndex of group.rules) touched[ruleKey(group.groupIndex, ruleIndex)] = true;
    }

    const isTouched = (key: string): boolean => touched[key] === true;

    const diff = $derived(parsed !== null ? diffTransfer(current, parsed) : null);
    const mergeRows = $derived(diff !== null ? buildMergeRows(current, diff, t) : null);
    const exportRows = $derived(buildExportRows(current, t));
    const rows: TransferRows | null = $derived(mode === "export" ? exportRows : mergeRows);

    const replaceAllowed = $derived(parsed !== null && isFullAndValid(parsed));
    const onlyDiffActive = $derived(mode === "import" && importMode === "merge" && onlyDifferences);
    const showSelection = $derived(mode === "export" || importMode === "merge");
    const hasHeadNotes = $derived(mode === "import" && rows !== null && (!replaceAllowed || importMode === "merge"));

    $effect(() => {
        if (!replaceAllowed) importMode = "merge";
    });

    const fieldSections = $derived(rows !== null ? buildFieldSections(rows.fields, t) : []);
    const filteredGroups = $derived(
        rows !== null ? filterGroupRows(rows.groups, selection, onlyDiffActive, isTouched) : [],
    );
    const currentOnlyGroups = $derived(
        mode === "import" && !onlyDiffActive && rows !== null ? rows.currentOnlyGroups : [],
    );

    const groupCount = $derived(rows?.groups.length ?? 0);
    const ruleCount = $derived(rows?.groups.reduce((sum, group) => sum + group.rules.length, 0) ?? 0);
    const testCount = $derived(
        rows?.groups.reduce((sum, group) => sum + (group.meta?.importedTests ?? group.meta?.currentTests ?? 0), 0) ?? 0,
    );

    const selectedUnits = $derived(rows !== null ? selectedUnitCount(rows, selection) : 0);
    const rulesParentState = $derived.by(() => {
        let total = 0;
        let selected = 0;
        for (const { group, rules, metaVisible } of filteredGroups) {
            const counts = groupUnitCounts(group, selection, rules, metaVisible);
            total += counts.total;
            selected += counts.selected;
        }
        return checkState(selected, total);
    });
    const exportInvalid = $derived(mode === "export" && rows !== null && selectionHasInvalid(rows, selection));

    const errorKey = $derived(
        error === "unsupportedVersion"
            ? "transfer.error.unsupportedVersion"
            : error === "read"
              ? "transfer.error.read"
              : "transfer.error.parse",
    );

    const applyDisabled = $derived(
        isApplyDisabled({
            mode,
            importMode,
            hasError: error !== null,
            parsed: parsed !== null,
            replaceAllowed,
            selectedUnits,
        }),
    );

    const applyLabel = $derived.by(() => {
        if (mode === "export") return t("transfer.apply");
        if (importMode === "replace") return t("transfer.applyReplace");
        return t("transfer.applyMerge", { n: selectedUnits });
    });

    function indeterminate(node: HTMLInputElement, value: boolean): { update: (next: boolean) => void } {
        node.indeterminate = value;
        return {
            update(next: boolean): void {
                node.indeterminate = next;
            },
        };
    }

    function problemText(problem: TransferProblem | undefined): string {
        return problem === undefined ? "" : t(`transfer.invalid.${problem}`);
    }

    function importedDate(): string {
        if (parsed?.exportedAt === undefined) return "—";
        try {
            return new Intl.DateTimeFormat(resolveLocale(store.settings.locale), {
                dateStyle: "medium",
                timeStyle: "short",
            }).format(new Date(parsed.exportedAt));
        } catch {
            return parsed.exportedAt;
        }
    }

    function toggleSection(id: string): void {
        openSections[id] = !openSections[id];
    }

    function toggleGroupOpen(key: string): void {
        openGroups[key] = !(openGroups[key] ?? false);
    }

    function markGroup(group: GroupRow): void {
        if (group.meta !== undefined) touched[metaKey(group.groupIndex)] = true;
        for (const rule of group.rules) touched[ruleKey(group.groupIndex, rule.ruleIndex)] = true;
    }

    function markAll(): void {
        if (rows === null) return;
        for (const field of rows.fields) touched[fieldKey(field.field)] = true;
        for (const group of rows.groups) markGroup(group);
    }

    function selectAll(): void {
        if (rows === null) return;
        markAll();
        selection = mode === "export" ? fullExportSelection(current) : allSelectableSelection(rows);
    }

    function selectNone(): void {
        markAll();
        selection = emptySelection();
    }

    function toggleSectionAll(rowsToToggle: FieldRow[], checked: boolean): void {
        for (const row of rowsToToggle) touched[fieldKey(row.field)] = true;
        selection = toggleFieldSection(selection, rowsToToggle, checked);
    }

    function toggleFieldRow(row: FieldRow, checked: boolean): void {
        touched[fieldKey(row.field)] = true;
        selection = toggleField(selection, row.field, checked);
    }

    function toggleGroupAll(group: GroupRow, checked: boolean): void {
        markGroup(group);
        selection = toggleGroup(selection, group, checked);
    }

    function toggleRulesSection(checked: boolean): void {
        if (rows === null) return;
        for (const group of rows.groups) {
            markGroup(group);
            selection = toggleGroup(selection, group, checked);
        }
    }

    function toggleRule(group: GroupRow, rule: RuleRow, checked: boolean): void {
        touched[ruleKey(group.groupIndex, rule.ruleIndex)] = true;
        selection = toggleGroupRule(selection, group, rule.ruleIndex, checked);
    }

    function apply(): void {
        if (applyDisabled) return;
        if (mode === "export") {
            const exported = buildExportEnvelope(current, selection, {
                appVersion: GM_info.script.version,
                exportedAt: new Date().toISOString(),
            });
            const fileName = exportFilename(exported.partial ? "partial" : "full");
            log.debug("transfer exported", { fileName, partial: exported.partial });
            downloadJson(fileName, exported);
            onclose();
            return;
        }
        if (parsed === null) return;
        if (importMode === "replace") {
            const next = applyReplace(parsed);
            if (next !== null) {
                log.debug("transfer import prepared", { kind: "replace", groups: next.rules.length });
                onapply(next, "replace");
            }
            return;
        }
        const merged = applyMerge(current, parsed, selection);
        log.debug("transfer import prepared", { kind: "merge", groups: merged.rules.length });
        onapply(merged, "merge");
    }

    function close(): void {
        log.debug("transfer closed", { mode, error });
        onclose();
    }

    $effect(() => {
        const dialog = dialogEl;
        if (dialog === null) return;
        if (!dialog.open) dialog.showModal();
        void tick().then(() => {
            const target =
                dialog.querySelector<HTMLElement>("[data-autofocus]") ??
                dialog.querySelector<HTMLElement>(".rr-transfer-section-toggle") ??
                dialog.querySelector<HTMLElement>(".rr-transfer-close");
            target?.focus();
        });
        return () => {
            if (dialog.open) dialog.close();
        };
    });

    // * Keep the dialog's accessible name in sync with the mode.
    const title = $derived(mode === "export" ? t("transfer.title.export") : t("transfer.title.import"));
</script>

<dialog
    bind:this={dialogEl}
    class="rr-transfer-dialog"
    class:rr-transfer-dialog--export={mode === "export"}
    aria-labelledby="rr-transfer-title"
    oncancel={(event) => {
        event.preventDefault();
        close();
    }}
>
    <div class="rr-transfer-head" class:rr-transfer-head--noted={hasHeadNotes}>
        <div class="rr-transfer-head-text">
            <h2 id="rr-transfer-title" class="rr-transfer-title">{title}</h2>
            {#if fileName}
                <p class="rr-transfer-meta">
                    {t("transfer.file")}: <strong>{fileName}</strong>
                    {#if mode === "import" && parsed?.exportedAt}
                        · {t("transfer.exportedAt")}: {importedDate()}
                    {/if}
                </p>
            {/if}
            {#if error === null && rows !== null}
                <p class="rr-transfer-summary">
                    {tPlural("transfer.summary.groups", groupCount)}
                    · {tPlural("transfer.summary.rules", ruleCount)}
                    · {tPlural("transfer.summary.tests", testCount)}
                </p>
            {/if}
        </div>
        {#if hasHeadNotes}
            <div class="rr-transfer-head-notes">
                {#if mode === "import" && rows !== null && !replaceAllowed}
                    <p class="rr-transfer-head-note rr-transfer-head-note--warn">
                        <Icon name="warning" />
                        <span>{t("transfer.mode.partialHint")}</span>
                    </p>
                {/if}
                {#if mode === "import" && rows !== null && importMode === "merge"}
                    <p class="rr-transfer-head-note">
                        <Icon name="info" />
                        <span>{t("transfer.unchangedHint")}</span>
                    </p>
                {/if}
            </div>
        {/if}
        <button
            class="rr-btn rr-btn--close rr-transfer-close"
            type="button"
            aria-label={t("transfer.close")}
            title={t("transfer.close")}
            onclick={close}
        >
            <Icon name="close" />
        </button>
    </div>

    <div class="rr-transfer-body">
        {#if error !== null}
            <div class="rr-transfer-error" role="alert">
                <Icon name="error" />
                <p>{t(errorKey)}</p>
            </div>
        {:else if rows === null}
            <div class="rr-transfer-error" role="alert">
                <Icon name="error" />
                <p>{t("transfer.error.parse")}</p>
            </div>
        {:else}
            {#if mode === "import"}
                {#if replaceAllowed}
                    <fieldset class="rr-choice rr-choice--segmented rr-transfer-modes">
                        <legend class="rr-choice-label">{t("transfer.mode.label")}</legend>
                        <div class="rr-choice-options">
                            <label class="rr-choice-option">
                                <input
                                    class="rr-choice-input"
                                    type="radio"
                                    name="rr-transfer-mode"
                                    checked={importMode === "merge"}
                                    data-autofocus=""
                                    onchange={() => (importMode = "merge")}
                                />
                                <span class="rr-choice-surface">{t("transfer.mode.merge")}</span>
                            </label>
                            <label class="rr-choice-option">
                                <input
                                    class="rr-choice-input"
                                    type="radio"
                                    name="rr-transfer-mode"
                                    checked={importMode === "replace"}
                                    onchange={() => (importMode = "replace")}
                                />
                                <span class="rr-choice-surface">{t("transfer.mode.replace")}</span>
                            </label>
                        </div>
                        <p class="rr-hint">{t("transfer.mode.replaceHint")}</p>
                    </fieldset>

                    {#if importMode === "replace"}
                        <p class="rr-transfer-warning" role="alert">{t("transfer.replaceWarning")}</p>
                    {/if}
                {/if}
            {/if}

            <div class="rr-transfer-toolbar">
                <div class="rr-transfer-toolbar-actions">
                    {#if mode === "import" && importMode === "merge"}
                        <button
                            class="rr-btn rr-btn--visibility rr-transfer-icon-btn"
                            type="button"
                            aria-pressed={onlyDifferences}
                            aria-label={t("transfer.onlyDifferences")}
                            title={t("transfer.onlyDifferences")}
                            onclick={() => (onlyDifferences = !onlyDifferences)}
                        >
                            <Icon name={onlyDifferences ? "visibility" : "visibilityOff"} />
                        </button>
                    {/if}
                    <button class="rr-btn" type="button" onclick={selectAll}>
                        <Icon name="selectAll" />
                        {t("transfer.selectAll")}
                    </button>
                    <button class="rr-btn" type="button" onclick={selectNone}>
                        <Icon name="deselect" />
                        {t("transfer.selectNone")}
                    </button>
                </div>
            </div>

            {#if exportInvalid}
                <p class="rr-transfer-note rr-transfer-note--warn">{t("transfer.export.invalidHint")}</p>
            {/if}

            <div class="rr-transfer-columns">
                <span></span>
                <span></span>
                <span>{t("transfer.column.current")}</span>
                {#if mode === "import"}
                    <span>{t("transfer.column.imported")}</span>
                {/if}
            </div>

            {#each fieldSections as section (section.id)}
                {@const visibleFields = filterFieldRows(section.fields, selection, onlyDiffActive, isTouched)}
                {@const parentState = sectionCheckState(visibleFields, selection)}
                {#if !onlyDiffActive || visibleFields.length > 0}
                    <section class="rr-transfer-section">
                        <div class="rr-transfer-section-head">
                            {#if showSelection}
                                <label class="rr-transfer-check-hit">
                                    <input
                                        class="rr-transfer-check"
                                        type="checkbox"
                                        checked={parentState === "checked"}
                                        use:indeterminate={parentState === "indeterminate"}
                                        aria-label={`${section.label}: ${t("transfer.section.parentLabel")}`}
                                        onchange={(event) =>
                                            toggleSectionAll(section.fields, event.currentTarget.checked)}
                                    />
                                </label>
                            {:else}
                                <span class="rr-transfer-check-placeholder"></span>
                            {/if}
                            <button
                                class="rr-transfer-section-toggle"
                                type="button"
                                aria-expanded={openSections[section.id] ?? false}
                                onclick={() => toggleSection(section.id)}
                            >
                                <Icon
                                    name="chevronRight"
                                    class="rr-transfer-tri {(openSections[section.id] ?? false)
                                        ? 'rr-transfer-tri--open'
                                        : ''}"
                                />
                                <span class="rr-transfer-section-label">{section.label}</span>
                            </button>
                        </div>
                        {#if openSections[section.id] ?? false}
                            <div class="rr-transfer-rows">
                                {#each visibleFields as row (row.field)}
                                    <div class="rr-transfer-row" class:rr-transfer-row--invalid={!row.valid}>
                                        {#if showSelection}
                                            <label class="rr-transfer-check-hit">
                                                <input
                                                    class="rr-transfer-check"
                                                    type="checkbox"
                                                    checked={isFieldSelected(selection, row.field)}
                                                    disabled={mode === "import" && (!row.present || !row.valid)}
                                                    aria-label={row.label}
                                                    onchange={(event) =>
                                                        toggleFieldRow(row, event.currentTarget.checked)}
                                                />
                                            </label>
                                        {:else}
                                            <span class="rr-transfer-check-placeholder"></span>
                                        {/if}
                                        <span class="rr-transfer-row-label">
                                            {row.label}
                                            {#if !row.valid}
                                                <span
                                                    class="rr-transfer-problem"
                                                    role="img"
                                                    aria-label={problemText(row.problem)}
                                                    title={problemText(row.problem)}
                                                >
                                                    <Icon name="dataInfoAlert" />
                                                </span>
                                            {/if}
                                        </span>
                                        <span class="rr-transfer-value" data-label={t("transfer.column.current")}>
                                            {row.current}
                                        </span>
                                        {#if mode === "import"}
                                            <span
                                                class="rr-transfer-value rr-transfer-value--imported"
                                                data-label={t("transfer.column.imported")}
                                                class:rr-transfer-value--changed={row.present && !row.equal}
                                                class:rr-transfer-value--new={!row.present}
                                            >
                                                {#if row.present}
                                                    {row.imported}
                                                {:else}
                                                    <span class="rr-transfer-muted">{t("transfer.value.stays")}</span>
                                                {/if}
                                            </span>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </section>
                {/if}
            {/each}

            <section class="rr-transfer-section">
                <div class="rr-transfer-section-head">
                    {#if showSelection}
                        <label class="rr-transfer-check-hit">
                            <input
                                class="rr-transfer-check"
                                type="checkbox"
                                checked={rulesParentState === "checked"}
                                use:indeterminate={rulesParentState === "indeterminate"}
                                aria-label={`${t("transfer.group.rules")}: ${t("transfer.section.parentLabel")}`}
                                onchange={(event) => toggleRulesSection(event.currentTarget.checked)}
                            />
                        </label>
                    {:else}
                        <span class="rr-transfer-check-placeholder"></span>
                    {/if}
                    <button
                        class="rr-transfer-section-toggle"
                        type="button"
                        aria-expanded={openSections.rules ?? false}
                        onclick={() => toggleSection("rules")}
                    >
                        <Icon
                            name="chevronRight"
                            class="rr-transfer-tri {(openSections.rules ?? false) ? 'rr-transfer-tri--open' : ''}"
                        />
                        <span class="rr-transfer-section-label">{t("transfer.group.rules")}</span>
                    </button>
                </div>

                {#if openSections.rules ?? false}
                    <div class="rr-transfer-rows">
                        {#each filteredGroups as { group, rules, metaVisible } (group.key)}
                            {@const parentState = groupCheckState(group, selection, rules, metaVisible)}
                            {@const parentDisabled = mode === "export" ? false : groupParentDisabled(group)}
                            <div class="rr-transfer-group">
                                <div class="rr-transfer-group-head">
                                    {#if showSelection}
                                        <label class="rr-transfer-check-hit">
                                            <input
                                                class="rr-transfer-check"
                                                type="checkbox"
                                                checked={parentState === "checked"}
                                                use:indeterminate={parentState === "indeterminate"}
                                                disabled={parentDisabled}
                                                aria-label={`${group.caption} (${group.siteRegex}): ${t("transfer.group.parentLabel")}`}
                                                onchange={(event) => toggleGroupAll(group, event.currentTarget.checked)}
                                            />
                                        </label>
                                    {:else}
                                        <span class="rr-transfer-check-placeholder"></span>
                                    {/if}
                                    <button
                                        class="rr-transfer-group-toggle"
                                        type="button"
                                        aria-expanded={openGroups[group.key] ?? false}
                                        onclick={() => toggleGroupOpen(group.key)}
                                    >
                                        <Icon
                                            name="chevronRight"
                                            class="rr-transfer-tri {(openGroups[group.key] ?? false)
                                                ? 'rr-transfer-tri--open'
                                                : ''}"
                                        />
                                        <span class="rr-transfer-group-caption">{group.caption}</span>
                                        <code class="rr-transfer-gate">{group.siteRegex}</code>
                                    </button>
                                    {#if group.isNew}
                                        <span class="rr-transfer-badge">{t("transfer.group.new")}</span>
                                    {/if}
                                    <span class="rr-transfer-group-meta">
                                        {tPlural("transfer.summary.rules", group.rules.length)}
                                        · {tPlural(
                                            "transfer.summary.tests",
                                            group.meta?.importedTests ?? group.meta?.currentTests ?? 0,
                                        )}
                                    </span>
                                    {#if group.problem}
                                        <span class="rr-transfer-problem" title={problemText(group.problem)}>
                                            {problemText(group.problem)}
                                        </span>
                                    {/if}
                                </div>

                                {#if openGroups[group.key] ?? false}
                                    <div class="rr-transfer-group-body">
                                        {#if group.meta}
                                            <div
                                                class="rr-transfer-row rr-transfer-row--meta"
                                                class:rr-transfer-row--invalid={!group.meta.valid}
                                            >
                                                <span class="rr-transfer-check-placeholder"></span>
                                                <span class="rr-transfer-row-label">
                                                    {t("transfer.group.meta")}
                                                    {#if !group.meta.valid}
                                                        <span
                                                            class="rr-transfer-problem"
                                                            role="img"
                                                            aria-label={problemText(group.meta.problem)}
                                                            title={problemText(group.meta.problem)}
                                                        >
                                                            <Icon name="dataInfoAlert" />
                                                        </span>
                                                    {/if}
                                                </span>
                                                <span
                                                    class="rr-transfer-value"
                                                    data-label={t("transfer.column.current")}
                                                >
                                                    {group.meta.currentDescription || "—"}
                                                    <span class="rr-transfer-muted">
                                                        ({tPlural("transfer.summary.tests", group.meta.currentTests)}) · {t(
                                                            group.meta.currentDisabled
                                                                ? "transfer.meta.disabled"
                                                                : "transfer.meta.enabled",
                                                        )}
                                                    </span>
                                                </span>
                                                {#if mode === "import"}
                                                    <span
                                                        class="rr-transfer-value rr-transfer-value--imported"
                                                        data-label={t("transfer.column.imported")}
                                                        class:rr-transfer-value--changed={!group.meta.equal}
                                                        class:rr-transfer-value--new={group.isNew}
                                                    >
                                                        {#if group.meta.importedDescription !== undefined || group.meta.importedTests !== undefined}
                                                            {group.meta.importedDescription ?? "—"}
                                                            <span class="rr-transfer-muted">
                                                                ({tPlural(
                                                                    "transfer.summary.tests",
                                                                    group.meta.importedTests ?? 0,
                                                                )}){#if group.meta.importedDisabled !== undefined}
                                                                    · {t(
                                                                        group.meta.importedDisabled
                                                                            ? "transfer.meta.disabled"
                                                                            : "transfer.meta.enabled",
                                                                    )}{/if}
                                                            </span>
                                                        {:else}
                                                            <span class="rr-transfer-muted"
                                                                >{t("transfer.value.stays")}</span
                                                            >
                                                        {/if}
                                                    </span>
                                                {/if}
                                            </div>
                                        {/if}

                                        {#each rules as rule (rule.ruleIndex)}
                                            <div
                                                class="rr-transfer-row rr-transfer-row--rule"
                                                class:rr-transfer-row--invalid={!rule.valid}
                                            >
                                                {#if showSelection}
                                                    <label class="rr-transfer-check-hit">
                                                        <input
                                                            class="rr-transfer-check"
                                                            type="checkbox"
                                                            checked={isRuleSelected(
                                                                selection,
                                                                group.groupIndex,
                                                                rule.ruleIndex,
                                                            )}
                                                            disabled={mode === "export"
                                                                ? false
                                                                : ruleCheckboxDisabled(group, selection, rule)}
                                                            aria-label={`${group.caption}: ${rule.indexLabel} ${rule.kindLabel}`}
                                                            onchange={(event) =>
                                                                toggleRule(group, rule, event.currentTarget.checked)}
                                                        />
                                                    </label>
                                                {:else}
                                                    <span class="rr-transfer-check-placeholder"></span>
                                                {/if}
                                                <span class="rr-transfer-row-label">
                                                    <span class="rr-transfer-index">{rule.indexLabel}</span>
                                                    <span class="rr-transfer-kind">{rule.kindLabel}</span>
                                                    {#if !rule.valid}
                                                        <span
                                                            class="rr-transfer-problem"
                                                            role="img"
                                                            aria-label={problemText(rule.problem)}
                                                            title={problemText(rule.problem)}
                                                        >
                                                            <Icon name="dataInfoAlert" />
                                                        </span>
                                                    {/if}
                                                </span>
                                                <span
                                                    class="rr-transfer-value"
                                                    data-label={t("transfer.column.current")}
                                                >
                                                    {rule.current ?? t("transfer.value.empty")}
                                                </span>
                                                {#if mode === "import"}
                                                    <span
                                                        class="rr-transfer-value rr-transfer-value--imported"
                                                        data-label={t("transfer.column.imported")}
                                                        class:rr-transfer-value--changed={!rule.equal && rule.valid}
                                                        class:rr-transfer-value--new={rule.isNew && rule.valid}
                                                    >
                                                        {rule.imported ?? t("transfer.value.empty")}
                                                    </span>
                                                {/if}
                                            </div>
                                        {/each}

                                        {#each group.currentOnlyRules as rule (rule.ruleIndex)}
                                            <div class="rr-transfer-row rr-transfer-row--stays">
                                                <span class="rr-transfer-check-placeholder"></span>
                                                <span class="rr-transfer-row-label">
                                                    <span class="rr-transfer-index">{rule.indexLabel}</span>
                                                </span>
                                                <span
                                                    class="rr-transfer-value"
                                                    data-label={t("transfer.column.current")}
                                                >
                                                    {rule.current}
                                                </span>
                                                {#if mode === "import"}
                                                    <span
                                                        class="rr-transfer-value rr-transfer-value--imported rr-transfer-muted"
                                                        data-label={t("transfer.column.imported")}
                                                    >
                                                        {t("transfer.value.stays")}
                                                    </span>
                                                {/if}
                                            </div>
                                        {/each}

                                        {#if rules.length === 0 && group.currentOnlyRules.length === 0 && !group.meta}
                                            <p class="rr-transfer-empty">{t("transfer.empty.noDifferences")}</p>
                                        {/if}
                                    </div>
                                {/if}
                            </div>
                        {/each}

                        {#each currentOnlyGroups as group (group.currentGroupIndex)}
                            <div class="rr-transfer-group rr-transfer-group--stays">
                                <div class="rr-transfer-group-head">
                                    <span class="rr-transfer-check-placeholder"></span>
                                    <span class="rr-transfer-group-caption">{group.caption}</span>
                                    <code class="rr-transfer-gate">{group.siteRegex}</code>
                                    <span class="rr-transfer-group-meta">
                                        {tPlural("transfer.summary.rules", group.ruleCount)}
                                        · {tPlural("transfer.summary.tests", group.testCount)}
                                    </span>
                                    <span class="rr-transfer-badge">{t("transfer.value.stays")}</span>
                                </div>
                            </div>
                        {/each}

                        {#if filteredGroups.length === 0 && currentOnlyGroups.length === 0}
                            <p class="rr-transfer-empty">{t("transfer.empty.noDifferences")}</p>
                        {/if}
                    </div>
                {/if}
            </section>
        {/if}
    </div>

    <footer class="rr-transfer-footer">
        <span class="rr-transfer-footer-hint">
            {#if error === null && selectedUnits === 0 && (mode === "export" || importMode === "merge")}
                {t("transfer.empty.noSelection")}
            {/if}
        </span>
        <div class="rr-transfer-footer-actions">
            <button class="rr-btn" type="button" onclick={close}>
                <Icon name="close" />
                {t("transfer.cancel")}
            </button>
            <button class="rr-btn rr-btn--danger" type="button" disabled={applyDisabled} onclick={apply}>
                <Icon name={mode === "export" ? "download" : "check"} />
                {applyLabel}
            </button>
        </div>
    </footer>
</dialog>
