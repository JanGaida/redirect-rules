<script lang="ts">
    /**
     * RulesTab — explorer with an inline rule editor | preview
     *
     * * TOP-LEFT (explorer): site-rule groups as `<details>` accordions in a
     *   SINGLE-OPEN accordion: ALL groups start folded,
     *   only ONE can be open at a time — unfolding binds the PREVIEW to that
     *   group. Opening a group no longer selects a rule.
     *   Site regex + rule rows (kind chip + number + label) + add actions.
     *   The Filter matches the readable site gate or ANY rule label.
     *   Site captions are READABLE: the gate resolved to its raw form
     *   (notation + escapes stripped). The gate FIELD carries the escape toggle
     *   (autoFixHigh: raw pasted URI ⇄ /…/-notation) and the manual info trigger
     *   in its trailing affix.
     * * RULE FOLD: every rule row is
     *   its own `<details>`; unfolding mounts the field part of the RuleEditor
     *   (`mode="fields"`) INLINE in `.rr-master-rules`. Selection == open —
     *   exactly ONE rule is unfolded at a time, opening selects it, closing
     *   clears it. New rules (add + assistant import link) open automatically.
     * * TOP-RIGHT (preview): the preview/chain part of the RuleEditor
     *   (`mode="preview"`) bound to the OPEN GROUP — one card: group URL row,
     *   per-step before/after, chain, reason. A chain-step click selects the
     *   rule, unfolds it in the explorer and scrolls it into view.
     * * The status line now lives in the App header; the reference triggers live
     *   in the field trailing affixes (anchored popovers). The LLM hand-off
     *   moved to its own tab.
     * * Grips: the vertical grip resizes the explorer width
     *   (--rr-explorer-w, 50/50 default); the horizontal grip resizes its height
     *   (--rr-explorer-h, 48vh default) in the stacked split. Session-local CSS
     *   vars (persistence deferred, see gui.md).
     * * Phone panes: ≤760px the split collapses into ONE visible pane behind a
     *   segmented switch; both panes stay mounted (visibility, never display).
     * * "Create new Rule" requests (menu entry at open time or forwarded to
     *   the already-open dashboard) prefill a new site rule gated on the url's
     *   host — request ids guard against double-prefill.
     */
    import { t } from "../i18n.svelte";
    import { showToast, UNDO_TOAST_MS } from "../ui-state.svelte";
    import { store } from "../../stores/settings.svelte";
    import { isValidRegex, isNotationRegex, escapeUriForRegex, regexToReadableLiteral } from "../../core/parse-regex";
    import { ruleLabel } from "../../core/preview";
    import { invalidRegexCount, isSiteIncomplete, siteHasInvalidRegex } from "../validation";
    import { moveIndex, remapIndex } from "../reorder";
    import { createListDrag, type DropTarget } from "../drag-controller";
    import Icon from "../components/Icon.svelte";

    import TextInput from "../components/TextInput.svelte";
    import RuleEditor from "../components/RuleEditor.svelte";
    import RegexManualReference from "../components/RegexManualReference.svelte";
    import RowActions from "../components/RowActions.svelte";
    import DragHandle from "../components/DragHandle.svelte";
    import InlineCaption from "../components/InlineCaption.svelte";
    import ChoiceGroup from "../components/ChoiceGroup.svelte";

    import type { SiteRule, UrlRule } from "../../core/settings";
    import type { IconName } from "../icon";
    import { onDestroy } from "svelte";
    import { flip } from "svelte/animate";
    import { siteCaption } from "../site-caption";
    import { motionFastDuration } from "../motion";
    import { createLogger } from "../../core/log";

    const log = createLogger("rules");

    interface Props {
        /** Create-rule request: null = none; a NEW object id = prefill now. */
        createRuleRequest: { id: number; url: string } | null;
        /** Reveal request from the assistant: a NEW object id = select now. */
        revealRuleRequest: { id: number; siteIndex: number; ruleIndex: number } | null;
    }

    let { createRuleRequest, revealRuleRequest }: Props = $props();

    // * Group-bound preview: test inputs live ON THE SITE GROUP as
    // `previewEntries` (persisted) — the preview binds to the OPEN group; the
    // editor dock binds to a single selected rule OF that group.
    // * Cached last selection (settings.lastSelection): restore on first open so
    //   the UI opens the previously opened/selected rule group.
    function validPersistedSelection(
        v: { siteIndex: number; ruleIndex: number } | undefined,
    ): v is { siteIndex: number; ruleIndex: number } {
        if (!v) return false;
        const site = store.settings.rules[v.siteIndex];
        return site !== undefined && site.rules[v.ruleIndex] !== undefined;
    }

    const persisted = store.settings.lastSelection;
    let openSite: number | null = $state(validPersistedSelection(persisted) ? persisted.siteIndex : null);
    let selection: { siteIndex: number; ruleIndex: number } | null = $state(
        validPersistedSelection(persisted) ? persisted : null,
    );

    // * Whole-tree replacement (import/replace, undo, remote adoption) swaps the
    //   rule list — a raw index may now point at a DIFFERENT rule. Undo restores
    //   the snapshot the user was looking at, so the OPEN GROUP is kept when it
    //   is still in bounds; every other swap clears both. Nothing is persisted
    //   here: the restored snapshot carries its own lastSelection.
    let seenGeneration = store.generation;
    $effect(() => {
        const generation = store.generation;
        if (generation === seenGeneration) return;
        seenGeneration = generation;
        const source = store.replacementSource;
        const previousOpenSite = openSite;
        if (source === "undo") {
            const openInBounds =
                previousOpenSite !== null && previousOpenSite >= 0 && previousOpenSite < store.settings.rules.length;
            if (openInBounds) {
                // * The rule tree changed under the open group — the row index is stale.
                selection = null;
                log.debug("undo replacement kept the open group", {
                    generation,
                    source,
                    openSite: previousOpenSite,
                });
                return;
            }
            const persistedSelection = store.settings.lastSelection;
            if (validPersistedSelection(persistedSelection)) {
                openSite = persistedSelection.siteIndex;
                selection = { siteIndex: persistedSelection.siteIndex, ruleIndex: persistedSelection.ruleIndex };
                log.debug("undo replacement restored the persisted selection", {
                    generation,
                    source,
                    openSite,
                    ruleIndex: selection.ruleIndex,
                });
                return;
            }
            openSite = null;
            selection = null;
            log.debug("undo replacement found no valid selection", { generation, source });
            return;
        }
        openSite = null;
        selection = null;
        log.debug("selection cleared after whole-tree replacement", {
            generation,
            source,
            openSite: previousOpenSite,
        });
    });

    // * Module scope: survives tab switches (remounts) so a request id is
    //   consumed exactly ONCE — otherwise every remount would prefill again.
    let lastConsumedRequest = -1;
    let lastConsumedReveal = -1;

    // * Explorer filter — trims to a needle, matched case-insensitively
    // against the VISIBLE labels (site gate + rule regex/params).
    let filter = $state("");

    // * Phone pane switch (≤760px): both panes stay mounted in one grid cell and
    //   only visibility flips — scroll position + editor state survive. The
    //   glyphs keep the two small segments identifiable on narrow phones.
    let pane = $state<"rules" | "preview">("rules");
    const paneOptions: Array<{ value: string; label: string; icon: IconName }> = $derived([
        { value: "rules", label: t("tabs.rules"), icon: "developerGuide" },
        { value: "preview", label: t("rules.pane.preview"), icon: "visibility" },
    ]);

    // * Inline description edit: the shared InlineCaption owns the
    // draft/focus cycle; the parent only tracks WHICH group is editing.
    let editingSite = $state<number | null>(null);

    // * Pointer reorder state (session only) — visual positions inside the
    //   rendered (filtered) lists; the controller owns the drag gesture.
    let masterEl = $state<HTMLElement | null>(null);
    let siteDragFrom = $state<number | null>(null);
    let siteDrop = $state<DropTarget | null>(null);
    let ruleDragFrom = $state<number | null>(null);
    let ruleDrop = $state<DropTarget | null>(null);

    // * FLIP animation duration follows the live motion setting (reactive
    //   mid-session), not a one-time CSS read.
    const motionFastMs = $derived(motionFastDuration(store.settings.motion));

    const indexedSites = $derived(store.settings.rules.map((site, si) => ({ site, si })));

    const displaySites = $derived.by(() => {
        const needle = filter.trim().toLowerCase();
        return indexedSites.filter(({ site }) => siteMatches(site, needle));
    });

    function reorderSites(from: number, to: number): void {
        if (from === to) return;
        log.debug("site rule reordered", { from, to });
        const rules = store.settings.rules;
        const [item] = rules.splice(from, 1);
        rules.splice(to, 0, item);
        if (openSite !== null) openSite = remapIndex(openSite, from, to);
        if (selection)
            selection = { siteIndex: remapIndex(selection.siteIndex, from, to), ruleIndex: selection.ruleIndex };
        rememberSelection(selection);
    }

    /** Keyboard reorder: mirrors the drop math with the next VISIBLE neighbor. */
    function moveSiteBy(si: number, delta: -1 | 1): void {
        const pos = displaySites.findIndex((entry) => entry.si === si);
        if (pos === -1) return;
        const targetEntry = displaySites[pos + delta];
        if (!targetEntry) return;
        const base = store.settings.rules.map((entry, index) => ({ entry, index }));
        const fromPos = base.findIndex((entry) => entry.index === si);
        const targetPos = base.findIndex((entry) => entry.index === targetEntry.si);
        if (fromPos === -1 || targetPos === -1) return;
        reorderSites(si, moveIndex(fromPos, targetPos, delta > 0, base.length));
    }

    // ── Rule-row DnD (within a single site group) ───────────────────────────
    function reorderRules(si: number, fromRi: number, toRi: number): void {
        if (fromRi === toRi) return;
        const site = store.settings.rules[si];
        if (!site) return;
        log.debug("rule reordered", { siteIndex: si, from: fromRi, to: toRi });
        const [item] = site.rules.splice(fromRi, 1);
        site.rules.splice(toRi, 0, item);
        if (selection && selection.siteIndex === si) {
            const ri = selection.ruleIndex;
            if (ri === fromRi) selection = { siteIndex: si, ruleIndex: toRi };
            else if (fromRi < ri && toRi >= ri) selection = { siteIndex: si, ruleIndex: ri - 1 };
            else if (fromRi > ri && toRi <= ri) selection = { siteIndex: si, ruleIndex: ri + 1 };
        }
        rememberSelection(selection);
    }

    /** Keyboard reorder within one site group (direct neighbor index). */
    function moveRuleBy(si: number, ri: number, delta: -1 | 1): void {
        const site = store.settings.rules[si];
        if (!site) return;
        const to = ri + delta;
        if (to < 0 || to >= site.rules.length) return;
        reorderRules(si, ri, to);
    }

    /** Site-list pointer drag: visual positions → raw indexes → `moveIndex`. */
    const siteDrag = createListDrag({
        getItems: () => Array.from(masterEl?.querySelectorAll<HTMLElement>(":scope > details.rr-master-site") ?? []),
        getAnchor: () => masterEl,
        onHover: (target) => (siteDrop = target),
        onDrop: (fromPos, target) => {
            const from = displaySites[fromPos];
            const to = displaySites[target.pos];
            if (!from || !to) return;
            const base = store.settings.rules.map((entry, index) => ({ entry, index }));
            const fromPosRaw = base.findIndex((entry) => entry.index === from.si);
            const targetPosRaw = base.findIndex((entry) => entry.index === to.si);
            if (fromPosRaw === -1 || targetPosRaw === -1) return;
            reorderSites(from.si, moveIndex(fromPosRaw, targetPosRaw, target.insertAfter, base.length));
        },
        onCancel: () => {},
        onEnd: () => {
            siteDragFrom = null;
            siteDrop = null;
        },
    });

    /** Rule-row pointer drag: rows of the OPEN group only. */
    const ruleDrag = createListDrag({
        getItems: () => {
            const open = masterEl?.querySelector<HTMLElement>("details.rr-master-site[open]");
            return Array.from(open?.querySelectorAll<HTMLElement>(".rr-master-rules > details.rr-master-rule") ?? []);
        },
        getAnchor: () => masterEl,
        onHover: (target) => (ruleDrop = target),
        onDrop: (fromPos, target) => {
            const si = openSite;
            if (si === null) return;
            const site = store.settings.rules[si];
            if (!site) return;
            const rules = displayRules(si);
            const from = rules[fromPos];
            const to = rules[target.pos];
            if (!from || !to) return;
            reorderRules(si, from.ri, moveIndex(from.ri, to.ri, target.insertAfter, site.rules.length));
        },
        onCancel: () => {},
        onEnd: () => {
            ruleDragFrom = null;
            ruleDrop = null;
        },
    });

    onDestroy(() => {
        siteDrag.destroy();
        ruleDrag.destroy();
    });

    function displayRules(si: number): { rule: UrlRule; ri: number }[] {
        const site = store.settings.rules[si];
        if (!site) return [];
        return site.rules.map((rule, ri) => ({ rule, ri }));
    }

    // ── Rule-row mutations (keep lock array in sync via the effect above) ─────
    function cloneRuleRow(si: number, ri: number): void {
        store.cloneRule(si, ri);
        if (selection && selection.siteIndex === si && selection.ruleIndex > ri) {
            selection = { siteIndex: si, ruleIndex: selection.ruleIndex + 1 };
        }
        rememberSelection(selection);
    }

    function removeRuleRow(si: number, ri: number): void {
        const site = store.settings.rules[si];
        const removed = site?.rules[ri];
        if (!site || removed === undefined) return;
        store.removeRule(si, ri);
        if (selection && selection.siteIndex === si) {
            if (selection.ruleIndex === ri) {
                selection =
                    site.rules.length === 0 ? null : { siteIndex: si, ruleIndex: Math.min(ri, site.rules.length - 1) };
            } else if (selection.ruleIndex > ri) {
                selection = { siteIndex: si, ruleIndex: selection.ruleIndex - 1 };
            }
        }
        rememberSelection(selection);
        showToast(t("common.delete.toast.rule"), {
            durationMs: UNDO_TOAST_MS,
            action: {
                label: t("common.undo"),
                run: () => {
                    const target = store.insertRule(si, ri, removed);
                    if (target < 0) {
                        showToast(t("common.delete.undoFailed"));
                        return;
                    }
                    openSite = si;
                    selection = { siteIndex: si, ruleIndex: target };
                    rememberSelection(selection);
                },
            },
        });
    }

    /**
     * Persists the selection for the next dashboard open — ONLY on explicit user
     * actions. An effect would re-write it right after an undo restored the
     * opening snapshot, making the restored state dirty again.
     */
    function rememberSelection(next: { siteIndex: number; ruleIndex: number } | null): void {
        if (next === null) {
            store.settings.lastSelection = undefined;
            return;
        }
        // * Never persist an index pair that no longer resolves (undo/clamp guard).
        const site = store.settings.rules[next.siteIndex];
        if (!site || site.rules[next.ruleIndex] === undefined) {
            store.settings.lastSelection = undefined;
            return;
        }
        store.settings.lastSelection = { siteIndex: next.siteIndex, ruleIndex: next.ruleIndex };
    }

    function createRuleFrom(url: string): void {
        const indexes = store.addSiteRuleFromUrl(url);
        if (!indexes) return;
        openSite = indexes.siteIndex;
        selection = indexes;
        rememberSelection(indexes);
    }

    // * The initial request (dashboard opened via "Create new Rule") arrives as
    // a prop; forwarded requests (second menu click) update the same prop.
    $effect(() => {
        if (createRuleRequest && createRuleRequest.id !== lastConsumedRequest) {
            lastConsumedRequest = createRuleRequest.id;
            createRuleFrom(createRuleRequest.url);
        }
    });

    // * Assistant import link: reveal the rule once, after validating the indexes
    // (a remote edit may have removed them between import and click).
    $effect(() => {
        if (!revealRuleRequest || revealRuleRequest.id === lastConsumedReveal) return;
        lastConsumedReveal = revealRuleRequest.id;
        const site = store.settings.rules[revealRuleRequest.siteIndex];
        if (!site || site.rules[revealRuleRequest.ruleIndex] === undefined) return;
        selectRule(revealRuleRequest.siteIndex, revealRuleRequest.ruleIndex);
    });

    const invalidCount = $derived(invalidRegexCount(store.settings));

    function siteInvalid(siteRegex: string): boolean {
        return siteRegex !== "" && !isValidRegex(siteRegex);
    }

    /**
     * Commits the trimmed caption draft. An empty value removes the property
     * (the caption then falls back to the readable site regex).
     */
    function commitSiteDescription(si: number, value: string): void {
        const site = store.settings.rules[si];
        if (!site) return;
        const next = value.trim();
        if (next === "") delete site.description;
        else site.description = next;
        log.debug("site description committed", { siteIndex: si, empty: next === "" });
    }

    /**
     * Escape toggle at the site gate: raw pasted
     * URI ⇄ `/…/`-escaped notation. Notation → unescape (readable form);
     * plain → escape (`escapeUriForRegex`). Empty gates never toggle.
     */
    function toggleEscape(si: number): void {
        const site = store.settings.rules[si];
        if (!site || site.siteRegex === "") return;
        const notation = isNotationRegex(site.siteRegex);
        site.siteRegex = notation ? regexToReadableLiteral(site.siteRegex) : escapeUriForRegex(site.siteRegex);
        log.debug("site gate notation toggled", { siteIndex: si, toNotation: !notation });
    }

    /** Filter predicate — visible caption, readable regex, or any rule label matches. */
    function siteMatches(site: SiteRule, needle: string): boolean {
        if (needle === "") return true;
        // * Matches what the user SEES: the caption (description or
        // readable gate). The regex stays searchable even when described.
        if (siteCaption(site).toLowerCase().includes(needle)) return true;
        if (regexToReadableLiteral(site.siteRegex).toLowerCase().includes(needle)) return true;
        return site.rules.some((rule) => ruleSearchText(rule).toLowerCase().includes(needle));
    }

    /** Compact rule label for the explorer row — regex only. */
    function ruleLabelText(rule: UrlRule): string {
        return ruleLabel(rule) || "—";
    }

    /** The filter's matching basis — the visible label content. */
    function ruleSearchText(rule: UrlRule): string {
        if (rule.kind === "replace") return rule.regex ?? "";
        if (rule.kind === "appendQuery") return rule.params ?? "";
        if (rule.kind === "removeQuery") return rule.keys;
        return rule.regex ?? "";
    }

    /**
     * Selects a rule — selection IS the unfolded row. Used by rule-row
     * toggles and preview chain steps; a chain-step click also scrolls the row
     * into view. On phones the explorer pane may be hidden, so it flips back to
     * "rules" and focuses the row; desktop never steals focus.
     */
    function selectRule(siteIndex: number, ruleIndex: number): void {
        const changed = !selection || selection.siteIndex !== siteIndex || selection.ruleIndex !== ruleIndex;
        if (changed) log.debug("rule selected", { siteIndex, ruleIndex });
        openSite = siteIndex;
        selection = { siteIndex, ruleIndex };
        if (changed) rememberSelection(selection);
        // * Only the phone pane switch hides the explorer; the desktop layout
        //   keeps it visible, so this branch never fires there.
        const paneHidden = masterEl !== null && getComputedStyle(masterEl).visibility === "hidden";
        if (paneHidden) pane = "rules";
        requestAnimationFrame(() => {
            if (paneHidden) {
                layoutEl
                    ?.querySelector<HTMLElement>(
                        `.rr-master-rule[data-site="${siteIndex}"][data-rule="${ruleIndex}"] > summary`,
                    )
                    ?.focus({ preventScroll: true });
            }
            scrollRuleIntoView(siteIndex, ruleIndex);
        });
    }

    /** Opens the inline editor row inside the explorer's own scroll container. */
    function scrollRuleIntoView(siteIndex: number, ruleIndex: number): void {
        const el = layoutEl?.querySelector<HTMLElement>(
            `.rr-master-rule[data-site="${siteIndex}"][data-rule="${ruleIndex}"]`,
        );
        el?.scrollIntoView({ block: "nearest" });
    }

    /**
     * Controlled rule-row toggle. State-driven closes of OTHER rows fire a
     * `toggle` too — the selection guard keeps them from clearing the freshly
     * opened selection (single-open feedback loop).
     */
    function onRuleToggle(si: number, ri: number, event: Event): void {
        const el = event.currentTarget as HTMLDetailsElement;
        if (el.open) {
            if (selection && selection.siteIndex === si && selection.ruleIndex === ri) return;
            log.debug("rule unfolded", { siteIndex: si, ruleIndex: ri });
            selection = { siteIndex: si, ruleIndex: ri };
            rememberSelection(selection);
            return;
        }
        if (selection && selection.siteIndex === si && selection.ruleIndex === ri) {
            log.debug("rule folded", { siteIndex: si, ruleIndex: ri });
            selection = null;
            rememberSelection(null);
        }
    }

    /** Adds a rule and opens it immediately (inline-editor affordance). */
    function addRuleRow(si: number): void {
        store.addRule(si);
        const rules = store.settings.rules[si]?.rules;
        if (!rules || rules.length === 0) return;
        selectRule(si, rules.length - 1);
    }

    /**
     * Controlled `<details>` toggle — the native element owns the open state,
     * the app mirrors it (single-open). Opening does NOT select a rule: the
     * rule fold is an explicit second step. Closing drops any selection inside
     * that group.
     */
    function onSiteToggle(si: number, event: Event): void {
        const el = event.currentTarget as HTMLDetailsElement;
        if (el.open) {
            log.debug("site rule unfolded", { siteIndex: si });
            openSite = si;
            if (selection && selection.siteIndex !== si) {
                selection = null;
                rememberSelection(null);
            }
            return;
        }
        if (openSite === si) {
            log.debug("site rule folded", { siteIndex: si });
            openSite = null;
            selection = null;
            rememberSelection(null);
        }
    }

    // ── Explorer accordion (single-open) ─────────────────────────────────────

    /**
     * `<details>` toggle — the SINGLE-OPEN accordion's source of truth: opening
     * a group makes it the ONLY open one (the preview binds to it) but does NOT
     * select a rule; closing it clears group + rule selection.
     * State-driven closes of OTHER groups never land in the close branch
     * (openSite already points elsewhere) — no feedback loop.
     */
    // * Native <details> toggling is disabled; open state lives in `openSite`.

    // ── Site-list mutations — keep openSite/selection index-valid ───────────

    function removeSite(si: number): void {
        const removed = store.settings.rules[si];
        if (removed === undefined) return;
        const wasOpen = openSite === si;
        store.removeSiteRule(si);
        if (openSite === si) {
            openSite = null;
            selection = null;
        } else {
            if (openSite !== null && openSite > si) openSite -= 1;
            if (selection) {
                if (selection.siteIndex === si) selection = null;
                else if (selection.siteIndex > si)
                    selection = { siteIndex: selection.siteIndex - 1, ruleIndex: selection.ruleIndex };
            }
        }
        rememberSelection(selection);
        showToast(t("common.delete.toast.site"), {
            durationMs: UNDO_TOAST_MS,
            action: {
                label: t("common.undo"),
                run: () => {
                    const target = store.insertSiteRule(si, removed);
                    if (wasOpen) openSite = target;
                    else if (openSite !== null && openSite >= target) openSite += 1;
                    // * Undo re-inserts above open/selected groups — remap before persisting.
                    if (selection && selection.siteIndex >= target) {
                        selection = { siteIndex: selection.siteIndex + 1, ruleIndex: selection.ruleIndex };
                    }
                    rememberSelection(selection);
                },
            },
        });
    }

    function cloneSite(si: number): void {
        store.cloneSiteRule(si);
        if (openSite !== null && openSite > si) openSite += 1;
        if (selection && selection.siteIndex > si) {
            selection = { siteIndex: selection.siteIndex + 1, ruleIndex: selection.ruleIndex };
        }
        rememberSelection(selection);
    }

    // ── Drag resizers (restyle port) ─────────────────────────────────────────

    /** The Explorer|Preview grid container — CSS vars are set on it directly. */
    let layoutEl = $state<HTMLElement | null>(null);

    // * Measured explorer share (percent) drives `aria-valuenow` on both grips:
    //   the CSS clamp can differ from the stored px value, so read the box.
    let explorerWidthPct = $state(50);
    let explorerHeightPct = $state(48);

    // * measureSiteShell removed — open height is animated by slide.
    function clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }

    /** Refreshes both separator values from the laid-out boxes (no observer). */
    function measurePanes(): void {
        const container = layoutEl;
        const master = container?.querySelector<HTMLElement>(".rr-master");
        if (!container || !master) return;
        const rect = container.getBoundingClientRect();
        const paneRect = master.getBoundingClientRect();
        if (rect.width > 0) explorerWidthPct = Math.round((paneRect.width / rect.width) * 100);
        if (rect.height > 0) explorerHeightPct = Math.round((paneRect.height / rect.height) * 100);
    }

    /**
     * Attach-and-track pointer resizing for one grip axis — the handle sets its
     * CSS var live; bounds are clamped by the caller. Session-sized
     * (persistence deferred, see gui.md).
     */
    function makeDrag(
        handle: HTMLElement,
        cursor: "col-resize" | "row-resize",
        onMove: (e: PointerEvent) => void,
    ): () => void {
        const move = (ev: PointerEvent): void => onMove(ev);
        const end = (): void => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", end);
            handle.removeEventListener("pointercancel", end);
            handle.removeEventListener("lostpointercapture", end);
            handle.classList.remove("active");
            document.body.classList.remove("rr-dragging");
            document.body.style.cursor = "";
        };
        const down = (e: PointerEvent): void => {
            e.preventDefault();
            // * Synthetic pointers (E2E) are never "active" — capture is best-effort.
            try {
                handle.setPointerCapture(e.pointerId);
            } catch {
                // * No active pointer — the handle listeners still drive the drag.
            }
            handle.classList.add("active");
            document.body.classList.add("rr-dragging");
            document.body.style.cursor = cursor;
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", end);
            handle.addEventListener("pointercancel", end);
            handle.addEventListener("lostpointercapture", end);
        };
        handle.addEventListener("pointerdown", down);
        return () => {
            handle.removeEventListener("pointerdown", down);
            end();
        };
    }

    /** Keyboard resize for the vertical grip — ←/→ (24px, Shift 64px). */
    function nudgeExplorer(delta: number): void {
        if (!layoutEl) return;
        const master = layoutEl.querySelector<HTMLElement>(".rr-master");
        if (!master) return;
        const rect = layoutEl.getBoundingClientRect();
        // * 420px floor: the left column hosts the inline rule editor.
        const next = clamp(master.getBoundingClientRect().width + delta, 420, rect.width - 340);
        layoutEl.style.setProperty("--rr-explorer-w", next + "px");
        measurePanes();
    }

    /** Keyboard resize for the horizontal grip — ↑/↓ (24px, Shift 64px). */
    function nudgeExplorerHeight(delta: number): void {
        if (!layoutEl) return;
        const master = layoutEl.querySelector<HTMLElement>(".rr-master");
        if (!master) return;
        const rect = layoutEl.getBoundingClientRect();
        const next = clamp(master.getBoundingClientRect().height + delta, 200, rect.height - 200);
        layoutEl.style.setProperty("--rr-explorer-h", next + "px");
        measurePanes();
    }

    function onDragKey(event: KeyboardEvent): void {
        const step = event.shiftKey ? 64 : 24;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        nudgeExplorer(event.key === "ArrowLeft" ? -step : step);
    }

    function onDragHeightKey(event: KeyboardEvent): void {
        const step = event.shiftKey ? 64 : 24;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        nudgeExplorerHeight(event.key === "ArrowUp" ? -step : step);
    }

    /** Double-click reset: drop only that axis' inline var (back to CSS default). */
    function resetExplorerWidth(): void {
        layoutEl?.style.removeProperty("--rr-explorer-w");
        measurePanes();
    }

    function resetExplorerHeight(): void {
        layoutEl?.style.removeProperty("--rr-explorer-h");
        measurePanes();
    }

    // * One effect: wires BOTH grips against the mounted container, cleanup on
    //   unmount (svelte:window would target the wrong window — see App).
    $effect(() => {
        if (!layoutEl) return;
        const unbinds: Array<() => void> = [];
        const dragV = layoutEl.querySelector<HTMLElement>(".rr-drag-v");
        if (dragV) {
            unbinds.push(
                makeDrag(dragV, "col-resize", (e) => {
                    const rect = layoutEl!.getBoundingClientRect();
                    // * 420px floor: the left column hosts the inline editor.
                    layoutEl!.style.setProperty(
                        "--rr-explorer-w",
                        clamp(e.clientX - rect.left, 420, rect.width - 340) + "px",
                    );
                    measurePanes();
                }),
            );
        }
        const dragH = layoutEl.querySelector<HTMLElement>(".rr-drag-h");
        if (dragH) {
            unbinds.push(
                makeDrag(dragH, "row-resize", (e) => {
                    const rect = layoutEl!.getBoundingClientRect();
                    layoutEl!.style.setProperty(
                        "--rr-explorer-h",
                        clamp(e.clientY - rect.top, 200, rect.height - 200) + "px",
                    );
                    measurePanes();
                }),
            );
        }
        measurePanes();
        return () => unbinds.forEach((unbind) => unbind());
    });
