# ADR 0015: Dev flow and single userscript identity

- Status: accepted (2026-11-01)
- Deciders: project owner
- Applies to: `vite.config.ts`, `src/main.ts`, `src/vite-env.d.ts`, `package.json`,
  `scripts/open-tampermonkey-install.mjs`, `.vscode/tasks.json`, `CONTEXT.md`,
  `docs/adr/0015-dev-flow-and-script-identity.md`, `npm run docs:check`,
  `npm run test`
- Builds on: [ADR 0008](0008-release-please-automation-contract.md),
  [ADR 0014](0014-static-text-build-time-base64-encoding.md)

## Context

The project needs three development/deployment flows without fragmenting script identity:

1. `npm run dev` — Vite HMR userscript integration flow.
2. `npm run dev:gui` — isolated dashboard/component flow.
3. `npm run build:dev` / `npm run build:prod` + the launcher — standalone artifact flow.

Tampermonkey identifies installed scripts by `@name` + `@namespace`. If dev and prod used
different identities, both could be installed side by side and duplicate redirects would
occur. At the same time, dev-only debug affordances must be removable from the prod
artifact. Dev and prod therefore keep the same `Redirect Rules` / repository-URL identity
and differ only in the effective compile/runtime dev flag and artifact filename.

Storage is intentionally shared: dev and prod use the same GM keys (`settings`, `stats`)
with no `dev_` prefix. This removes context-specific branching but means a developer build
can modify production rules/data; that is an accepted risk.

## Decision

1. **Single identity.** `name` and `namespace` stay identical (`Redirect Rules` /
   `https://github.com/JanGaida/redirect-rules`) in every mode. Artifact filenames differ
   (`redirect-rules.dev.user.js` vs `redirect-rules.user.js`) only to avoid file confusion.
2. **Effective dev flag.** `vite.config.ts` exports a config function and computes
   `DEV = process.env.RR_DEV === "1" || mode === "development"`. `src/main.ts` gates dev-only
   TM-menu entries on `const isDev = __DEV__ || import.meta.env.DEV`. Prod builds keep the
   block dead-code-eliminated.
3. **Conditional update URLs.** `updateURL` and `downloadURL` are included only when `!DEV`,
   so dev builds never point Tampermonkey at the release endpoint.
4. **GUI mode best-effort.** `npm run dev:gui` runs `vite --mode gui`; the monkey plugin
   stays enabled so the dev server remains usable. If a future Vite/plugin change makes that
   mode unusable without changing script identity, implementation must stop and ask for
   guidance before altering identity.
5. **Shared storage.** No `dev_` prefix and no separate keys; dev and prod read and write
   the same data. The risk is documented, not mitigated in code.
6. **Local HTTP launcher.** `scripts/open-tampermonkey-install.mjs` serves the built
   artifact from a local `http://127.0.0.1` preview server (ports 8765-8775) instead of
   `file://`, opens the browser for Tampermonkey, and shuts down after 30 s or 3-5 s after a
   successful serve. It has no external dependencies.
7. **Commands.** `package.json` exposes `dev`, `dev:gui`, `build:dev`, `build:prod`,
   `install:dev`, `install:prod`, `open:install:dev`, and `open:install:prod`;
   `.vscode/tasks.json` exposes the matching primary tasks.

## Consequences

**Positive:**

- One script identity prevents duplicate Tampermonkey entries and conflicting redirect runs.
- Dev-only affordances are stripped from prod artifacts while remaining available during
  development and HMR.
- A single named artifact flow (launcher) works without `file://` permission quirks.

**Negative:**

- Shared storage is an accepted data-safety risk: developer builds can edit production
  rules/data; testing on a live profile can lose real rules.
- `dev` and `dev:gui` both rely on Vite/plugin dev-server behaviour; stricter CSP sites
  still require the standalone artifact flow (`install:dev`) for verification.

## References

- Implementation: `vite.config.ts`, `src/main.ts`, `package.json`,
  `scripts/open-tampermonkey-install.mjs`, `.vscode/tasks.json`
- Documentation: `CONTEXT.md`
- Related decisions: [ADR 0008](0008-release-please-automation-contract.md)
