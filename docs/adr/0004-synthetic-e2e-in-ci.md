# ADR 0004: Committed synthetic E2E fixtures — E2E runs in CI

- Status: accepted (2026-10-25)
- Deciders: project owner
- Applies to: `e2e/helpers/fixture-server.ts`, `e2e/tests/*.spec.ts`, `.github/workflows/ci.yml`, `scripts/check-docs.mjs`

## Context

The sibling project `youtube-ui-tweaks` deliberately gitignores its E2E fixtures
(captured real YouTube DOM contains personal data) and therefore runs E2E local-only.
Redirect-rules has a different testing problem: the core is a pure URL transformation,
and the riskiest behaviors are the NAVIGATION side effects — `location.replace` on
load, SPA pushState re-entry, fragment-safe query append, and the loop-guard abort.
Those are invisible to Vitest because they only exist at the browser-navigation level.

## Decision

1. E2E fixture pages are HAND-BUILT static HTML (no captures, no personal data) served
   by a bare `node:http` fixture server on port 4184 (4174 is taken by the
   youtube-ui-tweaks setup — both run on the same dev machine).
2. Fixtures are COMMITTED — so E2E runs in CI as its own job (build →
   `npx playwright install firefox --with-deps` → `npm run test:e2e`), not local-only.
3. The userscript + GM polyfill are both injected via `addInitScript`: unlike the
   youtube-ui-tweaks script, this boot never reads `documentElement`, so document-start
   injection is safe and the redirect-on-load case is testable as a REAL navigation.
4. The docs gate's gitignored-reference hook (reference project hook 3) is set to a
   never-matching regex — nothing referenced by docs is ignored by design.

**Rule of thumb:** synthetic fixtures that encode behavior beats absent fixtures that
encode nothing.

## Consequences

**Positive:**

- CI proves the effective URL behavior in a real Firefox on every push/PR.
- No privacy screening needed before committing fixtures.
- The loop-guard spec would catch a regression that no unit test can see (actual
  navigation oscillation).

**Negative:**

- CI grows a browser-install step (~1 min) on every run.
- `addInitScript` userscript injection must stay valid — if the boot ever starts
  reading `documentElement`/`document.head` eagerly, the injection helper needs the
  post-load fallback pattern (documented in `e2e/helpers/userscript.ts`).

## References

- Fixture server: `e2e/helpers/fixture-server.ts`
- Specs: `e2e/tests/` (redirect-on-load, no-match, spa-navigation, append-query, loop-guard, dashboard-smoke, group-enable, toast-undo, performance-mode)
- CI wiring: `.github/workflows/ci.yml` (e2e job)
- Related docs: `docs/architecture/testing.md`
