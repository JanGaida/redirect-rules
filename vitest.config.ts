import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { compileTimeDefines } from "./scripts/build-defines.ts";

/**
 * Vitest configuration.
 *
 * Two test environments, selected per-file via docblock annotation (vitest v4 API):
 *
 * - `node` (default): pure-logic tests (regex parsing, rule compilation, apply engine,
 *   append-query string surgery). No DOM.
 * - `jsdom`: annotate the test file with `// @vitest-environment jsdom` to opt in. Used
 *   for watcher integration tests (pushState hook, loop-guard session state).
 */
export default defineConfig({
    define: compileTimeDefines({ dev: false, buildSha: "unknown", buildDate: "unknown" }),
    plugins: [svelte()],
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
    },
});
