import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import monkey from "vite-plugin-monkey";
import mkcert from "vite-plugin-mkcert";
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { COMPILE_TIME_DATA_FILES, compileTimeDefines } from "./scripts/build-defines.ts";

/** Userscript icon: published asset referenced by its stable CDN URL — never inlined. */
const APP_ICON_URL = "https://cdn.jsdelivr.net/gh/JanGaida/redirect-rules@main/assets/icons/app/icon.svg";

const gitValue = (args: string[]): string => {
    try {
        return execFileSync("git", args, {
            cwd: process.cwd(),
            stdio: ["ignore", "pipe", "ignore"],
            encoding: "utf8",
        }).trim();
    } catch {
        return "unknown";
    }
};
const BUILD_SHA = gitValue(["rev-parse", "--short=12", "HEAD"]);
const BUILD_DATE = gitValue(["show", "-s", "--format=%cI", "HEAD"]);

export default defineConfig(({ command, mode }) => {
    const DEV = process.env.RR_DEV === "1" || mode === "development";
    const SERVE = command === "serve";

    return {
        server: {
            host: "127.0.0.1",
            port: 5173,
            strictPort: true,
            hmr: {
                protocol: "wss",
                host: "127.0.0.1",
                port: 5173,
                clientPort: 5173,
            },
            overlay: false,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Allow-Private-Network": "true",
                // * Firefox kept serving a stale 304 (empty body) for /@vite/client and
                // * /src/main.ts from its disk cache (deliveryType: \"cache\"), causing
                // * "Loading failed for the module …". Force dev resources to be
                // * non-cacheable so a hot-reload cannot resurrect a corrupt entry.
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                Pragma: "no-cache",
                Expires: "0",
            },
        },
        define: compileTimeDefines({ dev: DEV, buildSha: BUILD_SHA, buildDate: BUILD_DATE }),

        build: {
            minify: DEV ? false : "terser",
            sourcemap: false,
            terserOptions: {
                format: {
                    max_line_len: 2000,
                    comments: false,
                },
                compress: !DEV,
                mangle: !DEV,
            },
        },

        plugins: [
            svelte(),
            ...(SERVE ? [mkcert()] : []),
            // * Firefox reported NS_ERROR_CORRUPTED_CONTENT over HTTP/2 (empty module
            //   bodies). Force ALPN to HTTP/1.1 so Vite never negotiates h2 locally.
            ...(SERVE
                ? [
                      {
                          name: "force-http1-alpn",
                          configResolved(config: import("vite").ResolvedConfig) {
                              const https = config.server?.https as
                                  { ALPNProtocols?: string[]; ALPNCallback?: (arg: unknown) => string } | undefined;
                              if (https) {
                                  https.ALPNCallback = () => "http/1.1";
                              }
                          },
                      },
                  ]
                : []),

            // * 1. Dev-server routing (serve only): root -> control center.
            //   /__vite-plugin-monkey.* stays untouched so the monkey loaders work.
            ...(SERVE
                ? [
                      {
                          name: "dev-control-center-routing",
                          configureServer(server: import("vite").ViteDevServer) {
                              // * Pre-middleware: artifact headers must win over Vite's static handler.
                              server.middlewares.use(
                                  (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
                                      const url = req.url?.split("?")[0];
                                      if (url === "/" || url === "") {
                                          req.url = "/index.html";
                                          return next();
                                      }
                                      // * Serve the built dev/prod artifacts (gitignored output
                                      //   dir) directly so the control-center install link and
                                      //   the Tampermonkey install dialog work in dev. Vite's
                                      //   default fs handling would otherwise fall back to HTML.
                                      if (url?.startsWith("/dist/") && url.endsWith(".user.js")) {
                                          const relative = url.slice(1);
                                          // ! Never serve outside /dist — reject traversal segments.
                                          if (relative.split("/").includes("..")) {
                                              res.statusCode = 400;
                                              res.end();
                                              return;
                                          }
                                          try {
                                              const file = join(process.cwd(), relative);
                                              const stat = statSync(file);
                                              if (!stat.isFile()) return next();
                                              res.statusCode = 200;
                                              res.setHeader("Content-Type", "application/javascript; charset=utf-8");
                                              // * The dev control center reads these for artifact status.
                                              res.setHeader("Content-Length", String(stat.size));
                                              res.setHeader("Last-Modified", stat.mtime.toUTCString());
                                              // * Keep the no-cache contract from server.headers for the
                                              //   directly-served dev bundle too (Vite's global headers
                                              //   do not apply to this custom branch).
                                              res.setHeader(
                                                  "Cache-Control",
                                                  "no-store, no-cache, must-revalidate, max-age=0",
                                              );
                                              res.setHeader("Pragma", "no-cache");
                                              res.setHeader("Expires", "0");
                                              if (req.method === "HEAD") {
                                                  res.end();
                                                  return;
                                              }
                                              res.end(readFileSync(file));
                                              return;
                                          } catch {
                                              return next();
                                          }
                                      }
                                      next();
                                  },
                              );
                          },
                      },
                  ]
                : []),

            // * Compile-time data (i18n, chat templates, changelog) is baked into
            //   __*_B64__ at config load. Restart the dev server on edits so the
            //   browser never keeps a stale dictionary/icons bundle.
            ...(SERVE
                ? [
                      {
                          name: "restart-on-compile-time-data-change",
                          configureServer(server: import("vite").ViteDevServer) {
                              server.watcher.on("change", (file: string) => {
                                  const normalized = file.replace(/\\/g, "/");
                                  if (!COMPILE_TIME_DATA_FILES.some((target) => normalized.endsWith(target))) {
                                      return;
                                  }
                                  void server.restart();
                              });
                          },
                      },
                  ]
                : []),

            // * 2. Monkey plugin (build only; serve stays the Vite control center).
            ...(!SERVE
                ? [
                      monkey({
                          entry: "src/main.ts",
                          build: {
                              fileName: DEV ? "redirect-rules.dev.user.js" : "redirect-rules.user.js",
                          },
                          userscript: {
                              name: "Redirect Rules",
                              description: "Regex-based URL rewriter/redirector with a rule editor GUI.",
                              namespace: "https://github.com/JanGaida/redirect-rules",
                              author: "Jan Gaida",
                              license: "GPL-3.0",
                              icon: APP_ICON_URL,
                              icon64: APP_ICON_URL,
                              match: ["*://*/*"],
                              noframes: true,
                              grant: [
                                  "GM_getValue",
                                  "GM_setValue",
                                  "GM_deleteValue",
                                  "GM_registerMenuCommand",
                                  "GM_openInTab",
                                  "GM_addValueChangeListener",
                                  "GM_setClipboard",
                              ],
                              "run-at": "document-start",
                              homepage: "https://github.com/JanGaida/redirect-rules",
                              // * ADR 0015 decision 3: dev builds carry no update/download
                              //   URLs, so a local dev install stays until prod is reinstalled.
                              ...(DEV
                                  ? {}
                                  : {
                                        updateURL:
                                            "https://github.com/JanGaida/redirect-rules/releases/latest/download/redirect-rules.user.js",
                                        downloadURL:
                                            "https://github.com/JanGaida/redirect-rules/releases/latest/download/redirect-rules.user.js",
                                    }),
                          },
                      }),
                  ]
                : []),
        ],
    };
});
