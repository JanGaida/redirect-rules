<script lang="ts">
    /**
     * TokenReference — field-anchored token reference.
     *
     * * The info trigger + top-layer popover come from `InfoPopover`; this
     *   component only supplies the kind-dependent title, lead and token rows.
     * * "replace" shows the substitution tokens, "appendQuery" the params
     *   tokens (`k=v`, `&`, skipped `k`-segments, fragment-safe insertion,
     *   verbatim values — append-query.ts semantics).
     * * Rows are vertical (code chip left, meaning right) — no chip wall.
     */
    import { t } from "../i18n.svelte";
    import InfoPopover from "./InfoPopover.svelte";
    import { TOKREF_APPEND, TOKREF_SUBST } from "../token-reference-data";
    import type { UrlRule } from "../../core/settings";

    interface Props {
        kind?: UrlRule["kind"];
    }

    let { kind }: Props = $props();

    const isRefKind = $derived(kind === "replace" || kind === "appendQuery");
    const tokens = $derived(kind === "appendQuery" ? TOKREF_APPEND : TOKREF_SUBST);
    const title = $derived(kind === "appendQuery" ? t("tokref.titleParams") : t("tokref.title"));
    const lead = $derived(kind === "appendQuery" ? t("tokref.leadParams") : t("tokref.leadSubst"));
</script>

{#if isRefKind}
    <InfoPopover
        popoverKey="tokens"
        variant="tokens"
        triggerLabel={t("tokref.button")}
        triggerHint={t("tokref.button.hint")}
        {title}
        {lead}
        maxWidth={460}
    >
        <ul class="rr-token-rows">
            {#each tokens as tok (tok.key)}
                <li class="rr-token-row"><code>{tok.code}</code><span>{t(`tokref.${tok.key}`)}</span></li>
            {/each}
        </ul>
    </InfoPopover>
{/if}
