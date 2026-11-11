/**
 * GM_* polyfill for Playwright addInitScript injection.
 *
 * The userscript expects Tampermonkey-provided globals (`GM_getValue`,
 * `GM_setValue`, `GM_deleteValue`, `GM_listValues`, `GM_registerMenuCommand`,
 * `GM_download` — the grants in vite.config.ts; plus `GM_info`, provided
 * unconditionally). Playwright
 * has no Tampermonkey — this polyfill provides an in-memory + localStorage-backed
 * equivalent so the script boots.
 *
 * ! LOCAL-STORAGE-FIRST reads: this
 *   userscript reads settings at `@run-at document-start` — BEFORE a document
 *   root exists — so reads must work without localStorage. Seeded values are
 *   baked into the script source; writes update memory immediately and mirror
 *   to localStorage once available (reload survival). Reads prefer localStorage
 *   (cross-tab current, Tampermonkey parity — a later-opened dashboard boots
 *   with the CURRENT values), then memory (document-start seed), then default.
 *
 * ! Registered menu commands are recorded so specs can invoke them by label
 *   (`__gmInvoke`) — dashboard-smoke uses this for the menu commands.
 *
 * ! `alert` is no-op'd; `confirm` stays real (dashboard-smoke handles the dialog).
 *   Test-only; Tampermonkey shows real dialogs.
 */

/** localStorage key prefix for persisted GM values. */
const GM_STORAGE_PREFIX = "rrGM_";

/**
 * Builds the JS source string injected into the page BEFORE the userscript.
 *
 * @param seed - Initial GM values (e.g. the pre-seeded settings object the specs
 *   rely on). Serialized into the script source — no document access needed.
 */
