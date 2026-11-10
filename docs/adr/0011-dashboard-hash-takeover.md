# ADR 0011: Dashboard = hash-takeover page (GM_openInTab + document-start takeover)

- Status: accepted (amended 2026-11-06 — decision 3 consolidated to multi-dashboard, no heartbeat; see [ADR 0020](0020-multi-dashboard-autosave.md))
- Date: 2026-10-26
- Supersedes: ADR 0010 (the about:blank hosting MECHANISM; its tab-based intent carries over)

## Context

ADR 0010 hosted the dashboard in a `window.open("about:blank")` tab mounted from the
opener's userscript context. Real-browser verification (users report) showed the
popup blocker blocking it: **Tampermonkey menu callbacks run WITHOUT transient user
activation** — the menu click happens in the browser chrome, never inside the page —
so `window.open()` from a menu command is popup-blocked in real browsers. Playwright
never enforces popup blocking, which let the e2e suite pass against a broken production
path (false green). No code change can heal this: the trigger has no activation.

`GM_openInTab` is popup-blocker-proof (extension API) but hands us no about:blank
document to mount into (no opener relationship).

## Decision

The dashboard becomes a **hash-takeover page**:

1. `openDashboard()` → `GM_openInTab(dashboardUrl(host), { active: true })` — the inert
   host stub (ADR 0012) with the `#rr-dashboard` marker appended. The boot request carries
   the opener's page url separately.
2. The userscript instance in the NEW tab boots, sees the marker
   (`isDashboardUrl`), and takes over at document-start: `window.stop()` (kill the
   site's pending loads) + DOM wipe (DOM API only — CSP-safe) + styles via
   `adoptedStyleSheets` + fullscreen Svelte mount. Engine, watcher, and GM menu are
   SKIPPED in that tab.
3. Cross-tab signaling uses the settings key only. There is **no heartbeat, no
   single-instance detection and no request forwarding**; every menu click opens its
   own dashboard tab. The request value (`dashboard-request` key,
   `{ id, url, createRule }`) feeds only the tab whose menu click wrote it; the boot
   consumes it once (id-tracked). Dashboard-to-dashboard sync runs over the settings
   key, not over a request channel. See [ADR 0020](0020-multi-dashboard-autosave.md).
4. Boot deferral (verified via e2e init probe): a window.open'ed tab commits its real
   url AFTER the userscript ran on the provisional `about:blank` document — when
   `location.href === "about:blank"` at boot, the boot decision DEFERS (poll, capped
   2 s). Tampermonkey injects into the COMMITTED document — immediate boot; the
   deferral only serves non-TM injection environments (Playwright addInitScript).

Gains over ADR 0010: popup-blocker-proof, and the dashboard runs in its OWN context —
the opener-lifetime caveat (dashboard freezes when the opener navigates) is GONE.

Trade-offs (accepted): the tab's url bar shows the host stub + `#rr-dashboard` (not a
"local website" url); a brief flash of the host document's title/favicon before the wipe
(document-start ordering minimizes it); `window.close()` on Close/ESC works in Firefox for
history-free tabs — engines that refuse it get an honest close-it-manually hint.

## Consequences

- Grants: `@grant GM_openInTab`, `@grant GM_addValueChangeListener` (+ ambient types).
- The takeover tab's storage IS the GM storage → stats flush/prune and settings save
  run in the dashboard context directly; the OPENING page still flushes stats on its
  own `beforeunload`.
- `window.stop()` aborts the load — the takeover tab's `load` event NEVER fires
  (e2e must wait for the dashboard selector, not load state).
- A manual bookmark of `…#rr-dashboard` ALSO opens the dashboard (feature, not bug);
  it boots with an empty preview url because no boot request exists.
- The popup-blocked fallback (`window.open` when `GM_openInTab` is unavailable)
  remains with its hint alert as a last resort.
