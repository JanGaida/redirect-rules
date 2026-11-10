// ─────────────────────────────────────────────────────────────────────────────
// MARK: Settings store — single source of truth (Svelte 5 runes)
// ─────────────────────────────────────────────────────────────────────────────
// * The GUI reads/writes ONLY this store; persistence goes through
//   `saveSettings` (single GM key, ADR 0003).
// * Loads on first access (module singleton) — `main.ts` and the GUI share it.
// * Multi-dashboard: remote writes adopt via `reloadRemote` while clean.

import {
    loadSettingsResult,
    normalizeRule,
    normalizeSettings,
    saveSettings,
    type Settings,
    type SiteRule,
    type UrlRule,
    type PreviewEntry,
} from "../core/settings";
import { pruneEmptyRows } from "../gui/validation";
import { createLogger } from "../core/log";

const log = createLogger("store");

/** Clamps a preferred insertion index to `[0, length]` (undo restores, ADR 0039). */
function clampIndex(index: number, length: number): number {
    return Math.max(0, Math.min(index, length));
}

/** Escapes regex metacharacters — a hostname must match literally inside a gate. */
function escapeRegexLiteral(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One imported rule plus its group — object refs survive reorder/delete. */
export interface ImportedRuleEntry {
    site: SiteRule;
    rule: UrlRule;
}

/** Why the whole tree was replaced — undo keeps the open group, external clears it. */
export type ReplacementSource = "external" | "undo";

/** One initial read — the settings and the read flag MUST come from the same call. */
const initialLoad = loadSettingsResult();

class SettingsStore {
    /** The live settings object — reactive, owned by this store. */
    settings: Settings = $state(initialLoad.settings);

    /**
     * ! Whether the initial GM read succeeded. A failed read serves defaults
     *   only as an in-memory shape — it must never be persisted over intact
     *   storage, so `save()` refuses while this is false.
     */
    private readOk: boolean = initialLoad.ok;

    /**
     * Whether the INITIAL GM read succeeded (public, immutable outcome).
     * * A failed read serves defaults only as an in-memory shape — consumers
     *   (autosave snapshot) must not treat it as a restorable baseline.
     */
    readonly initialReadOk: boolean = initialLoad.ok;

    /**
     * Whole-tree replacement counter — GUI index selections are no longer
     * trustworthy. Incremented ONLY by `replace()` and `reloadRemote()`.
     */
    generation: number = $state(0);

    /**
     * Why the last whole-tree replacement happened. `"undo"` restores the
     * session snapshot (keep the open group); `"external"` is any other swap
     * (import, remote adoption) where indexes are not trustworthy.
     */
    replacementSource: ReplacementSource = $state("external");

    /** JSON snapshot of the last persisted state — unsaved-change detection. */
    savedSnapshot: string = $state(JSON.stringify(this.settings));

    /**
     * Serialized working state — computed ONCE per change and reused by the
     * autosave schedule, the dirty check, and the undo guard (was: one full
     * stringify per consumer, i.e. 2–3 per keystroke).
     */
    settingsJson: string = $derived(JSON.stringify(this.settings));

    /**
     * Parsed mirror of {@link savedSnapshot} — the "before" side of the changes
     * counter. Derived from the
     * snapshot, so save/remote-reload cannot forget to update it. Imports do NOT
     * touch it (they mark dirty against the pre-import state, by design).
     */
    savedSettings: Settings = $derived(JSON.parse(this.savedSnapshot) as Settings);

    /**
     * Persists the current settings + refreshes the snapshot.
     *
     * @returns True when the GM write succeeded; false leaves the state dirty.
     */
    save(): boolean {
        // * ! A failed initial read means the in-memory state is NOT a clean
        //   baseline: writing it would overwrite intact stored settings.
        if (!this.readOk) {
            log.error("settings save refused — initial storage read failed; stored settings left untouched");
            return false;
        }
        // * Keep the cached selection on the SAME site/rule after pruning empty
        //   rows above it (object identity survives the filter).
        const selected = this.settings.lastSelection;
        let selectedSite: SiteRule | undefined;
        let selectedRule: UrlRule | undefined;
        if (selected !== undefined) {
            selectedSite = this.settings.rules[selected.siteIndex];
            selectedRule = selectedSite?.rules[selected.ruleIndex];
        }
        pruneEmptyRows(this.settings);
        if (selectedSite !== undefined && selectedRule !== undefined) {
            const siteIndex = this.settings.rules.indexOf(selectedSite);
            const ruleIndex = selectedSite.rules.indexOf(selectedRule);
            if (siteIndex >= 0 && ruleIndex >= 0) {
                this.settings.lastSelection = { siteIndex, ruleIndex };
            } else {
                delete this.settings.lastSelection;
            }
        } else if (selected !== undefined) {
            delete this.settings.lastSelection;
        }
        if (!saveSettings(this.settings)) {
            log.error("settings save failed — state stays dirty");
            return false;
        }
        this.savedSnapshot = JSON.stringify(this.settings);
        log.info("settings saved", {
            groups: this.settings.rules.length,
            rules: this.settings.rules.reduce((total, site) => total + site.rules.length, 0),
            chars: this.savedSnapshot.length,
        });
        return true;
    }

    /**
     * Replaces the whole settings object (raw-JSON editor import) — normalized
     * fail-soft BEFORE assignment, so the store can never hold an invalid shape.
     *
     * @param next - Raw settings candidate (normalized before assignment).
     * @param options.source - Why the tree is replaced; defaults to `"external"`.
     */
    replace(next: unknown, options: { source?: ReplacementSource } = {}): void {
        this.settings = normalizeSettings(next);
        this.replacementSource = options.source ?? "external";
        // * Whole-tree swap: every GUI index selection may now point at another rule.
        this.generation += 1;
        // * readOk is deliberately NOT touched: the failed-read store must stay
        //   non-persistable (an import cannot silently clear the guard).
        log.debug("settings replaced", {
            source: this.replacementSource,
            groups: this.settings.rules.length,
            rules: this.settings.rules.reduce((total, site) => total + site.rules.length, 0),
        });
    }

    /**
     * Adopts a remotely persisted settings value.
     *
     * * Normalized fail-soft BEFORE assignment (same contract as `replace`) —
     *   the raw value comes from a GM value-change listener, not from a trusted
     *   caller.
     * * Ends up CLEAN by construction: the value IS the persisted state, so the
     *   saved snapshot + mirror are refreshed together with the assignment (the
     *   autosave effect sees no dirty state → no write-back → no ping-pong).
     *
     * @param raw - The remotely stored settings object (listener `newValue`).
     */
    reloadRemote(raw: unknown): void {
        // * Only successfully read values reach here — the store is persistable
        //   again (e.g. manual refresh after a failed initial read).
        this.readOk = true;
        this.settings = normalizeSettings(raw);
        this.savedSnapshot = JSON.stringify(this.settings);
        // * Remote adoption swaps the whole tree — raw index selections go stale.
        this.replacementSource = "external";
        this.generation += 1;
        log.info("settings adopted from remote dashboard write", {
            source: this.replacementSource,
            groups: this.settings.rules.length,
            rules: this.settings.rules.reduce((total, site) => total + site.rules.length, 0),
        });
    }

    /** Whether the working state differs from the last persisted snapshot. */
    get dirty(): boolean {
        return this.settingsJson !== this.savedSnapshot;
    }

    /** Adds a new site rule (empty, or with a prefilled gate) at the end of the list. */
    addSiteRule(siteRegex = ""): void {
        // * Group-bound preview url: uniform "".
        this.settings.rules.push({ siteRegex, rules: [], previewEntries: [{ url: "", testOutputUri: "" }] });
        log.debug("site rule added", { siteIndex: this.settings.rules.length - 1, siteRegex });
    }

    /**
     * "Create new Rule" prefill: a NEW site rule gated on the url's host with
     * one empty replace rule.
     *
     * * The gate is an ANCHORED authority match (scheme + optional userinfo +
     *   exact hostname + optional port + path/query/fragment boundary). A bare
     *   `github.com` literal is unanchored and would also match
     *   `https://evil.test/?next=github.com` — the anchored form cannot.
     * * `new URL()` is GUI-context parsing — the ENGINE path stays URL-object
     *   free (ADR 0001 / append-query contract).
     * * An unparsable url degrades to an empty gate (user fills it in).
     *
     * @param url - The current page url (preview + host extraction source).
     * @returns The new selection indexes, or null when nothing was added.
     */
    addSiteRuleFromUrl(url: string): { siteIndex: number; ruleIndex: number } | null {
        let siteRegex = "";
        try {
            const hostname = new URL(url).hostname;
            siteRegex = `/^[a-z][a-z0-9+.-]*:\\/\\/(?:[^/?#@]*@)?${escapeRegexLiteral(hostname)}(?::\\d+)?(?:[/?#]|$)/i`;
        } catch {
            log.debug("create-rule url not parsable — empty site gate", { url });
        }
        // * Group-bound preview: the request url prefills the GROUP's
        // preview urls — the whole new chain previews against it.
        this.settings.rules.push({
            siteRegex,
            previewEntries: [{ url, testOutputUri: "" }],
            rules: [{ kind: "replace", regex: "", substitution: "" }],
        });
        const siteIndex = this.settings.rules.length - 1;
        log.debug("site rule created from url", { siteIndex, url, siteRegex });
        return { siteIndex, ruleIndex: 0 };
    }

    /** Removes a site rule by index. */
    removeSiteRule(index: number): void {
        const removed = this.settings.rules[index];
        this.settings.rules.splice(index, 1);
        log.debug("site rule removed", {
            siteIndex: index,
            siteRegex: removed?.siteRegex,
            rules: removed?.rules.length,
        });
    }

    /**
     * Re-inserts a deleted site rule at its original index (undo, ADR 0039).
     *
     * @param index - Preferred index; clamped to the current list length.
     * @param site - The previously removed group (plain settings object).
     * @returns The actual insertion index.
     */
    insertSiteRule(index: number, site: SiteRule): number {
        const target = clampIndex(index, this.settings.rules.length);
        this.settings.rules.splice(target, 0, site);
        log.debug("site rule restored", { requested: index, target, siteRegex: site.siteRegex });
        return target;
    }

    /** Toggles the group-level engine switch (sparse flag: absent = active). */
    toggleSiteEnabled(index: number): void {
        const site = this.settings.rules[index];
        if (!site) return;
        if (site.disabled === true) delete site.disabled;
        else site.disabled = true;
        log.debug("site rule toggled", { siteIndex: index, disabled: site.disabled === true });
    }

    /** Moves a site rule one position up/down (clamped, no wrap-around). */
    moveSiteRule(index: number, delta: -1 | 1): void {
        const target = index + delta;
        if (target < 0 || target >= this.settings.rules.length) return;
        const list = this.settings.rules;
        [list[index], list[target]] = [list[target], list[index]];
        log.debug("site rule moved", { from: index, to: target });
    }

    /** Adds a new rule (empty replace rule) to a site rule. */
    addRule(siteIndex: number): void {
        const site = this.settings.rules[siteIndex];
        if (!site) return;
        site.rules.push({ kind: "replace", regex: "", substitution: "" });
        log.debug("rule added", { siteIndex, ruleIndex: site.rules.length - 1 });
    }

    /**
     * Appends imported rules in place (no normalize of the surrounding settings)
     * and returns the created entries as object refs.
     *
     * ! Append-only on purpose: an LLM proposal carries no stable rule index, so
     * ! index-based merge would overwrite existing rows.
     */
    appendImportedRules(
        siteIndex: number,
        rules: ReadonlyArray<UrlRule>,
        previewEntries: ReadonlyArray<PreviewEntry> = [],
    ): ImportedRuleEntry[] {
        const site = this.settings.rules[siteIndex];
        if (!site) return [];
        const created: ImportedRuleEntry[] = [];
        for (const rule of rules) {
            const normalized = normalizeRule(rule);
            if (normalized === null) continue;
            site.rules.push(normalized);
            // * Read the pushed value back so the ref is the reactive proxy.
            created.push({ site, rule: site.rules[site.rules.length - 1] });
        }
        // * Verification entries only ride along with rules that actually landed.
        if (created.length > 0 && previewEntries.length > 0) {
            if (!site.previewEntries) site.previewEntries = [];
            site.previewEntries.push(...previewEntries.map((entry) => ({ ...entry })));
        }
        log.debug("rules imported into site", {
            siteIndex,
            requested: rules.length,
            imported: created.length,
            skipped: rules.length - created.length,
            tests: previewEntries.length,
        });
        return created;
    }

    /** Creates a group with imported rules and returns the stored object refs. */
    createSiteRuleWithRules(
        siteRegex: string,
        rules: ReadonlyArray<UrlRule>,
        previewEntries: ReadonlyArray<PreviewEntry> = [],
    ): ImportedRuleEntry[] {
        const site: SiteRule = {
            siteRegex,
            previewEntries:
                previewEntries.length > 0
                    ? previewEntries.map((entry) => ({ ...entry }))
                    : [{ url: "", testOutputUri: "" }],
            rules: [],
        };
        for (const rule of rules) {
            const normalized = normalizeRule(rule);
            if (normalized === null) continue;
            site.rules.push(normalized);
        }
        this.settings.rules.push(site);
        // * Same reason as above: hand out the proxy the GUI later resolves by.
        const storedSite = this.settings.rules[this.settings.rules.length - 1];
        log.debug("site rule created with imported rules", {
            siteIndex: this.settings.rules.length - 1,
            siteRegex,
            requested: rules.length,
            imported: storedSite.rules.length,
        });
        return storedSite.rules.map((rule) => ({ site: storedSite, rule }));
    }

    /** Removes a rule from a site rule by index. */
    removeRule(siteIndex: number, ruleIndex: number): void {
        const site = this.settings.rules[siteIndex];
        if (!site) return;
        const removed = site.rules[ruleIndex];
        site.rules.splice(ruleIndex, 1);
        log.debug("rule removed", { siteIndex, ruleIndex, kind: removed?.kind });
    }

    /**
     * Re-inserts a deleted rule at its original index (undo, ADR 0039).
     *
     * @param siteIndex - Parent group index.
     * @param ruleIndex - Preferred index; clamped to the current rule count.
     * @param rule - The previously removed rule.
     * @returns The actual insertion index, or -1 when the parent group is gone.
     */
    insertRule(siteIndex: number, ruleIndex: number, rule: UrlRule): number {
        const site = this.settings.rules[siteIndex];
        if (!site) return -1;
        const target = clampIndex(ruleIndex, site.rules.length);
        site.rules.splice(target, 0, rule);
        log.debug("rule restored", { siteIndex, requested: ruleIndex, target, kind: rule.kind });
        return target;
    }

    /** Moves a rule one position up/down within its site rule (clamped). */
    moveRule(siteIndex: number, ruleIndex: number, delta: -1 | 1): void {
        const site = this.settings.rules[siteIndex];
        if (!site) return;
        const target = ruleIndex + delta;
        if (target < 0 || target >= site.rules.length) return;
        const list = site.rules;
        [list[ruleIndex], list[target]] = [list[target], list[ruleIndex]];
        log.debug("rule moved", { siteIndex, from: ruleIndex, to: target });
    }

    /** Clones a site rule (deep) and inserts the copy after the original. */
    cloneSiteRule(index: number): void {
        const original = this.settings.rules[index];
        if (!original) return;
        const copy: SiteRule = {
            siteRegex: original.siteRegex,
            ...(original.description !== undefined ? { description: original.description } : {}),
            ...(original.disabled === true ? { disabled: true } : {}),
            previewEntries: original.previewEntries ? original.previewEntries.map((entry) => ({ ...entry })) : [],
            rules: original.rules.map((r) => ({ ...r })),
        };
        this.settings.rules.splice(index + 1, 0, copy);
        log.debug("site rule cloned", { siteIndex: index, target: index + 1, rules: copy.rules.length });
    }

    /** Appends a new preview entry (empty by default). */
    addPreviewEntry(siteIndex: number, url = "", testOutputUri = ""): void {
        const site = this.settings.rules[siteIndex];
        if (!site) return;
        if (!site.previewEntries) site.previewEntries = [];
        site.previewEntries.push({ url, testOutputUri, description: "" });
        log.debug("preview entry added", { siteIndex, previewIndex: site.previewEntries.length - 1 });
    }

    /** Removes a preview entry by index. */
    removePreviewEntry(siteIndex: number, index: number): void {
        const site = this.settings.rules[siteIndex];
        if (!site) return;
        if (!site.previewEntries) return;
        site.previewEntries.splice(index, 1);
        log.debug("preview entry removed", { siteIndex, previewIndex: index });
    }

    /**
     * Re-inserts a deleted preview entry at its original index (undo, ADR 0039).
     *
     * @param siteIndex - Parent group index.
     * @param index - Preferred index; clamped to the current entry count.
     * @param entry - The previously removed test case.
     * @returns The actual insertion index, or -1 when the parent group is gone.
     */
    insertPreviewEntry(siteIndex: number, index: number, entry: PreviewEntry): number {
        const site = this.settings.rules[siteIndex];
        if (!site) return -1;
        if (!site.previewEntries) site.previewEntries = [];
        const target = clampIndex(index, site.previewEntries.length);
        site.previewEntries.splice(target, 0, entry);
        log.debug("preview entry restored", { siteIndex, requested: index, target });
        return target;
    }

    /** Clones a preview entry and inserts the copy after the original. */
    clonePreviewEntry(siteIndex: number, index: number): void {
        const site = this.settings.rules[siteIndex];
        if (!site) return;
        if (!site.previewEntries) return;
        const entry = site.previewEntries[index];
        if (entry === undefined) return;
        site.previewEntries.splice(index + 1, 0, { ...entry });
        log.debug("preview entry cloned", { siteIndex, from: index, to: index + 1 });
    }

    /** Clones a rule and inserts the copy after the original. */
    cloneRule(siteIndex: number, ruleIndex: number): void {
        const site = this.settings.rules[siteIndex];
        if (!site) return;
        const original = site.rules[ruleIndex];
        if (!original) return;
        site.rules.splice(ruleIndex + 1, 0, { ...original });
        log.debug("rule cloned", { siteIndex, from: ruleIndex, to: ruleIndex + 1, kind: original.kind });
    }
}

/** The singleton store instance. */
export const store = new SettingsStore();
