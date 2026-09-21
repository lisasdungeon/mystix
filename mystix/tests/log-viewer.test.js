/**
 * MystiX — tests for the GM log viewer's pure logic (filters, option lists,
 * row rendering). Dialog rendering itself needs Foundry and is not covered.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { setupFoundryMocks } from "./helpers.js";

setupFoundryMocks();

const {
    canViewLog,
    filterLog,
    listLogActions,
    listLogActors,
    listLogUsers,
    renderLogRow,
} = await import("../scripts/log-viewer.js");

/** A compact log-entry factory with sane defaults. */
function entry(overrides = {}) {
    return {
        at: 1_750_000_000_000,
        actorId: overrides.actorId ?? "a1",
        actorName: overrides.actorName ?? "Kyra",
        action: overrides.action ?? "spend",
        amount: overrides.amount ?? null,
        from: overrides.from ?? null,
        to: overrides.to ?? null,
        userName: overrides.userName ?? "GM",
    };
}

/** Sample log, newest first (as stored). */
function sampleLog() {
    return [
        entry({ actorName: "Kyra", action: "spend", userName: "Alice" }),
        entry({ actorName: "Merisiel", action: "award", amount: 2, userName: "GM" }),
        entry({ actorName: "Kyra", action: "refresh", userName: "GM" }),
        entry({ actorName: "Ezren", action: "fixed-grant", amount: 1, userName: "Bob" }),
        entry({ actorName: "Merisiel", action: "remove", amount: -1, userName: "Alice" }),
    ];
}

describe("log viewer filters", () => {
    beforeEach(() => {
        game.user.isGM = true;
    });

    it("blank criteria return the whole log, newest first", () => {
        const log = sampleLog();
        const filtered = filterLog(log, {});
        assert.equal(filtered.length, 5);
        assert.equal(filtered[0].actorName, "Kyra");
        assert.equal(filtered[4].actorName, "Merisiel");
    });

    it("filters by a single actor", () => {
        const filtered = filterLog(sampleLog(), { actorName: "Kyra" });
        assert.equal(filtered.length, 2);
        assert.ok(filtered.every((e) => e.actorName === "Kyra"));
    });

    it("filters by action type", () => {
        const filtered = filterLog(sampleLog(), { action: "award" });
        assert.equal(filtered.length, 1);
        assert.equal(filtered[0].actorName, "Merisiel");
    });

    it("filters by user", () => {
        const filtered = filterLog(sampleLog(), { userName: "Alice" });
        assert.equal(filtered.length, 2);
        assert.ok(filtered.every((e) => e.userName === "Alice"));
    });

    it("combines filters with AND semantics", () => {
        const filtered = filterLog(sampleLog(), { actorName: "Merisiel", userName: "Alice" });
        assert.equal(filtered.length, 1);
        assert.equal(filtered[0].action, "remove");
    });

    it("no matches yields an empty list", () => {
        assert.deepEqual(filterLog(sampleLog(), { actorName: "Nobody" }), []);
    });

    it("caps results to the limit", () => {
        const filtered = filterLog(sampleLog(), { limit: 2 });
        assert.equal(filtered.length, 2);
        assert.equal(filtered[0].actorName, "Kyra"); // newest kept, oldest dropped
    });

    it("invalid limits fall back to the default cap", () => {
        assert.equal(filterLog(sampleLog(), { limit: -5 }).length, 5);
        assert.equal(filterLog(sampleLog(), { limit: Number.NaN }).length, 5);
    });
});

describe("log viewer option lists", () => {
    it("lists each distinct actor once, alphabetized", () => {
        assert.deepEqual(listLogActors(sampleLog()), ["Ezren", "Kyra", "Merisiel"]);
    });

    it("lists each distinct action once, alphabetized", () => {
        assert.deepEqual(listLogActions(sampleLog()), ["award", "fixed-grant", "refresh", "remove", "spend"]);
    });

    it("lists each distinct user once, alphabetized", () => {
        assert.deepEqual(listLogUsers(sampleLog()), ["Alice", "Bob", "GM"]);
    });

    it("handles an empty log", () => {
        assert.deepEqual(listLogActors([]), []);
        assert.deepEqual(listLogActions([]), []);
        assert.deepEqual(listLogUsers([]), []);
    });
});

describe("log viewer rows and gating", () => {
    beforeEach(() => {
        game.user.isGM = true;
    });

    it("renders a row with escaped actor, action, and user fragments", () => {
        const row = renderLogRow(entry({ actorName: "Kyra <3", action: "award", amount: 2, userName: "Alice" }));
        assert.ok(row.includes("Kyra &lt;3"));
        assert.ok(row.includes("MYSTIX.Log.Actions.Award"));
        assert.ok(row.includes("MYSTIX.Log.ByUser"));
    });

    it("only GMs may open the viewer", () => {
        game.user.isGM = true;
        assert.equal(canViewLog(), true);
        game.user.isGM = false;
        assert.equal(canViewLog(), false);
        game.user.isGM = true;
    });
});
