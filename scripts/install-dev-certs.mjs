// ─────────────────────────────────────────────────────────────────────────────
// MARK: install-dev-certs — trusted local CA for the HTTPS dev server
// ─────────────────────────────────────────────────────────────────────────────
// * mkcert installs the CA into the OS + Firefox trust stores on first run, which
// *   needs an elevated/UAC-confirmed step. Running `npm run dev` directly may
// *   surface the same prompts mid-development; this task surfaces them once.
import { createConnection } from "node:net";
import { spawn } from "node:child_process";

function portOpen(host, port) {
    return new Promise((resolve) => {
        const socket = createConnection({ host, port });
        const finish = (value) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(value);
        };
        socket.setTimeout(500);
        socket.on("connect", () => finish(true));
        socket.on("timeout", () => finish(false));
        socket.on("error", () => finish(false));
    });
}

if (await portOpen("127.0.0.1", 5173)) {
    console.log("[dev:certs] dev server already running on 127.0.0.1:5173; treating CA as installed.");
    process.exit(0);
}

const child = spawn("npm run dev", {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
});

let done = false;
let killTimer = null;
const killTree = () => {
    if (process.platform === "win32") {
        // * On Windows, `child.kill()` only signals the shell; taskkill
        // terminates the whole npm -> vite process tree.
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            shell: false,
        });
        killer.on("error", () => {
            try {
                child.kill();
            } catch {
                // * Best-effort cleanup.
            }
        });
        return;
    }
    try {
        child.kill("SIGTERM");
    } catch {
        // * Best-effort cleanup.
    }
};

const onData = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
    if (!done && /ready in \d+ ms/i.test(plain)) {
        done = true;
        killTimer = setTimeout(killTree, 500);
    }
};

const safetyTimer = setTimeout(() => {
    if (done) return;
    process.exitCode = 1;
    console.error("[dev:certs] timed out waiting for the dev server to become ready.");
    killTree();
}, 30000);

child.stdout.on("data", onData);
child.stderr.on("data", onData);

child.on("error", (error) => {
    clearTimeout(safetyTimer);
    console.error(`[dev:certs] failed to start dev server: ${error.message}`);
    process.exit(1);
});

child.on("exit", (code, signal) => {
    clearTimeout(safetyTimer);
    if (killTimer) clearTimeout(killTimer);
    if (done) {
        console.log(
            "[dev:certs] trusted-CA step completed; dev server stopped. You can now run 'Dev Server' without certificate popups.",
        );
        process.exit(0);
    }
    console.error(`[dev:certs] dev server exited before CA install (code ${code}, signal ${signal}).`);
    // * Exiting before "ready" means the CA install never completed, even if
    //   the child itself reported success.
    process.exit(code === null || code === 0 ? 1 : code);
});
