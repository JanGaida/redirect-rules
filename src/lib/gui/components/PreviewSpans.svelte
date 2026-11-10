<script lang="ts">
    /**
     * PreviewSpans — renders one colored URL preview (`PreviewSpan[]`).
     *
     * * URI components stay the subtle background layer; a diff overlay wins
     *   whenever a span carries one.
     * * Shared by the TOTAL block, every chain-step body and the summary rows.
     */
    import type { PreviewSpan } from "../../core/preview";

    interface Props {
        spans: PreviewSpan[];
    }

    let { spans }: Props = $props();

    function spanClass(component: string, diff: PreviewSpan["diff"]): string {
        if (diff === null) return `rr-uri-${component}`;
        return diff === "insertion" ? "rr-diff-insert" : "rr-diff-match";
    }
</script>

{#each spans as span, k (k)}<span class={spanClass(span.component, span.diff)}>{span.text}</span>{/each}
