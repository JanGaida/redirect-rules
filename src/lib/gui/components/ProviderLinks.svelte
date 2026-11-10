<script lang="ts">
    /**
     * ProviderLinks — static copy-paste destinations for the Assistant hero.
     *
     * * Plain external links: new tab, `noopener noreferrer`, visible name.
     * * Glyph is decorative (`aria-hidden`); the icon family paints in
     *   `currentColor` so the row stays monochrome.
     */
    import { t } from "../i18n.svelte";
    import { brandIcons } from "../brand-icons";
    import { PROVIDERS } from "../providers";
</script>

<p class="rr-providers">
    <span class="rr-providers-label">{t("assistant.hero.providers")}</span>
    {#each PROVIDERS as provider (provider.icon)}
        <a class="rr-provider" href={provider.href} target="_blank" rel="noopener noreferrer">
            <span class="rr-icon rr-provider-icon" aria-hidden="true">{@html brandIcons[provider.icon]}</span>
            <span>{provider.name}</span>
        </a>
    {/each}
</p>
