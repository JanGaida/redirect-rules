<!--
  !! SQUASH-MERGE CONTRACT (ADR 0009): the PR title becomes the git commit subject.
     Format: Conventional Commits — type(scope): description
     Types: feat | fix | build | chore | ci | docs | style | refactor | perf | test
     ADR 0008: changes to release-managed files MUST use feat/fix to stay changelog-visible.
-->

## Summary

<!-- REQUIRED — what changes and why, 1-3 sentences. No walkthrough of the diff. -->

## Verification

<!-- REQUIRED — fill every line honestly, keep the CI order:
- npm run check                  → PASS / FAIL / NOT RUN
- npm test                       → PASS / FAIL / NOT RUN
- npm run comments:check -- --strict → PASS / FAIL / NOT RUN
- npm run css:check -- --strict      → PASS / FAIL / NOT RUN
- npm run docs:check             → PASS / FAIL / NOT RUN (must be PASS before merge)
- npm run release:check          → PASS / FAIL / NOT RUN
- npm run format:check           → PASS / FAIL / NOT RUN
- npm run build                  → PASS / FAIL / NOT RUN
- npm run test:e2e               → PASS / FAIL / NOT RUN (needs `npm run build` first; runs in CI too)
-->

## Checklist

- [ ] PR title matches `type(scope): description` — the squash merge uses it as commit subject
- [ ] Title type is `feat`/`fix` if this change must appear in the changelog (ADR 0008)
- [ ] All local gates above are PASS — a NOT RUN line needs a one-line reason
- [ ] Architecture docs updated when component behavior changed (AGENTS.md contract)
- [ ] CI is green

## After merge — releasing a version

1. With a `feat`/`fix` title type, release-please opens (or updates) a release PR containing the changelog entry and the `package.json` version bump (ADR 0008). Any other title type is invisible to the pending release.
2. Cut the release by reviewing that release PR (changelog, version) and merging it — release-please tags the release, publishes the GitHub Release, and the workflow attaches `dist/redirect-rules.user.js` (the `updateURL` target that Tampermonkey auto-updates from).
3. Nothing to do when no release is intended (docs-only or config-only changes) — the open release PR simply waits for the next `feat`/`fix`.
