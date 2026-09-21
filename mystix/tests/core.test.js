/**
 * MystiX — tests for scripts/core.js (the Mystic Point pool logic).
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { setupFoundryMocks } from "./helpers.js";

const { mockActor } = setupFoundryMocks();

const {
    awardMysticPoints,
    getMysticData,
    isMystixActor,
    loc,
    setMysticData,
    spendMysticPoint,
    toElement,
} = await import("../scripts/core.js");

describe("getMysticData", () => {
    beforeEach(() => {
        game.settings.set("mystix", "defaultMax", 3);
    });

    it("reads value and max from actor flags", () => {
        const actor = mockActor({ flags: { mystix: { value: 2, max: 4 } } });
        assert.deepEqual(getMysticData(actor), { value: 2, max: 4 });
    });

    it("falls back to the world default max when the actor has none", () => {
        const actor = mockActor({ flags: { mystix: { value: 1 } } });
        assert.deepEqual(getMysticData(actor), { value: 1, max: 3 });
    });

    it("treats a missing flag scope as an empty pool", () => {
        const actor = mockActor({ flags: {} });
        assert.deepEqual(getMysticData(actor), { value: 0, max: 3 });
    });

    it("clamps value into [0, max] and repairs garbage", () => {
        const over = mockActor({ flags: { mystix: { value: 9, max: 3 } } });
        assert.deepEqual(getMysticData(over), { value: 3, max: 3 });

        const garbage = mockActor({ flags: { mystix: { value: "lots", max: "many" } } });
        assert.deepEqual(getMysticData(garbage), { value: 0, max: 3 });
    });
});

describe("setMysticData", () => {
    beforeEach(() => {
        game.settings.set("mystix", "defaultMax", 3);
    });

    it("writes value and max, clamping value to the new max", async () => {
        const actor = mockActor();
        await setMysticData(actor, { value: 5, max: 2 });
        assert.equal(actor.flags.mystix.value, 2);
        assert.equal(actor.flags.mystix.max, 2);
    });

    it("keeps current values when called with no arguments", async () => {
        const actor = mockActor({ flags: { mystix: { value: 2, max: 3 } } });
        await setMysticData(actor, {});
        assert.deepEqual(actor.flags.mystix, { value: 2, max: 3 });
    });

    it("ignores null actors", async () => {
        await setMysticData(null, { value: 1, max: 1 }); // must not throw
    });

    it("persists a new max so the actor's stored flags grow", async () => {
        const actor = mockActor({ flags: { mystix: { value: 0, max: 0 } } });
        await setMysticData(actor, { max: 5, value: 5 });
        assert.deepEqual(actor.flags.mystix, { value: 5, max: 5 });
    });
});

describe("awardMysticPoints", () => {
    beforeEach(() => {
        game.settings.set("mystix", "defaultMax", 3);
    });

    it("adds points", async () => {
        const actor = mockActor();
        await awardMysticPoints(actor, 1);
        assert.equal(actor.flags.mystix.value, 2);
    });

    it("removes points via negative amounts", async () => {
        const actor = mockActor({ flags: { mystix: { value: 2, max: 3 } } });
        await awardMysticPoints(actor, -1);
        assert.equal(actor.flags.mystix.value, 1);
    });

    it("never exceeds max or drops below zero", async () => {
        const actor = mockActor();
        await awardMysticPoints(actor, 10);
        assert.equal(actor.flags.mystix.value, 3);
        await awardMysticPoints(actor, -10);
        assert.equal(actor.flags.mystix.value, 0);
    });

    it("does nothing when the pool max is zero", async () => {
        const actor = mockActor({ flags: { mystix: { value: 0, max: 0 } } });
        await awardMysticPoints(actor, 1);
        assert.equal(actor.flags.mystix.value, 0);
    });

    it("ignores zero and non-finite amounts", async () => {
        const actor = mockActor();
        await awardMysticPoints(actor, 0);
        await awardMysticPoints(actor, NaN);
        await awardMysticPoints(actor, Infinity);
        assert.equal(actor.updates.length, 0);
    });

    it("ignores a null actor", async () => {
        await awardMysticPoints(null, 1); // must not throw
    });
});

describe("spendMysticPoint", () => {
    beforeEach(() => {
        game.settings.set("mystix", "defaultMax", 3);
    });

    it("spends one point and reports success", async () => {
        const actor = mockActor();
        const spent = await spendMysticPoint(actor);
        assert.equal(spent, true);
        assert.equal(actor.flags.mystix.value, 0);
    });

    it("refuses when the pool is empty without writing", async () => {
        const actor = mockActor({ flags: { mystix: { value: 0, max: 3 } } });
        const spent = await spendMysticPoint(actor);
        assert.equal(spent, false);
        assert.equal(actor.updates.length, 0);
    });

    it("refuses on a null actor", async () => {
        assert.equal(await spendMysticPoint(null), false);
    });
});

describe("isMystixActor / loc / toElement", () => {
    it("accepts characters and rejects other types", () => {
        assert.equal(isMystixActor({ type: "character" }), true);
        assert.equal(isMystixActor({ type: "npc" }), false);
        assert.equal(isMystixActor(null), false);
    });

    it("localizes with format arguments", () => {
        assert.equal(loc("MYSTIX.Sheet.Tooltip", { value: 1, max: 3 }), "MYSTIX.Sheet.Tooltip");
    });

    it("unwraps Element instances from hook payloads", () => {
        const el = new Element();
        assert.equal(toElement(el), el);
        assert.equal(toElement([el]), el);
        assert.equal(toElement([null]), null);
        assert.equal(toElement(null), null);
    });
});
