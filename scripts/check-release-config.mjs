// ─────────────────────────────────────────────────────────────────────────────
// MARK: check-release-config — release-please wiring invariants
// ─────────────────────────────────────────────────────────────────────────────
// * Gate, not linter: bootstrap state + config shape before a push.
// * Bootstrap states: manifest 0.0.0 (pre-release main) -> first PR is 1.0.0;
//   manifest 1.0.0 + skip-changelog on the 1.0.0 release PR (bootstrap pending);
//   after the v1.0.0 tag skip-changelog is tolerated but MUST be removed before
//   the next release PR (1.1.0+), which fails while it is still present.
// * Empirical first-run verification needs a GitHub remote + token; this gate
//   covers everything that can be checked offline.
// * Exit 1 on drift; prints the active bootstrap mode as context.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) => JSON.parse(readFileSync(join(root, name), "utf8"));

const errors = [];
const fail = (message) => errors.push(message);

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const manifest = readJson(".release-please-manifest.json");
const config = readJson("release-please-config.json");
const pkgConfig = config.packages?.["."];
const version = pkg.version;
const manifestVersion = manifest["."];
const skipChangelog = pkgConfig?.["skip-changelog"] === true;
const releaseAs = pkgConfig?.["release-as"] ?? config["release-as"];
const initialRelease = version === "1.0.0";
// * release-please opens its PR from a `release-please--…` branch.
const isReleasePr = (process.env.GITHUB_HEAD_REF ?? "").startsWith("release-please--");

// * Config shape invariants — independent of the bootstrap phase.
if (!pkgConfig || typeof pkgConfig !== "object") {
    fail('release-please-config.json is missing packages["."]');
} else {
    if (!["simple", "node"].includes(pkgConfig["release-type"])) {
        fail(`unexpected release-type ${String(pkgConfig["release-type"])}`);
    }
    if (pkgConfig["include-component-in-tag"] !== false) {
        fail('include-component-in-tag must be false so tags are "vX.Y.Z"');
    }
    const changelogPath = pkgConfig["changelog-path"] ?? "CHANGELOG.md";
    if (!existsSync(join(root, changelogPath))) fail(`missing changelog ${changelogPath}`);
    const extraFiles = Array.isArray(pkgConfig["extra-files"]) ? pkgConfig["extra-files"] : [];
    // * Every version mirror must be bumped together: package.json + both
    //   package-lock.json version fields (npm root + the "" packages entry).
    const bumpTargets = [
        { path: "package.json", jsonpath: "$.version" },
        { path: "package-lock.json", jsonpath: "$.version" },
        { path: "package-lock.json", jsonpath: "$.packages[''].version" },
    ];
    for (const target of bumpTargets) {
        const bumped = extraFiles.some(
            (entry) => entry?.type === "json" && entry.path === target.path && entry.jsonpath === target.jsonpath,
        );
        if (!bumped) fail(`extra-files does not bump ${target.path} at ${target.jsonpath}`);
    }
}

// * Drift guard: both lock-file mirrors must already agree with package.json.
if (lock.version !== version) {
    fail(`package-lock.json version ${String(lock.version)} does not match package.json ${version}`);
}
if (lock.packages?.[""]?.version !== version) {
    fail(
        `package-lock.json packages[""].version ${String(lock.packages?.[""]?.version)} does not match package.json ${version}`,
    );
}

if (!existsSync(join(root, "CHANGELOG.md"))) {
    fail("missing CHANGELOG.md");
} else if (!/^##\s+\[?1\.0\.0\]?/m.test(readFileSync(join(root, "CHANGELOG.md"), "utf8"))) {
    fail("CHANGELOG.md is missing the 1.0.0 init entry");
}

let mode;
if (manifestVersion === "0.0.0") {
    // * Pre-release main: no release yet, the first PR is the initial version.
    if (version !== "1.0.0") {
        fail(`bootstrap expects package.json 1.0.0 (initialReleaseVersion), found ${version}`);
    }
    if (!skipChangelog) {
        fail('bootstrap requires "skip-changelog": true to preserve the init changelog entry');
    }
    if (releaseAs !== undefined) {
        fail('remove "release-as" — the empty manifest already yields 1.0.0');
    }
    mode = "bootstrap";
} else if (manifestVersion === version) {
    if (isReleasePr) {
        // * The 1.0.0 release PR bumps the manifest before the tag exists and keeps
        //   skip-changelog; later release PRs must already have it removed.
        if (initialRelease && !skipChangelog) {
            fail('the 1.0.0 bootstrap release PR must keep "skip-changelog": true');
        }
        if (!initialRelease && skipChangelog) {
            fail(`the ${version} release PR must not carry "skip-changelog" — 1.0.0 is released`);
        }
        mode = "release-pr";
    } else {
        // * Released 1.0.0 still tolerates skip-changelog on main; any later
        //   released version and every non-bootstrap state must have it gone.
        if (!initialRelease && skipChangelog) {
            fail(`remove "skip-changelog" now that ${version} is released`);
        }
        if (releaseAs !== undefined) fail(`remove "release-as" now that ${version} is released`);
        mode = "released";
    }
} else {
    fail(`manifest ${String(manifestVersion)} must be "0.0.0" (pre-release) or "${version}" (released)`);
}

for (const key of ["bootstrap-sha", "last-release-sha"]) {
    if (key in config) fail(`config override "${key}" present — review the first-run plan`);
}

if (errors.length > 0) {
    console.error("release-config check failed:");
    for (const message of errors) console.error(`  - ${message}`);
    process.exit(1);
}

const detail = {
    bootstrap: "pre-release: the first PR is 1.0.0; skip-changelog preserves the init entry",
    "release-pr": initialRelease
        ? "1.0.0 bootstrap PR pending: manifest bumped, skip-changelog kept"
        : `${version} release PR pending: skip-changelog already removed after 1.0.0`,
    released: initialRelease
        ? skipChangelog
            ? "1.0.0 released: skip-changelog tolerated but remove it before the next release PR"
            : "1.0.0 released: changelog maintenance is active"
        : `${version} released: changelog maintenance is active`,
};
console.log(`release-config OK — ${detail[mode]}`);
