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
        // * Unit coverage measures TypeScript logic only (ADR 0048). Svelte
        // * components are E2E-owned; rendering them here would need a component-test
        // * stack the project intentionally does not carry.
        coverage: {
            provider: "v8",
            reporter: ["text", "json-summary", "html"],
            reportsDirectory: "coverage",
            include: ["src/**/*.ts"],
            exclude: ["src/**/__tests__/**", "src/**/*.d.ts", "src/lib/gui/i18n.keys.ts"],
        },
    },
});
