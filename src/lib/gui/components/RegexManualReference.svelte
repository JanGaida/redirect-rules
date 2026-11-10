<script lang="ts">
    /**
     * RegexManualReference — manual trigger + popover for a regex field.
     *
     * * One access path per reference: the trigger opens the `RegexManual` table
     *   in the shared top-layer popover; there is no disclosure and no second
     *   link.
     * * The trigger lives in the field trailing affix. Site groups pass a unique
     *   `siteManual:<index>` key: every folded group keeps its gate trigger in
     *   the DOM, so a shared key would open all gates on one click.
     */
    import { t } from "../i18n.svelte";
    import type { PopoverKey } from "../ui-state.svelte";
    import InfoPopover from "./InfoPopover.svelte";
    import RegexManual from "./RegexManual.svelte";

    interface Props {
        popoverKey?: PopoverKey;
    }

    let { popoverKey = "manual" }: Props = $props();
</script>

<InfoPopover
    {popoverKey}
    variant="manual"
    triggerLabel={t("manual.button")}
    triggerHint={t("manual.button.hint")}
    title={t("manual.title")}
    maxWidth={800}
>
    <RegexManual />
</InfoPopover>
