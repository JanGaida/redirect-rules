# ADR 0003: Blank storage restart — no migration from the legacy settings keys

- Status: accepted (2026-10-25; amended 2026-11-09 — first opt-in first-boot groups; amended 2026-11-13 — twenty-seven groups, five rule kinds incl. `unwrap`, explicit udm/tbm filter kept)
- Deciders: project owner
- Applies to: `src/lib/core/storage.ts`, `src/lib/core/settings.ts`

## Context

The legacy script stored settings under a versioned `v1_*_Settings` GM key. The rebranding to "Redirect Rules" plus
the typed rule model ([ADR 0002](0002-typed-rule-kinds.md)) changed the settings shape:
`urlRules` → `rules`, rule objects gained a `kind` field, `workerCount` was deleted.
Migration would need key-shape detection, rule-by-rule conversion, and a delete of the
old key — code that runs exactly once per user.

## Decision

1. No migration layer. The new script uses a single GM key `settings` (prefix-free —
   Tampermonkey scopes GM keys per script anyway, and the script name changed).
2. First boot writes the defaults (see Current state below) — and only when the key is
   absent; the legacy `Settings.From` re-wrote storage on EVERY load, which is not ported.
3. Re-entering the personal rule set is a one-time manual cost, accepted by the user
   (sole consumer). Bulk import is the file-based export/import flow in the Config tab;
   the earlier raw-JSON editor was removed and is no longer an escape hatch.

**Rule of thumb:** for a personal-use tool, a clean schema beats one-shot migration code.

## Current state (2026-11-13)

The amendment chain is resolved to one state; the original blank-restart semantics
are unchanged.

- First boot ships twenty-seven real-world groups, each with a site gate, an idempotent
  chain, and pinned test entries:
    - Wikipedia mobile → desktop (`<lang>.m.wikipedia.org` → `<lang>.wikipedia.org`).
    - YouTube: host normalization, `checkpoint` early-exit, `si` cleanup, and both
      `youtube.com/shorts/<id>` and `/embed/<id>` → `/watch?v=<id>` (functional query
      and fragment preserved).
    - `youtu.be/<id>` short links → `www.youtube.com/watch?v=<id>`.
    - `old`/`new`/`i`/`np.reddit.com` → `www.reddit.com`; Reddit share params removed.
    - Google search: `num=100` plus Web filter (`udm=14`) when no `udm`/`tbm` filter is
      present; a separate cleanup group strips session and click tracking.
    - Google AMP (`/amp/s/…`, `/amp`, `?amp`) → the canonical URL.
    - Google Maps, Stack Overflow and Bing: share, campaign and session tracking removed.
    - DuckDuckGo, Yahoo and Google Images: redirect wrappers decoded to their target via
      the `unwrap` kind ([ADR 0046](0046-unwrap-rule-kind.md)); Google Images covers the
      legacy `imgres` form, not modern `tbm=isch` results.
    - `redd.it/<id>` → `www.reddit.com/comments/<id>` with share params removed.
    - GitHub `blob` → raw, `tree` file paths → `blob`, Gist → raw, Wikimedia Commons
      `File:` pages → `Special:Redirect/file/`.
    - Amazon, eBay, Spotify, LinkedIn, Instagram, Facebook and TikTok: affiliate,
      share and click tracking removed.
    - Tracking params (`utm_*`, `fbclid`, `gclid`, `gbraid`, `wbraid`, `dclid`,
      `msclkid`, `yclid`, `mc_cid`, `mc_eid`, `mkt_tok`, `igshid`, `twclid`,
      `srsltid`, `_openstat`, `ref_src`, `ref_url`) removed via the `removeQuery` kind
      ([ADR 0044](0044-remove-query-rule-kind.md)).
- All twenty-seven ship `disabled: true` (opt-in, [ADR 0038](0038-per-group-enable-disable.md)):
  first boot never rewrites URLs until the user activates a group. Stored groups stay
  active. Per-group `disabled` is part of the persisted `SiteRule` and needs no schema
  change beyond the existing field.
- Stored rules always REPLACE the example list on load/import; existing profiles are
  unaffected. The earlier 27.10. demo set (`example.de`, `startpage.com`) is gone.
- The persisted settings shape is `locale`, `logLevel`, `performanceMode`, `theme`,
  `motion`, `hideSkipped`, `dashboardHost`, `autosaveDelayMs`, `rules` and optional
  `lastSelection`. `defaultLocked` and `workerCount` do not exist
  ([ADR 0031](0031-dashboard-interaction-model.md) decision 4).
- Defaults are authored once in `SETTINGS_DEFAULTS` + `exampleRulesCopy()`; `defaultSettings()`
  must never be called from `normalizeSettings` (recursion guard in the code comment).

## Consequences

**Positive:**

- No dead migration code to maintain, test, or explain in docs.
- The settings shape stays explicit and is documented in
  `docs/architecture/settings-storage.md`.
- A fresh install demonstrates real value and the full rule model (five rule kinds,
  ordered chains, site gates, pinned tests) without rewriting URLs unasked.
- Storage key reads/writes are trivial and covered by the settings/store specs.

**Negative:**

- Every legacy user (i.e., the author) re-enters their rules once.
- Rolling back to the legacy script loses the newly entered rules (different key).
- Opt-in defaults are invisible in effect until a group is enabled; the explorer must
  make the disabled state legible.

## References

- Storage: `src/lib/core/storage.ts`
- Settings/defaults: `src/lib/core/settings.ts`
- Group enable/disable: [ADR 0038](0038-per-group-enable-disable.md)
- Specs: `src/lib/core/__tests__/settings.test.ts`