export function buildGmPolyfillInitScript(seed: Record<string, unknown> = {}): string {
    return `
    (function() {
      var PREFIX = ${JSON.stringify(GM_STORAGE_PREFIX)};
      var memory = ${JSON.stringify(seed)};

      // * Read preference: localStorage FIRST (when a document root exists),
      //   memory as the document-start fallback — Tampermonkey's GM storage is
      //   shared across tabs, so a LATER-OPENED dashboard must boot with the
      //   CURRENT values, not the baked-in seed.
      // * At document-start (pre-document-root) localStorage may be unavailable
      //   — the seeded memory serves those reads (original design constraint).
      function readRaw(key) {
        try {
          if (document.documentElement) {
            var raw = localStorage.getItem(PREFIX + key);
            if (raw !== null) return JSON.parse(raw);
          }
        } catch (e) {}
        if (Object.prototype.hasOwnProperty.call(memory, key)) return memory[key];
        return undefined;
      }

      window.GM_getValue = function(key, def) {
        var val = readRaw(key);
        return val === undefined ? def : val;
      };

      window.GM_setValue = function(key, val) {
        memory[key] = val;
        try {
          if (document.documentElement) localStorage.setItem(PREFIX + key, JSON.stringify(val));
        } catch (e) {}
      };

      window.GM_deleteValue = function(key) {
        delete memory[key];
        try {
          if (document.documentElement) localStorage.removeItem(PREFIX + key);
        } catch (e) {}
      };

      window.GM_listValues = function() {
        var keys = Object.keys(memory);
        try {
          if (document.documentElement) {
            for (var i = 0; i < localStorage.length; i++) {
              var k = localStorage.key(i);
              if (k && k.indexOf(PREFIX) === 0) {
                var short = k.slice(PREFIX.length);
                if (keys.indexOf(short) === -1) keys.push(short);
              }
            }
          }
        } catch (e) {}
        return keys;
      };

      // * About-tab shape (vite-env.d.ts): script.version etc. — Tampermonkey
      //   fills this from the metadata header; tests use a fixed marker value.
      window.GM_info = {
        version: "0.0.0-polyfill",
        scriptHandler: "playwright",
        script: { name: "Redirect Rules", namespace: "e2e", version: "0.0.0-polyfill", author: "e2e" },
      };

      // * ADR 0012: dashboard host override — the userscript opens the takeover
      //   tab on this FIXTURE path (not the raw.githubusercontent production host)
      //   so the popup stays same-origin: the storage-event-based forwarding
      //   keeps working and no spec touches the live web.
      window.__RR_DASHBOARD_HOST__ = "/rr-dashboard-host";

      window.__gmCommands = [];
      window.GM_registerMenuCommand = function(label, fn, accessKey) {
        window.__gmCommands.push({ label: label, fn: fn, accessKey: accessKey });
      };
      window.__gmInvoke = function(label) {
        var entry = window.__gmCommands.find(function(c) { return c.label === label; });
        if (entry) { entry.fn(); return true; }
        return false;
      };

      // * ADR 0011: GM_openInTab — Playwright does not popup-block, window.open
      //   is an adequate stand-in. The takeover tab re-runs the init scripts
      //   (addInitScript persists) and boots in DASHBOARD MODE via the hash.
      // * ! Firefox automation quirk: window.open WITHOUT user activation can
      //   "succeed" (non-null) while the popup is silently suppressed (no page
      //   appears). The specs dispatch a real click BEFORE invoking menu
      //   commands; this capture stashes its transient activation so the
      //   open path (incl. the delayed retry) can use it.
      // * Retry hedge: GM_openInTab is contractually popup-proof in
      //   Tampermonkey — the polyfill mirrors that with one delayed retry.
      window.__rrLastActivationTs = 0;
      window.addEventListener("click", function() {
        window.__rrLastActivationTs = Date.now();
      }, true);
      window.GM_openInTab = function(url, options) {
        var win = window.open(url, "_blank");
        if (win) return { close: function() { win.close(); }, closed: false, onclose: null };
        // * Retry within the transient-activation window (specs clicked recently).
        window.setTimeout(function() {
          window.open(url, "_blank");
        }, 150);
        return { close: function() {}, closed: false, onclose: null };
      };

      // * Cross-tab value-change listener over the localStorage mirror: the
      //   dashboard tab shares the fixture origin, so 'storage' events fire
      //   there for every GM_setValue the OPENER performs (remote = true).
      // * Same-tab writes do NOT fire 'storage' events — matching the GM
      //   contract (remote flag), which is all the dashboard listens for.
      window.__gmValueListeners = [];
      window.GM_addValueChangeListener = function(key, listener) {
        var entry = {
          key: key,
          listener: listener,
          onStorage: function(ev) {
            if (ev.key !== PREFIX + key) return;
            var value = ev.newValue === null ? undefined : JSON.parse(ev.newValue);
            listener(key, undefined, value, true);
          },
        };
        window.addEventListener("storage", entry.onStorage);
        window.__gmValueListeners.push(entry);
        return window.__gmValueListeners.length;
      };

      // * Chat-Template copy: Tampermonkey's clipboard grant polyfilled
      // as a stashed mirror + best-effort async navigator write — specs can
      // assert __rrClipboard AND the UI's toast receipt either way.
      window.__rrClipboard = "";
      window.GM_setClipboard = function(text) {
        window.__rrClipboard = text;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function() {});
          }
        } catch (e) {}
      };

      // * Settings export: GM_download is page-CSP-exempt in Tampermonkey. The
      //   polyfill decodes the data URL and stashes it so specs can assert the
      //   exported JSON instead of observing a real browser download.
      window.__rrDownloads = [];
      window.GM_download = function(details) {
        var entry = typeof details === "string"
          ? { url: details, name: "" }
          : { url: details.url, name: details.name };
        try {
          var comma = entry.url.indexOf(",");
          entry.text = decodeURIComponent(entry.url.slice(comma + 1));
        } catch (e) {}
        window.__rrDownloads.push(entry);
      };

      // ! Native dialogs (unsaved-changes confirm) would hang Playwright — no-op.
      window.alert = function() {};
    })();
    `;
}

/**
 * Invokes a registered GM menu command by label inside the page.
 *
 * @param page  - The Playwright page.
 * @param label - The exact menu-command label.
 * @returns True if a matching command was found and invoked.
 */
export async function invokeGmCommand(page: import("@playwright/test").Page, label: string): Promise<boolean> {
    return page.evaluate((l) => (window as unknown as { __gmInvoke: (label: string) => boolean }).__gmInvoke(l), label);
}

/**
 * Dispatches a REAL click (transient user activation) and then invokes the menu
 * command — see the GM_openInTab note in {@link buildGmPolyfillInitScript}: a
 * Firefox automation quirk can silently suppress activation-less popups, so the
 * dashboard-opening invocations are always gesture-backed.
 *
 * @param page  - The Playwright page (fixture content; the click hits the body).
 * @param label - The exact menu-command label.
 * @returns True if a matching command was found and invoked.
 */
export async function invokeGmCommandWithGesture(
    page: import("@playwright/test").Page,
    label: string,
): Promise<boolean> {
    await page.mouse.click(5, 5);
    return invokeGmCommand(page, label);
}
