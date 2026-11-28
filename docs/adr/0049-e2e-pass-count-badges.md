# ADR 0049: E2E pass-count badges from a CI-published `badges` branch

- Status: accepted (2026-11-28)
- Deciders: project owner
- Applies to: `.github/workflows/e2e-firefox.yml`, `.github/workflows/e2e-chromium.yml`,
  `scripts/e2e-badge.mjs`, `playwright.config.ts`, `README.md`, `.gitignore`,
  `.prettierignore`, `docs/architecture/testing.md`, `CONTEXT.md`

## Context

A workflow badge (`actions/workflows/<file>/badge.svg`) only carries the run status.
The owner wants the E2E chips to show **`passed/total`** with value-based color:
100 % green, ≥ 80 % orange, otherwise red. GitHub workflow badges support neither
counts nor conditional colors.

Options and why they fail:

- **shields dynamic JSON badge** (the coverage chip, ADR 0047) renders a single JSON
  value with a fixed color — no conditional color, so "orange at 80 %" is impossible.
- **Release asset as the badge input** (ADR 0047) updates per release, not per push;
  the counts would be stale for every merged PR.
- **shields endpoint badge over `github.com`** stays blocked (ADR 0047); release
  assets cannot serve endpoint JSON.
- **GitHub Pages** would work as a host but needs a repository setting, and two
  separate workflows deploying the same Pages site would overwrite each other's file.

ADR 0047 rejected auto-committed badge files because `main` is protected and any
write path outside the PR flow is a second exception. That reasoning targets **source
on `main`**; a generated output branch is a narrower, separate contract.

Verified 2026-11-28: the shields endpoint badge fetches
`raw.githubusercontent.com` JSON and applies `label`, `message`, and `color` from it
(the same host family already used by the coverage chip cannot be blocked).

## Decision

1. **One JSON endpoint per browser** on a dedicated generated branch named
   `badges`. The files sit at the **branch root** as `e2e-firefox.json` and
   `e2e-chromium.json`, each `{ schemaVersion: 1, label, message, color }`. The
   README endpoint URL `…/redirect-rules/badges/<file>` resolves to branch
   `badges` plus root path `<file>`, so a nested `badges/` directory on the
   branch would never be found.
2. **Playwright's JSON report is the single input** (`test-results/playwright.json`,
   already gitignored). `passed = stats.expected + stats.flaky` (a flaky test did pass);
   `total = passed + stats.unexpected + stats.skipped`.
3. **Thresholds and palette:** `passed === total && total > 0` → `brightgreen`;
   ratio ≥ 0.8 → `orange`; otherwise `red` — shields' own tokens, resolved by shields
   (currently `#4b0` / `#ea7233` / `#dd4343`), so the E2E chips and the shields CI
   workflow-status chip render the same values by construction. The GitHub-rendered
   workflow badge is not used for the CI chip: its gradient and dark label cannot be
   reproduced by an endpoint badge, and pinning a `color` override would paint a
   failing run green. A missing or corrupt report is `0/0` red — a crashed run must
   never look green.
4. **The badge is main-only.** The write steps run only for `push` to `main`; pull
   requests keep the normal E2E check status but never write badge data.
5. **The write path is the Contents API on the `badges` branch**, created from the
   main commit on first use, updated per file with retry. `main` stays untouched, no
   PR is required, and no protected-branch exception is added. `badges` is generated
   output: it never receives source and is never a PR target.
   Badge steps are best-effort (`continue-on-error`): a failed write must never
   turn a green E2E run red — the chip is a signal, not a merge gate.
6. **The README chips use shields endpoint badges** pointing at the raw URLs of that
   branch; label and color come from the JSON, the click-through stays on the
   workflow run page.

**Rule of thumb:** the E2E chips answer "how many of the browser suite's tests
passed right now", not "was the last run green".

## Consequences

**Positive:**

- Per-push freshness and value-based color, without a third-party test service.
- One contract for both browsers; the label lives in the JSON, so README edits stay
  limited to the URL.
- Counts come from Playwright's own report; no parallel counter to keep in sync.

**Negative:**

- A second write path exists (ADR 0047's no-auto-commit stance is amended for this
  generated branch only).
- Until the first `main` run after merge publishes the JSON, the chips render as
  "invalid" — raw and shields caches add a few minutes of lag on every update.
- Skipped tests reduce the ratio, so green requires a fully executed suite; flaky
  passes count as passed, matching the Actions run status.
- A failed publish leaves the previous counts in place; counts and run status can
  disagree until the next successful publish.

## References

- Badge writer: `scripts/e2e-badge.mjs`
- Report input: `playwright.config.ts` (JSON reporter output)
- Workflows: `.github/workflows/e2e-firefox.yml`, `.github/workflows/e2e-chromium.yml`
- User-facing chips: `README.md`
- Badge hosting rationale: `docs/adr/0047-coverage-badge-release-asset.md`
- Browser matrix: `docs/adr/0048-unit-coverage-scope-and-e2e-browser-matrix.md`
- Merge/protection contract: `docs/adr/0009-squash-merge-and-pr-title-contract.md`
- Testing contract: `docs/architecture/testing.md`
