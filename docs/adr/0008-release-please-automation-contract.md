# ADR 0008: Release-please automation contract — bump target, PR-update rule, in-workflow assets

- Status: accepted (2026-10-25, adapted from the youtube-ui-tweaks pipeline; amended 2026-11-07 — the generic vite.config.ts marker updater was dropped and the first release is bootstrapped as `1.0.0`; amended 2026-11-09 — release-please-action v5, a PAT-gated release PR, `package-lock.json` version mirrors, and a manual `--clobber` asset rerun)
- Deciders: project owner
- Applies to: `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release-please.yml`, `scripts/check-release-config.mjs`, `package-lock.json`, `.prettierignore`

## Context

The GitHub release pipeline (changelog + version bumps + `.user.js` release asset) is driven by
`googleapis/release-please-action@v5` (Node 24) with `release-type: simple`. Setting this up (first in the
youtube-ui-tweaks project, verified there against the release-please source and empirically)
surfaced four non-obvious engine behaviors:

1. **`simple` bumps neither `package.json` nor the userscript header.** The `simple` release type
   manages `.release-please-manifest.json` (and optionally `version.txt`) — nothing else.
2. **The `generic` extra-file updater is marker-based.** It only rewrites a version on lines
   containing `x-release-please-version` (inline, same line); it does not blind-replace old
   version strings anywhere in the file. (No longer used — see Decision 1.)
3. **Open release PRs are updated by changelog-body comparison only.** When the candidate PR
   body equals the existing PR body, release-please skips the branch update entirely —
   even when the candidate's file changes differ. A `ci:`/`chore:` commit therefore never
   lands in an open release PR.
4. **Releases published by `release-please` (via `GITHUB_TOKEN`) do not trigger other
   workflows.** GitHub's recursion guard suppresses workflow runs for events created by
   `GITHUB_TOKEN` — a separate `on: release` asset workflow never fires for automated releases.

## Decision

1. **The bump targets are `package.json` and both `package-lock.json` version fields** via the
   `json` updater: `package.json` `$.version`, `package-lock.json` `$.version`, and
   `package-lock.json` `$.packages[''].version`. `vite-plugin-monkey` derives the userscript
   `@version` from `projectPkg.version` at build time, so there is no generic updater and no
   inline marker in the source. `scripts/check-release-config.mjs` requires all three targets and
   fails when either lock mirror drifts from `package.json`.
2. **Release PRs run with a PAT when available.** The release-please step uses
   `token: ${{ secrets.RELEASE_PLEASE_TOKEN || secrets.GITHUB_TOKEN }}`. The PAT is a
   prerequisite for CI checks on release PRs: events created by `GITHUB_TOKEN` do not trigger
   other workflows, so a token-only run opens/updates PRs whose checks never execute.
3. **Commits touching release-managed files use changelog-visible types (`feat`/`fix`).**
   `ci:`/`chore:`/`docs:` commits are invisible to the PR-body comparison and never update an
   open release PR.
4. **The release asset is built and attached inside the release-please workflow** (second job,
   gated on `release_created`/`tag_name` or a manual `tag` input, `gh release upload --clobber`
   on the tag). It is re-runnable for an existing tag: `workflow_dispatch` with the optional
   `tag` input checks out that tag, builds the artifact, asserts the built `// @version` equals
   the tag minus `v`, and uploads with `--clobber` so a retry is idempotent. There is no separate
   `on: release` workflow.
5. **Release-please-owned files are excluded from the format gate**: `CHANGELOG.md` and
   `.release-please-manifest.json` are listed in `.prettierignore` — their formatting follows
   the release-please writer, not Prettier (`tabWidth: 4`).
6. **Bootstrapping is config-driven and starts at `0.0.0`**: the manifest entry stays
   `0.0.0` until the first release PR, so release-please's `initialReleaseVersion()`
   resolves to `1.0.0`. `skip-changelog` stays `true` for that first PR so the
   hand-written 1.0.0 init entry is not duplicated; remove it once the `v1.0.0` tag
   exists (`npm run release:check` fails until then). Tags are `vX.Y.Z`
   (`include-component-in-tag: false`), matching the workflow's asset upload.

**Rule of thumb:** the release-please PR body is the pipeline's change detector — if a commit
matters for a pending release, it must change the changelog.

## Consequences

**Positive:**

- One merge of the release PR yields a fully consistent release: tag, GitHub Release,
  changelog, `package.json`, both `package-lock.json` mirrors, userscript `@version`, and the
  attached `.user.js` all agree.
- The format gate stays green on release PRs (bot-written files are ignored by design).
- A failed or missing asset upload is recoverable without a new release: re-run the workflow
  with the `tag` input and `--clobber`.

**Negative:**

- `@version` follows `package.json` at build time; editing the userscript header manually has
  no effect on the released build.
- The PAT prerequisite is a manual repo setup; a `GITHUB_TOKEN`-only run silently loses CI
  coverage on release PRs.
- The pipeline's PRs must not be merged while relevant `ci:`-typed commits are pending on
  main — either wait for the next release or type the commit `fix`/`feat`.
- `simple`-type versioning means the npm-style `package.json` version is a mirror, not the
  driver; the manifest file remains the release-please source of truth.

## References

- Config: `release-please-config.json` (`json` updater for `package.json` and both
  `package-lock.json` version fields), `.release-please-manifest.json` (source of truth),
  `vite-plugin-monkey` (header derivation from `projectPkg.version`),
  `scripts/check-release-config.mjs` (offline wiring/mirror gate)
- Workflow: `.github/workflows/release-please.yml` (release-please job + `release-assets` job
  with `gh release upload --clobber`, gated on `release_created` or the manual `tag` input)
- Format-gate exclusions: `.prettierignore` (`CHANGELOG.md`, `.release-please-manifest.json`)
- Follow-up ADR: [ADR 0009](0009-squash-merge-and-pr-title-contract.md) — the merge strategy
  feeding this machinery
