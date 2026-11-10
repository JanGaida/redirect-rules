# ADR 0012: Dashboard host stub and the `dashboardHost` selector

- Status: accepted (retroactive record 2026-11-02; mechanism referenced in code since 2026-10-27;
  target file fixed 2026-11-06; amended 2026-11-07 — the `main` pin makes the stub path a frozen
  public contract)
- Date: 2026-11-02 (retroactive record)
- Deciders: project owner
- Applies to: `src/lib/gui/dashboard-protocol.ts`, `src/lib/gui/dashboard.ts`,
  `src/lib/core/settings.ts`, `e2e/helpers/gm-polyfill.ts`
- Builds on: [ADR 0011](0011-dashboard-hash-takeover.md)

## Context

ADR 0011 replaced the about:blank hosting mechanism with a hash-takeover page opened via
`GM_openInTab`. That still leaves the question of **which document the new tab loads before
the userscript takes over**.

A userscript has no own origin and no real dashboard URL to match. Opening the opener's page
URL and appending `#rr-dashboard` would make the dashboard tab re-load the site's own document
first; its CSS, scripts, and lifecycle would compete with the takeover. `about:blank` has no
committed document in non-Tampermonkey injection environments, so the userscript may never run
there.

## Decision

1. **Host stub.** `DASHBOARD_HOST_URL` points at a stable `raw.githubusercontent.com` file
   served as `text/plain`. `dashboardUrl(host)` appends the `#rr-dashboard` marker. The stub is
   deliberately inert: no site CSS/JS to fight, and the existing all-URLs match pattern already
   covers the URL.
2. **Published target.** The constant points at the repo-owned `dashboard-host.html` — a
   deliberately minimal document (doctype, charset, title) with no scripts, styles, or fonts.
   `dashboard.html` stays the dev-only host (Vite serve + GM polyfill). The raw URL resolves
   after the first push. It pins `refs/heads/main` DELIBERATELY: the stub is inert, so fixes reach every installed
   version without a new userscript release. The repo path `dashboard-host.html` is therefore a
   FROZEN public contract — renaming, moving, or breaking it on `main` breaks every published
   dashboard at once. Content changes stay backwards compatible; a version tag pin was rejected
   because old installs would never receive stub fixes.
3. **`dashboardHost` setting.** `fixed` (default) uses `DASHBOARD_HOST_URL`; `aboutblank` uses
   `about:blank` and is explicitly experimental. The setting is persisted with the normal
   settings schema and normalized fail-soft to `fixed`.
4. **Environment overrides.** The dev server opens
   `https://127.0.0.1:5173/dashboard.html`; the E2E GM polyfill sets
   `window.__RR_DASHBOARD_HOST__` to a same-origin fixture path so storage events keep working.
   Tampermonkey never sets the override.
5. **Takeover unchanged.** The host document is stopped and wiped at document-start according to
   ADR 0011; the host only provides the committed document that lets the userscript boot.

## Consequences

**Positive:**

- No site CSS/JS/title fights during the takeover; the stub is cheap and cacheable.
- One stable marker URL shape across production, dev, and E2E.
- `about:blank` remains available as a deliberate experimental escape hatch.

**Negative:**

- The tab's URL bar shows the raw host path + `#rr-dashboard`, not a product-owned page.
- The fixed host needs network availability: offline GitHub access leaves a dead tab until the
  userscript injects.
- `about:blank` is not reliable outside Tampermonkey (no committed document to inject into).
- The repo-owned stub URL only resolves after the first push.
- The `main` pin freezes the stub PATH as a permanent public contract: one bad rename or a broken
  `main` takes down every installed dashboard simultaneously. This is the accepted trade-off for
  instant stub fixes; a tag pin would make the host immutable but strand old installs.

## References

- Protocol: `src/lib/gui/dashboard-protocol.ts` (`DASHBOARD_HOST_URL`, `dashboardUrl`)
- Opener: `src/lib/gui/dashboard.ts` (`openDashboard`, host selection, dev/E2E overrides)
- Setting: `src/lib/core/settings.ts` (`DashboardHostSetting`, normalization)
- E2E seam: `e2e/helpers/gm-polyfill.ts` (`__RR_DASHBOARD_HOST__`)
- Mechanism: [ADR 0011](0011-dashboard-hash-takeover.md)
