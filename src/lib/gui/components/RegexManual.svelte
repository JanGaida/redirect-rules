<script lang="ts">
    /**
     * RegexManual — the full reference table inside the manual popover.
     *
     * * PRESENTATIONAL: `InfoPopover` owns trigger, visibility, placement and
     *   focus; this table is the popover body for every rule kind.
     * * 5 groups / 18 rows: Token | Meaning, exactly one example per row.
     * * ONE global "Examples" toggle sits in the Meaning table head (no extra
     *   column) and reveals every example (default: hidden); token rows always
     *   stay visible.
     * * Labels, descriptions and example annotations come from `manual.*` i18n
     *   while the regex code fragments stay locale-free.
     */
    import { t } from "../i18n.svelte";
    import Icon from "./Icon.svelte";

    interface ManualRow {
        token: string;
        key: string;
    }

    interface ManualGroup {
        key: string;
        rows: ManualRow[];
    }

    const GROUPS: ManualGroup[] = [
        {
            key: "notation",
            rows: [
                { token: "/pattern/flags", key: "notation" },
                { token: "d g i m s u v y", key: "flags" },
                { token: '" " / \\s', key: "whitespace" },
            ],
        },
        {
            key: "patterns",
            rows: [
                { token: "[abc] [^abc] \\d \\w \\s", key: "classes" },
                { token: "+ * ? {n,m}", key: "quantifiers" },
                { token: "(...) (?:...) a|b", key: "groups" },
                { token: "^ $ \\b", key: "anchors" },
                { token: "(?<name>...)", key: "named" },
                { token: "(?=…) (?!…) (?<=…) (?<!…)", key: "lookaround" },
            ],
        },
        {
            key: "substitution",
            rows: [
                { token: "$1 … $99", key: "capture" },
                { token: "$<name>", key: "namedRef" },
                { token: "$&", key: "whole" },
                { token: "$$", key: "dollar" },
            ],
        },
        {
            key: "params",
            rows: [
                { token: "k=v&k2=v2", key: "pairs" },
                { token: "#frag", key: "fragment" },
                { token: "%20", key: "raw" },
            ],
        },
        {
            key: "gates",
            rows: [
                { token: "site gate / rule regex", key: "gates" },
                { token: "checkpoint", key: "checkpoint" },
            ],
        },
    ];

    let examplesOpen = $state(false);
</script>

<section class="rr-manual" class:rr-manual--examples={examplesOpen}>
    <table class="rr-manual-table">
        <thead>
            <tr>
                <th>{t("manual.col.token")}</th>
                <th>
                    <span class="rr-manual-head-row">
                        <span>{t("manual.col.meaning")}</span>
                        <button
                            type="button"
                            class="rr-manual-examples-toggle"
                            aria-expanded={examplesOpen}
                            onclick={() => (examplesOpen = !examplesOpen)}
                        >
                            <Icon name={examplesOpen ? "unfoldLess" : "unfoldMore"} />
                            {t("manual.examples")}
                        </button>
                    </span>
                </th>
            </tr>
        </thead>
        {#each GROUPS as group (group.key)}
            <tbody class="rr-manual-group-head">
                <tr class="rr-manual-group-row">
                    <th colspan="2">
                        <span class="rr-manual-group-title">{t(`manual.group.${group.key}`)}</span>
                    </th>
                </tr>
            </tbody>
            <tbody class="rr-manual-group">
                {#each group.rows as row (row.key)}
                    <tr class="rr-manual-row">
                        <td class="rr-manual-token">{row.token}</td>
                        <td class="rr-manual-meaning">
                            {t(`manual.row.${row.key}.desc`)}
                            <div class="rr-manual-example">{t(`manual.row.${row.key}.ex`)}</div>
                        </td>
                    </tr>
                {/each}
            </tbody>
        {/each}
    </table>
</section>
