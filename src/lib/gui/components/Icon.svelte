<script lang="ts">
    /**
     * Icon — decorative Material-Symbols glyph (inline SVG string).
     *
     * * PURE chrome: `aria-hidden` — semantics belong to the consuming button
     *   (title/aria-label; the E2E accessible-name contract stays intact).
     * * Fill follows `currentColor` (global `.rr-icon svg` rule); scoped
     *   accent/danger/faint overrides take precedence.
     * * Size via CSS on the wrapper (`.rr-icon`) — 24px viewBox scales down.
     */
    import { icons, type IconName } from "../icon";

    interface Props {
        name: IconName;
        /** Optional extra classes on the wrapper (e.g. `.rr-tri` rotation). */
        class?: string;
    }

    let { name, class: extra = "" }: Props = $props();
</script>

<span class="rr-icon {extra}" aria-hidden="true">{@html icons[name]}</span>
