import { stopFixtureServer } from "./global-setup";

/**
 * Playwright globalTeardown — fallback stop for the fixture server.
 *
 * * The primary teardown is the function returned by globalSetup; this hook is
 *   idempotent, so whichever path runs first closes the server exactly once.
 */
export default async function globalTeardown(): Promise<void> {
    await stopFixtureServer();
}
