/**
 * MystiX — tests for the per-actor history popout (filtering, lifetime
 * totals, chronological row shaping, GM gating). Dialog rendering needs
 * Foundry and is not covered.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { setupFoundryMocks } from "./helpers.js";

setupFoundryMocks();

const { actorHistory, openActorLog, renderHistoryRow, summarizeHistory } = await import("../scripts/actor-log.js");

const MIN = 60 * 1000;

/** Newest-first entry factory (t = minutes ago from a base instant). */
function entry(at, actorName, from, to, action = "spend", amount = null, detail = null) {
    return { at, actorName, action, amount, from, to, userName: "GM", detail };
}

function sampleHistory() {
    const base = new Date(2026, 8, 20, 19, 0).getTime();
    return [
        // newest first
        entry(base + 60 * MIN, "Kyra", 3, 2, "spend"),
        entry(base + 55 * MIN, "Kyra", 2, 4, "award", 2),
        entry(base + 50 * MIN, "Kyra", 4, 3, "reroll", -1, "Strike (DC 18)"),
        entry(base, "Ezren", 1, 2, "award", 1),
    ];
}

describe("actorHistory", () => {
    it("keeps only the named actor's entries, preserving log order", () => {
        const history = actorHistory("Kyra", sampleHistory());
        assert.equal(history.length, 3);
        assert.ok(history.every((entry) => entry.actorName === "Kyra"));
        assert.equal(history[0].action, "spend"); // newest still first
    });

    it("returns empty for unknown actors, blank names, or empty logs", () => {
        assert.deepEqual(actorHistory("Nobody", sampleHistory()), []);
        assert.deepEqual(actorHistory("", sampleHistory()), []);
        assert.deepEqual(actorHistory("Kyra", []), []);
    });
});

describe("summarizeHistory", () => {
    it("computes lifetime net, spent, gained, and pool progression", () => {
        const summary = summarizeHistory(actorHistory("Kyra", sampleHistory()));
        assert.equal(summary.net, 0); // −1 +2 −1
        assert.equal(summary.spent, 2);
        assert.equal(summary.gained, 2);
        assert.equal(summary.firstPool, 4); // earliest entry's from
        assert.equal(summary.lastPool, 2); // latest entry's to
    });

    it("counts amount-only entries and skips unknown-shaped ones", () => {
        const history = [
            { at: 3, actorName: "Kyra", action: "award", amount: 3, from: null, to: null },
            { at: 2, actorName: "Kyra", action: "mystery" },
        ];
        const summary = summarizeHistory(history);
        assert.equal(summary.net, 3);
        assert.equal(summary.firstPool, null);
        assert.equal(summary.lastPool, null);
    });

    it("returns zeroed totals for an empty history", () => {
        assert.deepEqual(summarizeHistory([]), {
            net: 0,
            spent: 0,
            gained: 0,
            firstPool: null,
            lastPool: null,
        });
    });
});

describe("renderHistoryRow", () => {
    it("shapes a chronological row with pool change and detail", () => {
        const base = new Date(2026, 8, 20, 19, 5).getTime();
        const row = renderHistoryRow(entry(base, "Kyra", 4, 3, "reroll", -1, "Strike (DC 18)"));
        assert.equal(row.when, "2026-09-20 19:05");
        assert.equal(row.action, "MYSTIX.Log.Actions.Reroll");
        assert.equal(row.detail, "Strike (DC 18)");
        assert.equal(row.pool, "4 → 3");
        assert.equal(row.delta, -1);
    });

    it("renders a blank pool for amount-only entries", () => {
        const row = renderHistoryRow({ at: 1, actorName: "Kyra", action: "award", amount: 2, from: null, to: null });
        assert.equal(row.pool, "");
    });
});

describe("openActorLog gating", () => {
    beforeEach(() => {
        game.user.isGM = true;
    });

    it("is GM-only", async () => {
        game.user.isGM = false;
        assert.equal(await openActorLog("Kyra"), false);
        game.user.isGM = true;
    });

    it("refuses blank names without opening anything", async () => {
        assert.equal(await openActorLog(""), false);
        assert.equal(await openActorLog(null), false);
    });
});
