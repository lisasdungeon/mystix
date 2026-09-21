/**
 * MystiX — tests for the per-actor auto-refresh opt-out.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { setupFoundryMocks } from "./helpers.js";

const { mockActor } = setupFoundryMocks();

const {
    awardMysticPoints,
    getMysticData,
    getSkipRefresh,
    setMysticData,
    setSkipRefresh,
    spendMysticPoint,
} = await import("../scripts/core.js");

describe("skipRefresh flag", () => {
    beforeEach(() => {
        game.settings.set("mystix", "defaultMax", 3);
    });

    it("defaults to false when the flag is absent", () => {
        const actor = mockActor();
        assert.equal(getSkipRefresh(actor), false);
    });

    it("reads true from actor flags", () => {
        const actor = mockActor({ flags: { mystix: { value: 1, max: 3, skipRefresh: true } } });
        assert.equal(getSkipRefresh(actor), true);
    });

    it("treats non-true values as false", () => {
        const actor = mockActor({ flags: { mystix: { value: 1, max: 3, skipRefresh: "yes" } } });
        assert.equal(getSkipRefresh(actor), false);
    });

    it("persists the flag via a dot-path update", async () => {
        const actor = mockActor();
        await setSkipRefresh(actor, true);
        assert.equal(getSkipRefresh(actor), true);
        assert.deepEqual(actor.updates, [{ "flags.mystix.skipRefresh": true }]);
    });

    it("can be cleared again", async () => {
        const actor = mockActor({ flags: { mystix: { value: 1, max: 3, skipRefresh: true } } });
        await setSkipRefresh(actor, false);
        assert.equal(getSkipRefresh(actor), false);
    });

    it("ignores null actors", async () => {
        await setSkipRefresh(null, true); // must not throw
        assert.equal(getSkipRefresh(null), false);
    });
});

describe("pool writes preserve sibling flags", () => {
    beforeEach(() => {
        game.settings.set("mystix", "defaultMax", 3);
    });

    it("setMysticData keeps skipRefresh", async () => {
        const actor = mockActor({ flags: { mystix: { value: 1, max: 3, skipRefresh: true } } });
        await setMysticData(actor, { value: 2 });
        assert.equal(getSkipRefresh(actor), true);
        assert.equal(getMysticData(actor).value, 2);
    });

    it("awardMysticPoints keeps skipRefresh", async () => {
        const actor = mockActor({ flags: { mystix: { value: 1, max: 3, skipRefresh: true } } });
        await awardMysticPoints(actor, 1);
        assert.equal(getSkipRefresh(actor), true);
        assert.equal(actor.flags.mystix.value, 2);
    });

    it("spendMysticPoint keeps skipRefresh", async () => {
        const actor = mockActor({ flags: { mystix: { value: 2, max: 3, skipRefresh: true } } });
        await spendMysticPoint(actor);
        assert.equal(getSkipRefresh(actor), true);
        assert.equal(actor.flags.mystix.value, 1);
    });

    it("setting the max through the dialog path keeps skipRefresh", async () => {
        // Mirrors dialog.js: award via helper, then setMysticData({ max }).
        const actor = mockActor({ flags: { mystix: { value: 1, max: 3, skipRefresh: true } } });
        await awardMysticPoints(actor, 1);
        await setMysticData(actor, { max: 5 });
        assert.equal(getSkipRefresh(actor), true);
        assert.deepEqual(getMysticData(actor), { value: 2, max: 5 });
    });
});
