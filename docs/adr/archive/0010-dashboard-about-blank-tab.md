# ADR 0010: Dashboard lives in a window.open'd about:blank tab

- Status: superseded by ADR 0011 (hash-takeover page) — the about:blank mechanism
  failed in real browsers: TM menu callbacks have NO transient user activation, so
  real browsers popup-block `window.open` (Playwright did not — false green e2e)
- Date: 2026-10-26
- Supersedes: the in-page popup panel (no ADR — legacy parity carry-over)

## Context

The GUI started as the legacy script's in-page editor: a backdrop dialog mounted into the
HOST page's DOM (two TM menu entries, "Edit Rules" / "Edit Settings"). The user wants a
dedicated, fullscreen dashboard — away from the page being edited — with one "Open
Dashboard" entry point. Redirect Rules is a Tampermonkey USERSCRIPT: there is no
extension options page, no own origin, no way to match a real URL with `@match`
(no real DNS/server for a fake host).

## Decision

The dashboard opens as a NEW BROWSER TAB via `window.open("about:blank", "rr-dashboard")`
and the Svelte 5 app is mounted INTO that tab's document from the opener's userscript
context (`src/lib/gui/dashboard.ts`, ADR-style single-instance with focus-forwarding).

Consequences of this placement:

- The app code, the store, and GM storage keep running in the OPENER context — the
  dashboard document is pure DOM. Save/close semantics are unchanged from the popup.
- Styles must be injected into the dashboard document explicitly
  (`dashboard.css?inline` via `adoptedStyleSheets` — CSSOM is exempt from
  `style-src` CSP; a `<style>` element is the fallback).
- `svelte:window` binds the OPENER window — all key/beforeunload wiring targets the
  dashboard window explicitly (the `win` prop).
- Lifetime caveat (accepted): navigating/closing the opener tab kills the dashboard's
  reactivity while its DOM lingers inert; the single-instance module state resets with
  the opener, so the next menu click opens a FRESH dashboard. Nothing is lost — the
  store persists on Save.
- Popup blockers can veto `window.open`; a TM menu click is a user gesture, and a
  `null` return shows a hint alert.

Alternatives rejected:

- **Fullscreen overlay on the host page** (`position:fixed`) — robust, but exactly
  the "popup on the website" the user wanted to leave.
- **Real MV3 extension with a native options page** — the only _true_ standalone
  page, but a project scope change (userscript distribution, auto-update, build chain).
- **`GM_openInTab` on a fake/dashboard URL** — dead end: no real host exists to match,
  the userscript cannot own an origin.

## Consequences

- Two TM menu entries: "Open Dashboard" (dashboard with the current URL as preview
  input) and "Create new Rule" (dashboard + prefilled site rule gated on the URL host).
- Single instance: a second menu click focuses the existing tab and forwards the request
  via the `rr-dashboard-request` CustomEvent on the dashboard window.
- The old popup (`panel.ts`, `panel.css`, `SettingsTab.svelte`, both menu entries) is
  fully REMOVED — one GUI surface, no dual maintenance.
- The `beforeunload` dirty-guard and ESC-close live on the dashboard window; the
  opener window registers the stats flush hook instead.
