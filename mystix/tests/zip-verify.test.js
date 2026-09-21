/**
 * MystiX — tests for the release workflow's zip-verification logic
 * (manifest path extraction, zip listing comparison, dev-file detection).
 * The CLI runner itself is exercised against a real zip in CI.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    compareZipListing,
    expectedZipPaths,
    findDevFiles,
    manifestBytesMatch,
    manifestPaths,
} from "../../.github/workflows/scripts/verify-zip.mjs";

/** The MystiX manifest shape, reduced to what the functions read. */
const MANIFEST = {
    version: "0.2.8",
    esmodules: ["scripts/main.js"],
    styles: ["styles/mystix.css"],
    languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
    templates: ["templates/party-hud.hbs"],
};

describe("manifestPaths", () => {
    it("collects plain array keys", () => {
        assert.deepEqual(manifestPaths(MANIFEST, "esmodules"), ["scripts/main.js"]);
        assert.deepEqual(manifestPaths(MANIFEST, "styles"), ["styles/mystix.css"]);
    });

    it("unwraps languages[].path", () => {
        assert.deepEqual(manifestPaths(MANIFEST, "languages.path"), ["lang/en.json"]);
    });

    it("tolerates missing or malformed keys", () => {
        assert.deepEqual(manifestPaths({}, "esmodules"), []);
        assert.deepEqual(manifestPaths({ esmodules: "not-an-array" }, "esmodules"), []);
        assert.deepEqual(manifestPaths({ languages: [{}, { path: "lang/de.json" }] }, "languages.path"), ["lang/de.json"]);
    });
});

describe("expectedZipPaths", () => {
    it("includes every manifest reference plus README.md", () => {
        assert.deepEqual(expectedZipPaths(MANIFEST), [
            "README.md",
            "lang/en.json",
            "scripts/main.js",
            "styles/mystix.css",
            "templates/party-hud.hbs",
        ]);
    });
});

describe("compareZipListing", () => {
    const goodListing = [
        "README.md",
        "lang/",
        "lang/en.json",
        "module.json",
        "scripts/",
        "scripts/main.js",
        "scripts/core.js",
        "styles/",
        "styles/mystix.css",
        "templates/",
        "templates/party-hud.hbs",
    ];

    it("passes when all required files are present (extras allowed)", () => {
        const result = compareZipListing(goodListing, expectedZipPaths(MANIFEST));
        assert.equal(result.ok, true);
        assert.deepEqual(result.missing, []);
        // scripts/core.js is bundled-but-unlisted: allowed superset content.
        assert.deepEqual(result.extra, []);
    });

    it("flags a missing manifest-referenced file", () => {
        const result = compareZipListing(
            goodListing.filter((name) => name !== "styles/mystix.css"),
            expectedZipPaths(MANIFEST),
        );
        assert.equal(result.ok, false);
        assert.deepEqual(result.missing, ["styles/mystix.css"]);
    });

    it("flags dev/build files among the extras", () => {
        const result = compareZipListing([...goodListing, "tests/core.test.js", ".github/workflows/ci.yml"], expectedZipPaths(MANIFEST));
        assert.equal(result.ok, false);
        assert.deepEqual(result.extra, ["tests/core.test.js", ".github/workflows/ci.yml"]);
    });

    it("ignores directory entries and normalizes backslashes", () => {
        const result = compareZipListing(["module.json", "scripts\\", "scripts\\main.js"], ["scripts/main.js"]);
        assert.equal(result.ok, true);
    });
});

describe("findDevFiles", () => {
    it("recognizes test, CI, dependency, and config artifacts", () => {
        assert.deepEqual(
            findDevFiles([
                "tests/helpers.js",
                "test/foo.js",
                "spec/bar.jsx",
                ".github/workflows/release.yml",
                ".gitignore",
                "node_modules/left-pad/index.js",
                "package.json",
                "package-lock.json",
                "tsconfig.json",
            ]),
            [
                "tests/helpers.js",
                "test/foo.js",
                "spec/bar.jsx",
                ".github/workflows/release.yml",
                ".gitignore",
                "node_modules/left-pad/index.js",
                "package.json",
                "package-lock.json",
                "tsconfig.json",
            ],
        );
    });

    it("leaves shipped module content alone", () => {
        assert.deepEqual(
            findDevFiles(["module.json", "README.md", "scripts/main.js", "lang/en.json", "styles/mystix.css"]),
            [],
        );
    });
});

describe("manifestBytesMatch", () => {
    it("accepts identical buffers and rejects different ones", () => {
        const a = Buffer.from('{"version":"0.2.8"}');
        assert.equal(manifestBytesMatch(a, Buffer.from(a)), true);
        assert.equal(manifestBytesMatch(a, Buffer.from('{"version":"0.2.9"}')), false);
    });

    it("rejects non-buffer input", () => {
        assert.equal(manifestBytesMatch("text", Buffer.from("text")), false);
        assert.equal(manifestBytesMatch(null, null), false);
    });
});
