#!/usr/bin/env node
/**
 * Verifies a version has a changelog entry in the README.
 *
 * Usage: node scripts/check-changelog.mjs <version> [readme-path]
 *
 * Expects Foundry-listing-style entries: `### [x.y.z] — date` (the dash
 * may be an ASCII hyphen or an em/en dash). Exits 1 with a friendly
 * message when the entry is missing.
 */
import { readFileSync } from "node:fs";

const version = process.argv[2];
const readmePath = process.argv[3] ?? "README.md";

if (!version) {
    console.error("Usage: node check-changelog.mjs <version> [readme-path]");
    process.exit(2);
}

const readme = readFileSync(readmePath, "utf8");
const heading = new RegExp(`^### \\[${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`, "m");

if (heading.test(readme)) {
    console.log(`changelog entry found for ${version} in ${readmePath}`);
} else {
    console.error(`::error::No changelog entry for version ${version} in ${readmePath}.`);
    console.error("Add a '### [" + version + "] — date' section to the Changelog in the README, then re-tag.");
    process.exit(1);
}
