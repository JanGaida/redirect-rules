# ADR 0020: Multi-dashboard tabs and the autosave/session workflow

- Status: accepted (2026-10-27; amended 2026-11-06 — save-button removal and 1/2/5 s speeds folded into [ADR 0031](0031-dashboard-interaction-model.md))
- Date: 2026-10-27
- Deciders: project owner
- Applies to: `src/lib/gui/dashboard.ts`, `src/lib/gui/dashboard-protocol.ts`,
  `src/lib/gui/autosave.svelte.ts`, `src/lib/stores/settings.svelte.ts`,
  `src/lib/gui/validation.ts`, `src/lib/gui/App.svelte`
- Supersedes: [ADR 0011](0011-dashboard-hash-takeover.md) Decision 3 (heartbeat and
  single-instance forwarding)
- Related: [ADR 0012](0012-dashboard-host-stub.md), [ADR 0013](0013-manual-theme-toggle.md)

## Context

ADR 0011 originally kept a single dashboard instance alive with a 5 s heartbeat and forwarded
new menu requests into the living tab. That added a cross-tab protocol, a stale-heartbeat window,
and a second code path for "already open" versus "new tab".

At the same time the dashboard moved from explicit Save to autosave. The open questions were:
how multiple tabs avoid clobbering each other, when a change persists, and how a user can still
recover from an automatic save.

## Decision

1. **One tab per menu click.** Every "Open Dashboard" / "Create new Rule" click opens its own
   dashboard tab. There is **no heartbeat, no single-instance detection, and no request
   forwarding**. A living dashboard does not listen for new menu requests.
2. **Boot request is id-tracked.** The opener writes `{ id, url, createRule }` under the
   `dashboard-request` GM key before opening the tab. The key is a single global slot: a
   newer click overwrites it, and the first tab to boot consumes the current value. A tab
   deletes the key only when the stored id still matches; there is no per-tab queue.
3. **Settings sync via the settings key.** Dashboard-to-dashboard sync runs through
   `GM_addValueChangeListener` on the settings key. A clean editor adopts the remote value; a
   dirty editor keeps its working state and shows a conflict hint. There is no merge — the
   last writer wins.
4. **Autosave debounce.** Every settings change re-arms a debounce (`autosaveDelayMs`, default
   2000 ms, normalized to 250–30000 ms). There is no maxWait; Close/ESC are the immediate
   synchronous flush ([ADR 0031](0031-dashboard-interaction-model.md) removed the Save button
   and owns the 1/2/5 s speeds). The saved snapshot is refreshed after every successful
   commit.
5. **Pause gates.** Persisting pauses while a non-empty regex fails to compile or a site/rule
   group is entirely empty. `pruneEmptyRows` only runs on a committed save, so a freshly
   prefilled "Create new Rule" row is never deleted while incomplete.
6. **Session-snapshot undo.** The undo target is the persisted state at dashboard boot, not a
   step stack. Restoring it persists immediately so other dashboards adopt it through rule 3.
7. **Close/ESC flush.** Close and ESC flush what the gate allows first; the unsaved-changes
   confirm remains only for changes that cannot persist (paused + dirty). `beforeunload` mirrors
   that policy on the dashboard window.

## Consequences

**Positive:**

- No heartbeat writes and no forwarding state; each tab has one predictable lifecycle.
- Multiple dashboards can be compared side by side.
- Autosave removes the "forgot to Save" class while the gate prevents invalid shapes from
  reaching storage.
- The session snapshot remains a real safety net after an automatic commit.

**Negative:**

- Concurrent edits in two dirty tabs are not merged; one side is overwritten on the next save.
- The remote conflict is a hint, not an automatic resolution.
- `autosaveDelayMs` adds a persisted setting and normalization surface.
- Close/beforeunload semantics differ from a classic dirty-form guard and need manual coverage.

## References

- Opener + boot consume: `src/lib/gui/dashboard.ts`
- Request/marker protocol: `src/lib/gui/dashboard-protocol.ts`
- Debounce, gates, snapshot, remote policy: `src/lib/gui/autosave.svelte.ts`
- Store save/replace: `src/lib/stores/settings.svelte.ts`
- Save policy helpers: `src/lib/gui/validation.ts`
- Root close/beforeunload wiring: `src/lib/gui/App.svelte`
- Hosting mechanism: [ADR 0011](0011-dashboard-hash-takeover.md)
- Host stub: [ADR 0012](0012-dashboard-host-stub.md)