</script>

<div class="rr-master-detail rr-tab-root" bind:this={layoutEl} data-pane={pane} role="presentation">
    <!-- * Phone-only switch: one visible pane at a time (visibility, not unmount). -->
    <div class="rr-pane-switch">
        <ChoiceGroup
            name="rr-rules-pane"
            label={t("rules.pane.label")}
            legendHidden
            value={pane}
            options={paneOptions}
            onchange={(value) => (pane = value === "preview" ? "preview" : "rules")}
        />
    </div>
    <!-- ─── EXPLORER (top-left) ────────────────────────────────────────────── -->
    <div class="rr-master" bind:this={masterEl} role="presentation">
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
                    placeholder={t("rules.filter")}
                    title={t("rules.filter")}
                    aria-label={t("rules.filter")}
                    bind:value={filter}
                    onkeydown={(e) => {
                        if (e.key !== "Escape") return;
                        e.preventDefault();
                        e.stopPropagation();
                        filter = "";
                    }}
                />
                {#if filter !== ""}
                    <button
                        class="rr-btn rr-btn-compact rr-btn--filter-clear"
                        aria-label={t("a11y.clearFilter")}
                        title={t("a11y.clearFilter")}
                        onclick={() => (filter = "")}
                    >
                        <Icon name="close" />
                    </button>
                {/if}
            </div>
            <hr class="rr-filter-divider" />
        </div>

        {#if invalidCount > 0}
            <p class="rr-hint rr-hint-block">{t("rules.blockingHint")}</p>
        {/if}
        {#if store.settings.rules.length === 0}
            <p class="rr-hint">{t("rules.list.empty")}</p>
        {:else if filter.trim() !== "" && !store.settings.rules.some((site) => siteMatches(site, filter
                        .trim()
                        .toLowerCase()))}
            <p class="rr-hint">{t("rules.filter.empty")}</p>
        {/if}

        {#each displaySites as { site, si }, pos (site)}
            {@const groupInvalid = siteHasInvalidRegex(site)}
            <!-- * SINGLE-OPEN accordion: folded on mount, only ONE group
                     open — unfolding binds the preview to that group (no rule
                     auto-select). -->
            <details
                class="rr-master-site rr-section"
                class:rr-managed={true}
                animate:flip={{ duration: motionFastMs }}
                class:rr-drop-target={siteDrop?.pos === pos && siteDragFrom !== null}
                class:rr-drag-ghost={siteDragFrom === pos}
                class:rr-site-disabled={site.disabled === true}
                class:rr-autosave-paused={site.disabled !== true && isSiteIncomplete(site)}
                data-disabled={site.disabled === true}
                open={openSite === si}
                ontoggle={(e) => onSiteToggle(si, e)}
            >
                <summary
                    class="rr-group-summary"
                    onkeydown={(e) => {
                        if (e.key === "F2" && editingSite !== si) {
                            e.preventDefault();
                            editingSite = si;
                        }
                    }}
                >
                    {#if store.settings.rules.length >= 2}
                        <DragHandle
                            label={t("a11y.reorderSite")}
                            hint={t("a11y.reorderHint")}
                            onPointerDown={(e) => {
                                siteDragFrom = pos;
                                siteDrag.start(e, pos);
                            }}
                            onMove={(delta) => moveSiteBy(si, delta)}
                        />
                    {/if}
                    <Icon name="chevronRight" class="rr-tri" />
                    <span class="rr-summary-lead">
                        <InlineCaption
                            caption={siteCaption(site)}
                            value={site.description ?? ""}
                            editing={editingSite === si}
                            placeholder={t("rules.siteDescription.placeholder")}
                            hint={t("rules.siteDescription.hint")}
                            ariaLabel={t("rules.siteDescription.label")}
                            editLabel={t("a11y.edit")}
                            onEditingChange={(v) => (editingSite = v ? si : null)}
                            onCommit={(value) => commitSiteDescription(si, value)}
                        />
                        {#if groupInvalid}
                            <span
                                class="rr-summary-flag"
                                role="img"
                                aria-label={t("rules.groupInvalidRegex")}
                                title={t("rules.groupInvalidRegex")}
                            >
                                <Icon name="dataInfoAlert" />
                            </span>
                        {/if}
                    </span>
                    <RowActions
                        onClone={() => cloneSite(si)}
                        onDelete={() => removeSite(si)}
                        onToggle={() => store.toggleSiteEnabled(si)}
                        togglePressed={site.disabled !== true}
                        toggleLabel={site.disabled === true ? t("rules.group.enable") : t("rules.group.disable")}
                    />
                </summary>
                <div class="rr-site-shell">
                    <div class="rr-site-body">
                        <div class="rr-site-gate">
                            <TextInput
                                bind:value={site.siteRegex}
                                invalid={siteInvalid(site.siteRegex)}
                                placeholder={t("rules.siteRegex")}
                                title={t("rules.siteRegex.hint")}
                                label={t("rules.siteRegex.label")}
                                highlight="regex"
                            >
                                {#snippet leading()}.*{/snippet}
                                {#snippet trailing()}
                                    <button
                                        class="rr-affix-btn"
                                        aria-label={isNotationRegex(site.siteRegex)
                                            ? t("rules.unescape")
                                            : t("rules.escape")}
                                        title={isNotationRegex(site.siteRegex)
                                            ? t("rules.unescape")
                                            : t("rules.escape")}
                                        disabled={site.siteRegex === ""}
                                        onmousedown={(e) => e.preventDefault()}
                                        onclick={() => toggleEscape(si)}
                                    >
                                        <Icon name="autoFixHigh" />
                                    </button>
                                    <RegexManualReference popoverKey={`siteManual:${si}`} />
                                {/snippet}
                            </TextInput>
                        </div>
                        <div class="rr-master-rules" role="presentation">
                            {#each displayRules(si) as { rule, ri }, pos (rule)}
                                {@const ruleOpen = selection?.siteIndex === si && selection?.ruleIndex === ri}
                                <details
                                    class="rr-master-rule"
                                    class:selected={ruleOpen}
                                    data-site={si}
                                    data-rule={ri}
                                    animate:flip={{ duration: motionFastMs }}
                                    class:rr-drop-target={openSite === si &&
                                        ruleDrop?.pos === pos &&
                                        ruleDragFrom !== null}
                                    class:rr-drag-ghost={openSite === si && ruleDragFrom === pos}
                                    open={ruleOpen}
                                    ontoggle={(e) => onRuleToggle(si, ri, e)}
                                >
                                    <summary class="rr-master-rule-summary">
                                        {#if site.rules.length >= 2}
                                            <DragHandle
                                                label={t("a11y.reorderRule")}
                                                hint={t("a11y.reorderHint")}
                                                onPointerDown={(e) => {
                                                    ruleDragFrom = pos;
                                                    ruleDrag.start(e, pos);
                                                }}
                                                onMove={(delta) => moveRuleBy(si, ri, delta)}
                                            />
                                        {/if}
                                        <Icon name="chevronRight" class="rr-tri" />
                                        <span class="rr-chips">
                                            <span class="rr-chip rr-chip-index">{ri + 1}</span>
                                            <span class="rr-chip rr-chip-kind rr-chip-{rule.kind.toLowerCase()}"
                                                >{t(`rules.kindShort.${rule.kind}`)}</span
                                            >
                                        </span>
                                        <span class="rr-master-rule-label">{ruleLabelText(rule)}</span>

                                        <RowActions
                                            onClone={() => cloneRuleRow(si, ri)}
                                            onDelete={() => removeRuleRow(si, ri)}
                                        />
                                    </summary>
                                    <!-- * Inline editor: mount ONLY the open rule — every
                                         RuleEditor instance runs preview derivations. -->
                                    {#if ruleOpen}
                                        <div class="rr-master-rule-body">
                                            <RuleEditor
                                                siteIndex={si}
                                                ruleIndex={ri}
                                                onSelectStep={selectRule}
                                                mode="fields"
                                            />
                                        </div>
                                    {/if}
                                </details>
                            {/each}
                            <div
                                class="rr-master-add-skeleton"
                                role="button"
                                tabindex="0"
                                aria-label={t("rules.addRule")}
                                title={t("rules.addRule")}
                                onclick={() => addRuleRow(si)}
                                onkeydown={(e) => {
                                    if (e.key !== "Enter" && e.key !== " ") return;
                                    e.preventDefault();
                                    addRuleRow(si);
                                }}
                            >
                                <span class="rr-add-skeleton-content">
                                    <Icon name="add" />
                                    {t("rules.addRule")}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </details>
        {/each}
        <div
            class="rr-section rr-add-skeleton rr-skeleton-item-padding"
            role="button"
            tabindex="0"
            aria-label={t("rules.addSite")}
            title={t("rules.addSite")}
            onclick={() => store.addSiteRule()}
            onkeydown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                store.addSiteRule();
            }}
        >
            <span class="rr-add-skeleton-content">
                <Icon name="add" />
                {t("rules.addSite")}
            </span>
        </div>
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
        class="rr-drag-v"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        aria-label={t("a11y.dragExplorerWidth")}
        title={t("a11y.dragExplorerWidth")}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={explorerWidthPct}
        onkeydown={(e) => onDragKey(e)}
        ondblclick={resetExplorerWidth}
    ></div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
        class="rr-drag-h"
        role="separator"
        tabindex="0"
        aria-orientation="horizontal"
        aria-label={t("a11y.dragExplorerHeight")}
        title={t("a11y.dragExplorerHeight")}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={explorerHeightPct}
        onkeydown={(e) => onDragHeightKey(e)}
        ondblclick={resetExplorerHeight}
    ></div>

    <!-- ─── PREVIEW (top-right) — bound to the OPEN group (whole chain) ─────── -->
    <div class="rr-preview-zone">
        {#if openSite !== null && store.settings.rules[openSite]}
            <!-- * Per-group key: preview fold/filter state must not bleed between groups. -->
            {#key openSite}
                <RuleEditor
                    siteIndex={openSite}
                    ruleIndex={selection && selection.siteIndex === openSite ? selection.ruleIndex : -1}
                    onSelectStep={selectRule}
                    mode="preview"
                />
            {/key}
        {:else}
            <!-- * Empty state: inert filter mirror keeps the column rhythm aligned
                 with the explorer; the group must be opened first. -->
            <div class="rr-preview-empty">
                <div class="rr-filter-sticky rr-filter-sticky--placeholder" aria-hidden="true">
                    <div class="rr-filter-field">
                        <span class="rr-filter-icon"><Icon name="search" /></span>
                        <span class="rr-input rr-filter rr-filter-ghost">
                            <span class="rr-filter-ghost-text">{t("preview.filter")}</span>
                        </span>
                    </div>
                    <hr class="rr-filter-divider" />
                </div>
                <div class="rr-section rr-empty-skeleton">
                    <span class="rr-empty-skeleton-content">
                        <Icon name="dataInfoAlert" />
                        <span>{t("preview.emptyTitle")}</span>
                    </span>
                    <p class="rr-hint">{t("rules.openHint")}</p>
                </div>
            </div>
        {/if}
    </div>
</div>
