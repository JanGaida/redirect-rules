# ADR 0009: Squash-only merges with Conventional-Commits PR titles

- Status: accepted (2026-10-25, adapted from the youtube-ui-tweaks pipeline; amended 2026-11-10 — commit type → changelog visibility)
- Deciders: project owner
- Applies to: repository merge settings, pull requests, `AGENTS.md`, `.github/PULL_REQUEST_TEMPLATE.md`

## Context

`main` accepts changes through pull requests — feature/fix PRs and the release-please
automation PRs alike. With three merge strategies available (merge commit, squash, rebase), the
choice determines what lands on `main` — and release-please parses exactly that: changelog and
version bumps are computed from the commits on `main` (the release-please contract is
[ADR 0008](0008-release-please-automation-contract.md)).

A merge-commit PR keeps every intermediate commit ("fix typo", "wip") in history and in the
changelog computation; a squashed PR collapses to one commit and loses its intermediate commit
messages. Branch protection for `main` additionally needs a policy a solo maintainer can
actually satisfy: requiring peer approvals would block every PR — including the bot's release
PRs, since self-approval is impossible.

## Decision

1. **Squash-only**: merge commits and rebase merges are disabled at the repository level; every
   PR lands as exactly one commit on `main`.
2. **The PR title is the commit**: squash takes the PR title as the commit subject, so PR titles
   MUST follow Conventional Commits (`type(scope): description`) — the same format as direct
   commits. `.github/PULL_REQUEST_TEMPLATE.md` carries the format reminder into every new PR.
3. **Branch protection for `main`**: pull requests REQUIRED before merging (zero approvals
   required — solo maintainer, self-approval is impossible, and the bot's release PRs must
   stay mergeable), required status checks (`check / test / comments / css / docs / release / format / build`,
   `e2e (Firefox, effective URL behavior)`, `secret scan` — the CI job names), branches up to
   date, force pushes and deletions blocked.
4. **Release PRs are unaffected**: release-please detects its merged PRs by label and title, not
   by commit structure — squash-merging `chore(main): release X.Y.Z` is fully supported.
5. **The commit type decides changelog visibility.** `release-please-config.json` configures no
   `changelog-sections`, so release-please's defaults apply:

    | Type                                                        | Changelog section        |
    | ----------------------------------------------------------- | ------------------------ |
    | `feat`                                                      | Features                 |
    | `fix`                                                       | Bug Fixes                |
    | `perf`                                                      | Performance Improvements |
    | `revert`                                                    | Reverts                  |
    | `build`, `chore`, `ci`, `docs`, `style`, `refactor`, `test` | omitted                  |

    A `!` breaking marker is only surfaced through a visible type (`feat!`/`fix!`); a breaking
    `refactor!`/`chore!` disappears from the changelog. The mapping changes only when
    `changelog-sections` is configured — then update this table and the `AGENTS.md` bullet.

GitHub may prefix the check names with the workflow (`CI / …`) in the branch-protection picker;
this ADR names the jobs, and the picker shows the real strings at configure time.

**Rule of thumb:** write PR titles like commit messages — they become the commit.

## Consequences

**Positive:**

- `main` history is linear: one PR = one commit, no WIP noise.
- Changelog and version bumps stay deterministic — the squash commit is one clean
  conventional commit.
- Every merge passes the CI gate; history is protected from force pushes and deletions.

**Negative:**

- Intermediate commit messages of a PR are lost (mitigated by the PR description).
- A mistyped PR title lands verbatim on `main` and in the changelog — the template checklist is
  the guard, discipline the mechanism.
- Review-free protection is by design; adding a second maintainer requires revisiting
  decision 3.
- Hidden types never reach the changelog: a user-visible change titled `refactor` or `chore`
  is missing from the release notes — the type decision happens at PR-title time, not at
  release time.

## References

- Repository settings: merge strategy (squash-only, subject = PR title), branch protection for
  `main` (required checks `check / test / comments / css / docs / release / format / build`,
  `e2e (Firefox, effective URL behavior)`, `secret scan`, up-to-date, no force pushes/deletions)
- `.github/PULL_REQUEST_TEMPLATE.md` — title format reminder + checklist
- `AGENTS.md` — "Git & PR Conventions" section
- Prior ADR: [ADR 0008](0008-release-please-automation-contract.md) — the changelog machinery
  this strategy feeds
