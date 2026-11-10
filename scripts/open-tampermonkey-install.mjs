import { createServer } from "node:http";
import { access, readFile, writeFile, unlink } from "node:fs/promises";
import { join, relative, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import process from "node:process";

const HARD_TIMEOUT_MS = 30000;
const GRACEFUL_DELAY_MS = 4000;
const PORT_MIN = 8765;
const PORT_MAX = 8775;

function usageAndExit(message) {
    if (message) process.stderr.write(`${message}\n`);
    process.stderr.write(
        "Usage: node scripts/open-tampermonkey-install.mjs [path-to-artifact.user.js]\n" +
            "Default: dist/redirect-rules.user.js\n",
    );
    process.exit(1);
}

const defaultTarget = "dist/redirect-rules.user.js";
const rawArg = process.argv[2] ?? defaultTarget;
const targetPath = resolve(process.cwd(), rawArg);

if (!targetPath.endsWith(".user.js")) {
    usageAndExit("Argument must point to a *.user.js file.");
}

let rootDir;
let relativePath;
try {
    await access(targetPath);
} catch {
    usageAndExit(`File not found: ${targetPath}`);
}

rootDir = dirname(targetPath);
relativePath = relative(rootDir, targetPath).split("\\").join("/");
if (relativePath.includes("..")) {
    usageAndExit("Artifact path is invalid.");
}

const urlPath = `/${relativePath}`;

let served = false;
let shuttingDown = false;

async function openBrowser(url) {
    // * Tampermonkey (Firefox) cancels the .user.js navigation and opens its
    // * install page in a NEW tab; if the original navigation is a history
    // * entry the cancelled tab stays behind as a blank page. Using location.replace
    // * on a throw-away shim makes the .user.js navigation replace that one-shot
    // * entry, so Firefox drops the cancelled tab and only the install tab remains.
    let target = url;
    if (url.endsWith(".user.js")) {
        const shimPath = join(tmpdir(), `redirect-rules-install-${process.pid}.html`);
        const shimHtml = `<!doctype html><meta charset="utf-8"><title>Redirect Rules install</title><script>location.replace(${JSON.stringify(
            url,
        )});window.setTimeout(function(){try{window.close();}catch(e){}},150);</script>`;
        try {
            await writeFile(shimPath, shimHtml, "utf8");
            target = pathToFileURL(shimPath).href;
            const cleanup = setTimeout(() => {
                void unlink(shimPath).catch(() => undefined);
            }, 15000);
            cleanup.unref();
        } catch (error) {
            process.stderr.write(`Could not write install shim: ${error?.message ?? error}\n`);
            target = url;
        }
    }

    let command;
    let args;
    if (process.platform === "win32") {
        command = "cmd";
        args = ["/c", "start", "", target];
    } else if (process.platform === "darwin") {
        command = "open";
        args = [target];
    } else {
        command = "xdg-open";
        args = [target];
    }
    try {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.unref();
    } catch (error) {
        process.stderr.write(`Could not open browser: ${error?.message ?? error}\n`);
    }
}

function scheduleShutdown(server) {
    if (shuttingDown) return;
    shuttingDown = true;
    setTimeout(() => {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 2000).unref();
    }, GRACEFUL_DELAY_MS);
}

function listenOnPort(server, port) {
    return new Promise((resolvePromise, reject) => {
        const onError = (err) => {
            server.removeListener("listening", onListening);
            reject(err);
        };
        const onListening = () => {
            server.removeListener("error", onError);
            resolvePromise();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
    });
}

const server = createServer(async (req, res) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
    } catch {
        res.statusCode = 400;
        res.end();
        return;
    }

    if (pathname !== urlPath) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Not found");
        return;
    }

    try {
        const body = await readFile(targetPath);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Content-Length", String(body.length));
        res.end(body);

        if (!served) {
            served = true;
            process.stdout.write(`Served ${targetPath}\n`);
            scheduleShutdown(server);
        }
    } catch (error) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(String(error?.message ?? error));
    }
});

let chosenPort = null;
for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
    try {
        await listenOnPort(server, port);
        chosenPort = port;
        break;
    } catch (error) {
        if (error?.code !== "EADDRINUSE") {
            process.stderr.write(`Failed to listen: ${error?.message ?? error}\n`);
            process.exit(1);
        }
    }
}

if (chosenPort === null) {
    process.stderr.write(`No available port in ${PORT_MIN}-${PORT_MAX}.\n`);
    process.exit(1);
}

// * A normal timer keeps the process alive until the hard timeout.
setTimeout(() => {
    if (!served) {
        process.stderr.write(`Timed out after ${HARD_TIMEOUT_MS} ms before the artifact was served.\n`);
        process.exit(1);
    }
    process.exit(0);
}, HARD_TIMEOUT_MS);

const url = `http://127.0.0.1:${chosenPort}/${relativePath}`;
process.stdout.write(`Tampermonkey install URL: ${url}\n`);

await openBrowser(url);
