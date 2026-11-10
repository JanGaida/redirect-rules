import { FIXTURE_SERVER_PORT, startFixtureServer, type FixtureServer } from "./helpers/fixture-server";

/**
 * Playwright globalSetup — starts the fixture server and returns its teardown.
 *
 * ! Runs once before all tests. The server serves the synthetic fixture pages at
 *   http://localhost:<RR_FIXTURE_PORT|4184>.
 */

let server: FixtureServer | null = null;

export default async function globalSetup(): Promise<() => Promise<void>> {
    server = await startFixtureServer();
    // * Playwright forwards globalSetup env changes to workers; the config's
    //   baseURL and this server share FIXTURE_SERVER_PORT, so they never diverge.
    process.env.RR_FIXTURE_PORT = String(FIXTURE_SERVER_PORT);
    console.log(`[e2e] fixture server ready at ${server.base}`);
    // * Returned teardown (documented Playwright pattern): the handle stays in
    //   this process instead of relying on global-teardown module state.
    return stopFixtureServer;
}

/** Stops the fixture server once — safe to call from both teardown paths. */
export async function stopFixtureServer(): Promise<void> {
    const running = server;
    server = null;
    if (!running) return;
    await running.close();
    console.log("[e2e] fixture server stopped");
}
