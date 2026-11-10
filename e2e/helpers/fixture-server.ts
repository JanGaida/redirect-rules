import { createServer, type Server } from "node:http";

/**
 * Fixture server — serves hand-built synthetic HTML pages for the E2E suite.
 *
 * ! ADR 0004: these fixtures are SYNTHETIC (no captured DOM, no personal data),
 *   committed to the repo, so E2E runs in CI — unlike youtube-ui-tweaks, whose
 *   captured YouTube fixtures must stay local. No privacy screening needed.
 *
 * Routes are keyed by PATH ONLY (query stripped) — the append-query spec
 * redirects within the same path with a rewritten query string, which must hit
 * the same page. Fragments never reach the server (browser-side).
 *
 * ! Implemented on `node:http` (not Vite middleware) — a bare HTTP server is
 *   simpler and avoids dev-server port coupling for static HTML delivery.
 */

const DEFAULT_FIXTURE_PORT = 4184;

/**
 * Resolves the fixture port from `RR_FIXTURE_PORT` (default 4184).
 *
 * ! Invalid values fail fast — a typo must not silently drift to another port.
 */
function resolveFixturePort(): number {
    const raw = process.env.RR_FIXTURE_PORT;
    if (raw === undefined || raw.trim() === "") return DEFAULT_FIXTURE_PORT;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`RR_FIXTURE_PORT must be an integer 1-65535 (got "${raw}")`);
    }
    return port;
}

// * Single source of truth for the fixture-server port — global-setup and the
//   Playwright baseURL both import it (a hardcoded duplicate drifts silently).
// * 4184 default: 4174 is taken by the youtube-ui-tweaks fixture server (same
//   machine); CI keeps the default and local runs may set RR_FIXTURE_PORT.
export const FIXTURE_SERVER_PORT = resolveFixturePort();

export interface FixtureServer {
    /** Stops the underlying HTTP server. */
    close: () => Promise<void>;
    /** Base URL (e.g. `http://localhost:4184`). */
    base: string;
}

/** Minimal page shell with a body marker naming the fixture (assertion helper). */
function page(title: string, body: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body data-fixture="${title}">${body}</body>
</html>
`;
}

/** All fixture pages, keyed by request path (no query). */
const PAGES: Record<string, string> = {
    "/": page("index", "<h1>index</h1>"),
    // * replace-rule spec: /redirect-me.html → /redirected.html
    "/redirect-me.html": page("redirect-me", "<h1>redirect me</h1>"),
    "/redirected.html": page("redirected", "<h1>redirected target</h1>"),
    // * SPA spec: pushState to /spa-target.html (rule rewrites to the destination)
    "/spa.html": page(
        "spa",
        `<h1>spa host</h1>
<button id="spa-link" onclick="history.pushState({}, '', '/spa-target.html')">spa-go</button>`,
    ),
    "/spa-target.html": page("spa-target", "<h1>spa target</h1>"),
    "/spa-destination.html": page("spa-destination", "<h1>spa destination</h1>"),
    // * append-query spec: params merged into an existing query, fragment preserved
    "/append-page.html": page("append-page", "<h1>append page</h1>"),
    // * loop-guard spec: seeded rules rewrite loop-a → loop-b and back
    "/loop-a.html": page("loop-a", "<h1>loop a</h1>"),
    "/loop-b.html": page("loop-b", "<h1>loop b</h1>"),
};

/**
 * Plain-text fixtures (`text/plain`), keyed by request path (no query).
 */
const TEXT_PAGES: Record<string, string> = {
    // * Dashboard host stub (ADR 0012): mirrors the raw.githubusercontent
    //   placeholder — a text/plain document the takeover tab wipes at boot.
    "/rr-dashboard-host": "rr-dashboard host stub",
};

/**
 * Starts the fixture server.
 *
 * @param port - Port to listen on (default `FIXTURE_SERVER_PORT`).
 * @returns The running server handle (call `.close()` in teardown).
 */
export async function startFixtureServer(port = FIXTURE_SERVER_PORT): Promise<FixtureServer> {
    return new Promise((resolvePromise, rejectPromise) => {
        const server: Server = createServer((req, res) => {
            const path = (req.url ?? "").split("?")[0] || "/";
            const text = TEXT_PAGES[path];
            if (text) {
                res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
                res.end(text);
                return;
            }
            const body = PAGES[path];
            if (body) {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(body);
                return;
            }
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end(`fixture not found: ${path}`);
        });
        server.on("error", rejectPromise);
        server.listen(port, () => {
            const base = `http://localhost:${port}`;
            resolvePromise({
                close: () => new Promise<void>((res) => server.close(() => res())),
                base,
            });
        });
    });
}
