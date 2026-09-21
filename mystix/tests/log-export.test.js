/**
 * MystiX — tests for the log viewer's export helpers (CSV rendering,
 * filenames, clipboard copy, file download). Dialog rendering itself needs
 * Foundry and is not covered here.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { setupFoundryMocks } from "./helpers.js";

setupFoundryMocks();

// Minimal browser shims for the download/copy paths.
class MockBlob {
    constructor(parts, options = {}) {
        this.text = parts.join("");
        this.type = options.type ?? "";
    }
}
class MockURL {
    static created = [];
    static revoked = [];
    static createObjectURL(blob) {
        const url = `blob:mock-${MockURL.created.length + 1}`;
        MockURL.created.push({ url, blob });
        return url;
    }
    static revokeObjectURL(url) {
        MockURL.revoked.push(url);
    }
}
globalThis.Blob = MockBlob;
globalThis.URL = MockURL;

/** Elements created during download/copy, recorded instead of attached. */
const createdElements = [];
globalThis.document = {
    createElement(tag) {
        const element = {
            tagName: tag,
            style: {},
            attributes: {},
            dataset: {},
            clickCalls: 0,
            selectCalls: 0,
            removed: false,
            appendChild() {},
            addEventListener() {},
            setAttribute(name, value) {
                this.attributes[name] = value;
            },
            click() {
                this.clickCalls += 1;
            },
            select() {
                this.selectCalls += 1;
            },
            remove() {
                this.removed = true;
            },
        };
        if (tag === "textarea") element.selectionStart = element.selectionEnd = 0;
        createdElements.push(element);
        return element;
    },
    body: {
        appendChild() {},
        append() {},
    },
    execCommand() {
        return true;
    },
};

const { csvFilename, copyToClipboard, downloadCsv, logToCsv } = await import("../scripts/log-viewer.js");

/**
 * Node 21+ exposes a getter-only `navigator` global; swap its value via
 * defineProperty (the property is configurable) for clipboard tests.
 */
function setNavigator(value) {
    Object.defineProperty(globalThis, "navigator", { value, configurable: true });
}

/** A compact log-entry factory with sane defaults. */
function entry(overrides = {}) {
    return {
        at: new Date(2026, 8, 20, 19, 5).getTime(),
        actorId: "a1",
        actorName: overrides.actorName ?? "Kyra",
        action: overrides.action ?? "spend",
        amount: overrides.amount ?? null,
        from: overrides.from ?? null,
        to: overrides.to ?? null,
        userName: overrides.userName ?? "GM",
        detail: overrides.detail ?? null,
    };
}

/** Reset the browser-shim call records. */
function resetShims() {
    MockURL.created.length = 0;
    MockURL.revoked.length = 0;
    createdElements.length = 0;
    globalThis.document.execCommand = () => true;
}

describe("logToCsv", () => {
    beforeEach(resetShims);

    it("produces a header row plus one row per entry", () => {
        const csv = logToCsv([entry(), entry({ actorName: "Ezren", action: "award", amount: 1 })]);
        const lines = csv.split("\r\n");
        assert.equal(lines.length, 3);
        assert.ok(lines[0].startsWith("Timestamp,Date,Time,Character,Action"));
        assert.ok(lines[1].includes("Kyra"));
        assert.ok(lines[2].includes("Ezren"));
    });

    it("formats timestamps as ISO plus locale date and time", () => {
        const csv = logToCsv([entry()]);
        const [line] = csv.split("\r\n").slice(1); // skip the header row
        const fields = line.split(",");
        assert.match(fields[0], /^\d{4}-\d{2}-\d{2}T/);
        assert.equal(fields[1], "2026-09-20");
        assert.equal(fields[2], "19:05");
    });

    it("includes pool values, detail, and user", () => {
        const row = logToCsv([
            entry({ action: "effect", from: 2, to: 1, detail: "Mystic Surge", userName: "Alice" }),
        ]).split("\r\n")[1];
        assert.ok(row.includes(",2,1,"), "from/to columns present");
        assert.ok(row.includes("Mystic Surge"));
        assert.ok(row.endsWith("Alice"));
    });

    it("quotes fields containing commas, quotes, or newlines", () => {
        const csv = logToCsv([entry({ detail: 'Flavor, "quoted"' })]);
        assert.ok(csv.includes('"Flavor, ""quoted"""'));
    });

    it("handles missing fields as empty strings", () => {
        const row = logToCsv([{ actorName: "Ghost", action: "spend" }]).split("\r\n")[1];
        assert.ok(row.startsWith(",,"), "blank timestamps render as empty fields");
        assert.ok(row.includes("Ghost"));
    });
});

describe("csvFilename", () => {
    it("uses the mystix-log prefix with today's date", () => {
        assert.match(csvFilename(), /^mystix-log-\d{4}-\d{2}-\d{2}\.csv$/);
    });
});

describe("downloadCsv", () => {
    beforeEach(resetShims);

    it("creates a UTF-8 BOM blob, clicks a link, and revokes the URL", () => {
        downloadCsv("a,b\r\nc,d", "mystix-log-test.csv");
        assert.equal(MockURL.created.length, 1);
        const { blob, url } = MockURL.created[0];
        assert.ok(blob.text.startsWith("\uFEFF"), "BOM prepended for Excel");
        assert.equal(blob.type, "text/csv;charset=utf-8");
        const link = createdElements.find((element) => element.tagName === "a");
        assert.equal(link.download, "mystix-log-test.csv");
        assert.equal(link.clickCalls, 1);
        assert.ok(link.removed, "link removed after click");
        assert.deepEqual(MockURL.revoked, [url]);
    });

    it("defaults the filename when none is given", () => {
        downloadCsv("a,b");
        const link = createdElements.find((element) => element.tagName === "a");
        assert.match(link.download, /^mystix-log-\d{4}-\d{2}-\d{2}\.csv$/);
    });
});

describe("copyToClipboard", () => {
    beforeEach(resetShims);

    it("prefers the async clipboard API", async () => {
        let written = null;
        setNavigator({
            clipboard: {
                writeText: async (text) => {
                    written = text;
                },
            },
        });
        const result = await copyToClipboard("csv,data");
        assert.equal(result, true);
        assert.equal(written, "csv,data");
        assert.equal(createdElements.length, 0, "no textarea fallback used");
    });

    it("falls back to a hidden textarea when the API is missing", async () => {
        setNavigator({});
        const result = await copyToClipboard("fallback,data");
        assert.equal(result, true);
        const textarea = createdElements.find((element) => element.tagName === "textarea");
        assert.equal(textarea.value, "fallback,data");
        assert.equal(textarea.selectCalls, 1);
        assert.ok(textarea.removed, "textarea removed after copy");
    });

    it("reports failure when every path throws", async () => {
        setNavigator({});
        globalThis.document.execCommand = () => {
            throw new Error("blocked");
        };
        const result = await copyToClipboard("nope");
        assert.equal(result, false);
    });
});
