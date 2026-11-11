<script lang="ts">
    /**
     * GroupTestIndicator — ONE aggregated dot for a site group's test cases.
     *
     * * Green = every real test passes; amber = some pass and some fail;
     *   red = every real test fails; faint = no real tests (preview-only).
     * * The dot never multiplies: several tests still produce a single dot.
     * * Color alone is not the only channel — the tooltip and accessible name
     *   carry the counts.
     */
    import { t } from "../i18n.svelte";
    import type { GroupTestSummary } from "../../core/preview";

    interface Props {
        summary: GroupTestSummary;
        /** Disabled groups keep their verdict, the tooltip names the caveat. */
        disabled?: boolean;
    }

    let { summary, disabled = false }: Props = $props();

    const longLabel = $derived.by(() => {
        const base =
            summary.status === "none"
                ? t("rules.testIndicator.label.none")
                : summary.status === "success"
                  ? t("rules.testIndicator.label.success", { passed: summary.passed, total: summary.total })
                  : t("rules.testIndicator.label.failed", {
                        passed: summary.passed,
                        total: summary.total,
                        failed: summary.failed,
                    });
        return disabled ? `${base} — ${t("rules.testIndicator.disabledGroup")}` : base;
    });
</script>

<span
    class="rr-test-indicator rr-test-dot rr-test-dot--{summary.status}"
    title={longLabel}
    role="img"
    aria-label={longLabel}
></span>
