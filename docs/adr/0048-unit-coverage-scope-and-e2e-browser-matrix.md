# ADR 0048: TypeScript-only unit coverage and the Firefox/Chromium E2E matrix

- Status: accepted (2026-11-28)
- Deciders: project owner
- Applies to: `vitest.config.ts`, `playwright.config.ts`,
  `playwright.chromium.config.ts`, `package.json`, `.github/workflows/ci.yml`,
  `.github/workflows/e2e-firefox.yml`, `.github/workflows/e2e-chromium.yml`,
  `.github/workflows/release-please.yml`, `src/lib/gui/tabs/RulesTab.svelte`,
  `README.md`, `docs/architecture/testing.md`

## Context

The unit-coverage aggregate mixed two incomparable scopes: TypeScript modules and
Svelte markup. No Vitest test renders a component, so every markup line counted as
uncovered regardless of the logic behind it, and the headline number measured scope
geometry rather than test progress. The Svelte UI is exercised by the Playwright
suite; Svelte render tests would require a component-test stack the project
intentionally does not carry. Vue's own `vitest.config.ts` excludes components
covered only through E2E from coverage with the same rationale, and Google's
coverage guidance warns that a coverage percentage is not a goal in itself — so
merged unit+E2E coverage was rejected rather than pursued.

The E2E suite was Firefox-only. A Chromium spike ran the full, unmodified suite
against the same synthetic fixtures: 48/53 passed, 0 skipped, 0 flaky in the run,
and 0 pixel/geometry failures — the "Firefox-calibrated tolerances will break"
hypothesis was disproven. All five failures had two causes — one in test
infrastructure, one in production component state:

- Three failures: `e2e/helpers/gm-polyfill.ts` mirrored writes to localStorage
  only `if (document.documentElement)`. Chromium's `addInitScript` runs at
  document-start with no document root yet, so every write stayed in memory and
  died on navigation. Firefox happened to expose the root early enough.
- Two failures: a controlled `<details open={…} ontoggle={…}>` in
  `RulesTab.svelte` races the native toggle task. Chromium queues that task after
  the test already touches the still-closed body; `getByRole` prunes closed
  details from the accessibility tree, so the failure surfaces as a locator
  timeout. The fix is a production change: the element owns the open state,
  `openSite` mirrors the native toggle, and state changes are written back
  imperatively, so an unrelated re-render can no longer re-close a queued toggle.

A repeat run of the popover-drag spec exposed one more harness flake: geometry
was read while the popover's entry transition still ran, so the measured box
drifted by a few sub-pixel steps. The spec now settles the animation before
reading coordinates — a test-only wait, not a tolerance change.

Playwright's `page.coverage` API is Chromium-only, but Istanbul instrumentation
works in Firefox too; the browser matrix is therefore unrelated to how coverage
is collected. The project also does not use a third-party coverage service
(ADR 0047).

## Decision

1. **Unit coverage scope is `src/**/*.ts`.** `.svelte` components are E2E-owned
   and leave the denominator. `src/main.ts` stays in scope at 0 % as the visible
   boot blind spot. The aggregate is not pinned here — it drifts with every test
   change; the coverage report and the `unit coverage` badge carry the current
   value.
2. **No coverage thresholds.** The badge is a gap signal, not a merge gate; the
   CI `gate` job still runs `npm run test:coverage` so the toolchain fails early.
3. **Run the full E2E suite on Firefox and Chromium.** No subset, no
   Firefox-only skips, no per-browser test branches. Firefox is required (the
   existing branch-protection contract); Chromium is informational and becomes
   required only if Chrome is declared a supported target — there is no automatic
   promotion.
4. **No combined unit+E2E coverage**, no Istanbul merge, and no Chromium
   coverage collection. The two signals stay separate.
5. **Badge labels state the scope:** `unit coverage`, `E2E (Firefox)`, and
   `E2E (Chromium)`. GitHub badges are per workflow, not per job.
6. **The Firefox job name stays `e2e (Firefox, effective URL behavior)`** inside
   the new `e2e-firefox.yml`. That exact string is the required-check contract in
   ADR 0009; the workflow name (`E2E (Firefox)`) only drives the badge URL.
7. **One production fix plus test-infra fixes.** Production: the controlled
   site-group `<details>` in `RulesTab.svelte` owns its open state — a reactive
   `open` attribute could re-close a group inside Chromium's queued toggle task,
   so `openSite` mirrors the native toggle and state changes are written back
   imperatively. Test infra: remove the polyfill's `documentElement` guards
   (localStorage is preferred at document-start, memory is the fallback), add
   explicit "unfold and wait for the body" helpers for the controlled
   `<details>` elements, and settle the popover entry transition before pixel
   reads.

## Consequences

**Positive:**

- The coverage number measures TypeScript logic instead of scope geometry.
- Both browsers run the same behavioral suite; Chromium regressions surface
  without changing the supported-platform contract.
- Two dedicated workflows give each browser its own badge and history.

**Negative:**

- The higher headline number follows from the narrower denominator, not from more
  tests; the README and testing docs must say so to avoid overclaiming.
- UI lines have no unit metric at all; their only signal is E2E.
- One more workflow consumes CI minutes, and the required-check window must be
  re-verified after the split.
- Chromium can fail from a browser-specific timing assumption; the popover barrier
  and the polyfill fix are test-infra, while the `<details>` open-state fix is a
  production change that affects every browser.

## References

- Coverage config: `vitest.config.ts`
- Chromium project: `playwright.chromium.config.ts`
- Firefox base config: `playwright.config.ts`
- Production fix: `src/lib/gui/tabs/RulesTab.svelte`
- Test-infra fixes: `e2e/helpers/gm-polyfill.ts`, `e2e/helpers/dashboard.ts`,
  `e2e/tests/dashboard-smoke.spec.ts`
- Workflows: `.github/workflows/e2e-firefox.yml`,
  `.github/workflows/e2e-chromium.yml`
- Testing contract: `docs/architecture/testing.md`
- External precedent: [Vue core `vitest.config.ts`](https://github.com/vuejs/core/blob/main/vitest.config.ts)
  — excludes components covered only via E2E from the coverage scope
- External guidance: [Google Testing Blog — Code Coverage Best Practices](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html)
- Related ADRs: [ADR 0004](0004-synthetic-e2e-in-ci.md),
  [ADR 0009](0009-squash-merge-and-pr-title-contract.md),
  [ADR 0047](0047-coverage-badge-release-asset.md)
