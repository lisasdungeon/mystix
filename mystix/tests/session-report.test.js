/**
 * MystiX — tests for the end-of-session report builder (row shaping from
 * session summaries). Card posting itself needs Foundry chat.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { setupFoundryMocks } from "./helpers.js";

setupFoundryMocks();

const { groupLogBySession, summarizeSession } = await import("../scripts/log-viewer.js");
const { getLog } = await import("../scripts/activity-log.js");

const MIN = 60 * 1000;

/** Chronological entry factory. */
function entry(at, actorName, from, to, action = "spend", amount = null) {
    return { at, actorName, action, amount, from, to, userName: "GM", detail: null };
}

describe("session report data shaping", () => {
    it("the latest session is the last group, with each actor's net change", () => {
        const base = new Date(2026, 8, 20, 19, 0).getTime();
        const log = [
            entry(base + 60 * MIN, "Kyra", 3, 2), // latest session
            entry(base + 55 * MIN, "Kyra", 2, 3),
            entry(base + 50 * MIN, "Ezren", 1, 3),
            entry(base, "Kyra", 0, 1), // earlier session (65-minute gap)
        ];
        const sessions = groupLogBySession(log);
        assert.equal(sessions.length, 2);
        const latest = sessions.at(-1);
        const summary = summarizeSession(latest.entries).sort((a, b) => a.actorName.localeCompare(b.actorName));
        assert.equal(summary[0].actorName, "Ezren");
        assert.equal(summary[0].net, 2);
        assert.equal(summary[1].actorName, "Kyra");
        assert.equal(summary[1].net, 0); // −1 +1
        assert.equal(summary[1].start, 2);
        assert.equal(summary[1].end, 2);
    });

    it("handles an empty log by producing no sessions", () => {
        assert.deepEqual(groupLogBySession([]), []);
    });
});
