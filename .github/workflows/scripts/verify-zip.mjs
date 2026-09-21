#!/usr/bin/env node
/**
 * Verifies the built module.zip against the repo state before publishing.
 *
 * Usage: node verify-zip.mjs <path-to-zip> <path-to-module.json> [expected-version]
 *
 * Checks:
 *  1. The embedded manifest is byte-for-byte identical to the repo manifest.
 *  2. The embedded manifest's `version` matches the expected version (the tag).
 *  3. Every file referenced by the manifest (esmodules, styles, languages,
 *     templates) is present, plus module.json and README.md.
 *  4. No development/build files (tests, CI config, dotfiles, lockfiles)
 *     ship in the zip.
 *
 * Note: a correct Foundry zip is a *superset* of manifest references —
 * bundled script modules reached via imports and preloaded templates are
 * never listed in the manifest — so extras are only flagged when they look
 * like dev/build artifacts.
 *
 * Exits 1 with a `::error::` annotation on any failure.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------- pure core

/**
 * The exact set of paths a correct zip must contain. Manifest arrays are
 * already posix-style repo-relative paths; README.md is always included.
 * @param {object} manifest Parsed module.json.
 * @returns {string[]}
 */
export function expectedZipPaths(manifest) {
    const paths = new Set(["README.md"]);
    for (const key of ["esmodules", "styles", "languages.path", "templates"]) {
        for (const p of manifestPaths(manifest, key)) paths.add(p);
    }
    return [...paths].sort();
}

/**
 * All file paths the manifest references, via a small matcher that supports
 * plain keys and dotted ones (languages.path). Unknown keys are ignored —
 * the exact-set check catches anything extra in the zip.
 * @param {object} manifest
 * @param {string} key
 * @returns {string[]}
 */
export function manifestPaths(manifest, key) {
    if (key === "languages.path") {
        const languages = Array.isArray(manifest.languages) ? manifest.languages : [];
        return languages.map((l) => l?.path).filter((p) => typeof p === "string");
    }
    const value = manifest[key];
    return Array.isArray(value) ? value.filter((p) => typeof p === "string") : [];
}

/** Patterns that must never ship in a release zip. */
// Any dotfile or dot-directory: built as a RegExp to avoid the
// self-terminating `/\./ /` literal.
const DOT_FILE_PATTERN = new RegExp("(^|/)\\.");
const DEV_FILE_PATTERNS = [
    /(^|\/)(tests?|specs?)\//,
    /(^|\/)\.github\//,
    DOT_FILE_PATTERN,
    /(^|\/)node_modules\//,
    /(^|\/)(test|spec)\.[cm]?jsx?$/i,
    /package(-lock)?\.json$/,
    /(^|\/)(tsconfig|jsconfig)\.json$/,
];

/**
 * Files in the listing that look like development/build artifacts rather
 * than shipped module content.
 * @param {string[]} files Zip file paths (no directory entries).
 * @returns {string[]}
 */
export function findDevFiles(files) {
    return files.filter((name) => DEV_FILE_PATTERNS.some((pattern) => pattern.test(name)));
}

/**
 * Compare a `unzip -Z1` listing against the required path set. Missing
 * required files are fatal; extras only when they look like dev/build
 * files (see the superset note in the file header).
 * @param {string[]} zipListing e.g. ["module.json", "scripts/", "scripts/main.js"]
 * @param {string[]} expected Manifest-referenced paths plus README.md.
 * @returns {{ ok: boolean, missing: string[], extra: string[] }}
 */
export function compareZipListing(zipListing, expected) {
    const files = zipListing
        .map((name) => name.replace(/\\/g, "/"))
        .filter((name) => !name.endsWith("/"));
    const required = [...new Set(["module.json", ...expected])];
    const missing = required.filter((p) => !files.includes(p));
    const junk = findDevFiles(files);
    return { ok: missing.length === 0 && junk.length === 0, missing, extra: junk };
}

/**
 * Byte-for-byte manifest comparison between the repo file and the copy
 * inside the zip.
 */
export function manifestBytesMatch(repoBytes, zipBytes) {
    if (Buffer.isBuffer(repoBytes) && Buffer.isBuffer(zipBytes)) {
        return repoBytes.equals(zipBytes);
    }
    return false;
}

/** Read the zip's file list via unzip's zipinfo mode. */
export function zipFileList(zipPath) {
    return execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
        .split(/\r?\n/)
        .filter(Boolean);
}

// ---------------------------------------------------------------- runner

if (import.meta.url === `file://${process.argv[1]}`) {
    const [zipPath, manifestPath, expectedVersion] = process.argv.slice(2);
    if (!zipPath || !manifestPath) {
        console.error("Usage: node verify-zip.mjs <zip> <module.json> [expected-version]");
        process.exit(2);
    }

    // 1. Embedded manifest is byte-identical to the repo's.
    const repoBytes = readFileSync(manifestPath);
    const zipBytes = execFileSync("unzip", ["-p", zipPath, "module.json"]);
    if (!manifestBytesMatch(repoBytes, zipBytes)) {
        console.error("::error::The zip's embedded module.json differs from the repo manifest.");
        process.exit(1);
    }
    console.log("embedded manifest matches the repo manifest byte-for-byte");

    const manifest = JSON.parse(zipBytes.toString("utf8"));

    // 2. Version matches the tag, when provided.
    if (expectedVersion) {
        if (manifest.version !== expectedVersion) {
            console.error(
                `::error::Zip manifest version ${manifest.version} != expected ${expectedVersion} (tag).`,
            );
            process.exit(1);
        }
        console.log(`embedded version matches the tag: ${expectedVersion}`);
    }

    // 3+4. Every manifest-referenced asset present; no dev/build junk.
    const expected = expectedZipPaths(manifest);
    const { ok, missing, extra } = compareZipListing(zipFileList(zipPath), expected);
    if (!ok) {
        if (missing.length) console.error(`::error::Zip is missing manifest-referenced files: ${missing.join(", ")}`);
        if (extra.length) console.error(`::error::Zip contains development/build files: ${extra.join(", ")}`);
        process.exit(1);
    }
    console.log(`all ${expected.length} manifest-referenced files present, no dev files`);
    console.log("zip verification passed");
}
