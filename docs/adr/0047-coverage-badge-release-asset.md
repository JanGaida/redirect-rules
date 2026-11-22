# ADR 0047: Coverage badge data as a release asset — no third-party coverage service

- Status: accepted (2026-11-22)
- Deciders: project owner
- Applies to: `.github/workflows/ci.yml`, `.github/workflows/release-please.yml`,
  `vitest.config.ts`, `package.json`, `README.md`, `docs/architecture/testing.md`,
  `.gitignore`, `.prettierignore`, `.vscode/tasks.json`

## Context

The README needs a coverage chip, but every conventional source failed a constraint:

- **GitHub Code Quality** (Cobertura upload, `actions/upload-code-coverage`) requires
  GitHub Team or Enterprise Cloud, bills per active committer, and exposes **no badge
  URL** — it only comments on pull requests. Unusable on a free personal repository.
- **Codecov / Coveralls** need an account and an upload token secret; the project
  deliberately avoids that dependency for a static userscript.
- `main` is protected (ADR 0009), so an automatically committed badge file would need a
  write path outside the PR flow — rejected as a second exception to that contract.

The core fact that makes a local solution possible: shields.io can render a badge from
any public JSON URL, and GitHub releases can carry arbitrary assets. A GitHub release
asset is written by the release workflow itself (which already holds `contents: write`),
so the badge value can travel without touching `main`.

A second constraint narrowed the badge mode: shields' **endpoint** badge rejects
`github.com` URLs ("domain is blocked", verified 2026-11-22), while its **dynamic JSON**
badge fetches GitHub release assets through their redirects
(`application/octet-stream` is parsed as JSON; final status must be 200).

## Decision

1. **Measure unit line coverage** with Vitest's V8 provider over
   `src/**/*.{ts,svelte}` — tests, ambient `.d.ts` files, and the generated
   `i18n.keys.ts` are excluded. No `coverage.thresholds` are configured: with Svelte
   components in scope, every new untested component lowers the aggregate and must not
   block a pull request. The CI `gate` job runs `npm run test:coverage` so the coverage
   toolchain fails early, not first at release time.
2. **Use the Vitest json-summary as the badge input.** The json-summary reporter
   already exposes `total.lines.pct`; no bespoke badge schema is generated, so the
   badge cannot drift from the measured value.
3. **Publish the summary as a release asset.** A separate `coverage-asset` job runs
   `npm run test:coverage` on the release tag when this run created a release, then
   uploads the summary as `coverage-summary.json` with `gh release upload --clobber`.
   The job is separate from the `.user.js` asset job so a coverage failure can never
   block the userscript upload or its manual retry.
4. **The README chip is a shields.io dynamic JSON badge** over
   `https://github.com/JanGaida/redirect-rules/releases/latest/download/coverage-summary.json`
   with `query=$.total.lines.pct`, a `%` suffix, and a fixed informational (blue)
   color. The endpoint badge is not used because shields blocks `github.com` for it.
   No account, token, branch push, or self-hosted service is involved; shields only
   renders the SVG.
5. **Generated artifacts stay out of the repository and the format gate**: `coverage/`
   is listed in `.gitignore` and `.prettierignore` (the CI gate runs coverage before
   `format:check`).
6. **Provider and runner versions move in lockstep**: `@vitest/coverage-v8` is pinned
   to the exact `vitest` version; bump both together.

**Rule of thumb:** the badge is a gap signal, not a gate — it shows what unit tests
exercise, while Playwright carries the behavioral coverage.

## Consequences

**Positive:**

- The chip ships without a third-party coverage account, token, or paid plan.
- The badge value is Vitest's own summary output; there is no parallel badge format to
  keep in sync.
- The separate job keeps the userscript release and its manual retry path intact.

**Negative:**

- The badge updates per release, not per merge; it shows "not found" until the first
  release that carries the asset.
- No per-pull-request diff coverage and no threshold enforcement.
- Svelte components are unit-untested by construction (0 %), so the aggregate
  understates the Playwright-covered UI.
- The chip shows the raw two-decimal percentage and a fixed blue color; a value-based
  color band is unavailable because the endpoint badge blocks `github.com`.
- A missed asset upload repairs itself only with the next release (no manual tag path
  for this job).
- Tests run twice per release (gate and coverage job); cross-workflow artifact reuse was
  rejected as more coupling than it saves.

## References

- Coverage config: `vitest.config.ts`
- Badge input: the Vitest json-summary reporter (`total.lines.pct`)
- Release job: `.github/workflows/release-please.yml` (coverage-asset)
- Gate: `.github/workflows/ci.yml`
- User-facing chip: `README.md`
- Testing contract: `docs/architecture/testing.md`
- Prior release contract: `docs/adr/0008-release-please-automation-contract.md`
- Merge/protection contract: `docs/adr/0009-squash-merge-and-pr-title-contract.md`
