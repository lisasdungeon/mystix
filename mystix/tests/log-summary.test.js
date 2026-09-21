/**
 * MystiX — tests for the log viewer's per-session, per-actor summary
 * engine (session grouping, net-change accounting, view-mode persistence).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { setupFoundryMocks } from "./helpers.js";

setupFoundryMocks();

const { cleanLogFilters, groupLogByDay, groupLogBySession, summarizeSession } = await import("../scripts/log-viewer.js");

const MIN = 60 * 1000;

/** Chronological entry factory (older sessions first in test fixtures). */
function entry(at, actorName, from, to, action = "spend", amount = null) {
    return { at, actorName, action, amount, from, to, userName: "GM", detail: null };
}

describe("groupLogBySession", () => {
    it("splits the log when entries are more than 30 minutes apart", () => {
        const log = [
            entry(100 * MIN, "Kyra", 0, 1),
            entry(80 * MIN, "Kyra", 1, 0),
            entry(10 * MIN, "Ezren", 2, 1), // 70-minute gap above
            entry(5 * MIN, "Ezren", 3, 2),
        ];
        const sessions = groupLogBySession(log);
        assert.equal(sessions.length, 2);
        assert.equal(sessions[0].entries.length, 2); // oldest session first
        assert.equal(sessions[0].start, 5 * MIN);
        assert.equal(sessions[1].end, 100 * MIN);
    });

    it("keeps entries within the gap in one chronological session", () => {
        const log = [
            entry(30 * MIN, "Kyra", 0, 1),
            entry(25 * MIN, "Kyra", 1, 2),
            entry(20 * MIN, "Kyra", 2, 3),
        ];
        const sessions = groupLogBySession(log);
        assert.equal(sessions.length, 1);
        assert.equal(sessions[0].entries[0].from, 2); // oldest entry first
        assert.equal(sessions[0].start, 20 * MIN);
        assert.equal(sessions[0].end, 30 * MIN);
    });

    it("honors a custom gap threshold", () => {
        const log = [entry(10 * MIN, "Kyra", 0, 1), entry(5 * MIN, "Kyra", 1, 2)];
        assert.equal(groupLogBySession(log, 6 * MIN).length, 1); // 5-minute gap < 6
        assert.equal(groupLogBySession(log, 4 * MIN).length, 2); // 5-minute gap > 4
    });

    it("handles empty logs and invalid timestamps without throwing", () => {
        assert.deepEqual(groupLogBySession([]), []);
        const messy = [{ at: "not-a-number", actorName: "X" }, entry(10 * MIN, "Kyra", 0, 1)];
        assert.ok(groupLogBySession(messy).length >= 1);
    });
});

describe("summarizeSession", () => {
    it("computes net change, spent, gained, and start→end pool per actor", () => {
        const entries = [
            entry(10 * MIN, "Kyra", 2, 1), // spend
            entry(12 * MIN, "Kyra", 1, 3), // +2 award
            entry(15 * MIN, "Kyra", 3, 2), // spend
            entry(9 * MIN, "Ezren", 1, 3), // +2 grant
        ];
        const summary = summarizeSession(entries);
        const kyra = summary.find((stat) => stat.actorName === "Kyra");
        const ezren = summary.find((stat) => stat.actorName === "Ezren");
        assert.equal(kyra.net, 0); // −1 spent, +2 gained
        assert.equal(kyra.spent, 2);
        assert.equal(kyra.gained, 2);
        assert.equal(kyra.start, 2); // earliest from
        assert.equal(kyra.end, 2); // latest to
        assert.equal(ezren.net, 2);
        assert.equal(ezren.spent, 0);
        assert.equal(ezren.gained, 2);
    });

    it("falls back to amount when from/to are missing", () => {
        const entries = [
            { at: 1, actorName: "Kyra", action: "award", amount: 3, from: null, to: null },
            { at: 2, actorName: "Kyra", action: "unknown-shape" },
        ];
        const [stat] = summarizeSession(entries);
        assert.equal(stat.net, 3);
        assert.equal(stat.gained, 3);
        assert.equal(stat.start, null);
        assert.equal(stat.end, null);
    });

    it("returns an empty summary for an empty session", () => {
        assert.deepEqual(summarizeSession([]), []);
    });
});

describe("view-mode persistence", () => {
    it("cleanLogFilters keeps only valid view flags", () => {
        assert.equal(cleanLogFilters({ view: "summary" }).view, "summary");
        assert.equal(cleanLogFilters({ view: "daily" }).view, "daily");
        assert.equal(cleanLogFilters({ view: "entries" }).view, "");
        assert.equal(cleanLogFilters({ view: 7 }).view, "");
        assert.equal(cleanLogFilters({}).view, "");
    });
});

describe("groupLogByDay", () => {
    it("groups entries by local calendar day, oldest first", () => {
        const log = [
            entry(new Date(2026, 8, 21, 10, 0).getTime(), "Kyra", 0, 1),
            entry(new Date(2026, 8, 20, 22, 0).getTime(), "Kyra", 1, 2), // 22:00
            entry(new Date(2026, 8, 20, 19, 0).getTime(), "Ezren", 2, 1), // 19:00
        ];
        const days = groupLogByDay(log);
        assert.equal(days.length, 2);
        assert.equal(days[0].day, "2026-09-20");
        assert.equal(days[1].day, "2026-09-21");
        assert.equal(days[0].entries.length, 2); // 19:00 and 22:00, chronological
        assert.equal(days[0].entries[0].from, 2);
    });

    it("splits entries that straddle local midnight", () => {
        const log = [
            entry(new Date(2026, 8, 21, 0, 1).getTime(), "Kyra", 1, 0), // newest
            entry(new Date(2026, 8, 20, 23, 59).getTime(), "Kyra", 0, 1),
        ];
        const days = groupLogByDay(log);
        assert.equal(days.length, 2);
        assert.equal(days[0].day, "2026-09-20");
        assert.equal(days[1].day, "2026-09-21");
    });

    it("handles empty logs", () => {
        assert.deepEqual(groupLogByDay([]), []);
    });
});
