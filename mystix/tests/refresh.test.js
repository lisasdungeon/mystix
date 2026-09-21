/**
 * MystiX — tests for the automatic refresh engine (refill and fixed grant).
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { setupFoundryMocks } from "./helpers.js";

const { mockActor } = setupFoundryMocks();

const {
    getMysticData,
    getSkipRefresh,
    setSkipRefresh,
} = await import("../scripts/core.js");
const {
    applyFixedGrant,
    refreshAllMysticPoints,
    refreshFixed,
    runEncounterRefresh,
} = await import("../scripts/refresh.js");

// The engine posts chat cards through this global; capture calls instead.
globalThis.ChatMessage ??= { create: async () => {} };

const SLUG = "mystix";

/** Register a mock actor with the mocked actor directory. */
function spawnActor(overrides = {}) {
    const actor = mockActor(overrides);
    game.actors.push(actor);
    return actor;
}

function chatCalls() {
    return ChatMessage.create.mock?.calls ?? [];
}

describe("applyFixedGrant", () => {
    beforeEach(() => {
        game.settings.set(SLUG, "defaultMax", 3);
    });

    it("adds the fixed amount to the current value", async () => {
        const actor = mockActor({ flags: { mystix: { value: 1, max: 3 } } });
        const { changed, from, to } = await applyFixedGrant(actor, 1);
        assert.equal(changed, true);
        assert.equal(from, 1);
        assert.equal(to, 2);
        assert.deepEqual(getMysticData(actor), { value: 2, max: 3 });
    });

    it("accumulates across encounters until the max", async () => {
        const actor = mockActor({ flags: { mystix: { value: 0, max: 3 } } });
        await applyFixedGrant(actor, 1);
        await applyFixedGrant(actor, 1);
        await applyFixedGrant(actor, 1);
        assert.deepEqual(getMysticData(actor), { value: 3, max: 3 });
        // Full pool: a further grant is a no-op.
        const result = await applyFixedGrant(actor, 1);
        assert.equal(result.changed, false);
        assert.deepEqual(getMysticData(actor), { value: 3, max: 3 });
    });

    it("clamps oversized grants to the max", async () => {
        const actor = mockActor({ flags: { mystix: { value: 2, max: 3 } } });
        await applyFixedGrant(actor, 5);
        assert.deepEqual(getMysticData(actor), { value: 3, max: 3 });
    });

    it("treats negative or non-finite amounts as zero", async () => {
        const actor = mockActor({ flags: { mystix: { value: 1, max: 3 } } });
        for (const bad of [-2, NaN, Infinity, "three"]) {
            const result = await applyFixedGrant(actor, bad);
            assert.equal(result.changed, false, `grant ${bad} should not change the pool`);
        }
        assert.deepEqual(getMysticData(actor), { value: 1, max: 3 });
    });
});

describe("refreshFixed (party-wide fixed grant)", () => {
    beforeEach(() => {
        game.settings.set(SLUG, "defaultMax", 3);
        game.actors.length = 0;
    });

    it("grants to every refreshable character and skips full pools", async () => {
        const partial = spawnActor({ name: "Partial", flags: { mystix: { value: 1, max: 3 } } });
        const full = spawnActor({ name: "Full", id: "actor-2", flags: { mystix: { value: 3, max: 3 } } });
        const changes = await refreshFixed({ grant: 1, announce: false });
        assert.equal(changes.length, 1);
        assert.equal(changes[0].actor, partial);
        assert.equal(changes[0].from, 1);
        assert.equal(changes[0].to, 2);
        assert.deepEqual(getMysticData(full), { value: 3, max: 3 });
    });

    it("respects the per-actor skipRefresh opt-out", async () => {
        const optedOut = spawnActor({ name: "Skipper", flags: { mystix: { value: 0, max: 3, skipRefresh: true } } });
        const normal = spawnActor({ name: "Normal", id: "actor-2", flags: { mystix: { value: 0, max: 3 } } });
        const changes = await refreshFixed({ grant: 1, announce: false });
        assert.equal(getMysticData(optedOut).value, 0);
        assert.equal(getMysticData(normal).value, 1);
        assert.ok(changes.every((change) => change.actor !== optedOut));
    });

    it("honors the world encounterGrant setting by default", async () => {
        game.settings.set(SLUG, "encounterGrant", 2);
        const actor = spawnActor({ flags: { mystix: { value: 0, max: 3 } } });
        await refreshFixed({ announce: false });
        assert.deepEqual(getMysticData(actor), { value: 2, max: 3 });
    });
});

describe("refreshAllMysticPoints (refill)", () => {
    beforeEach(() => {
        game.settings.set(SLUG, "defaultMax", 3);
        game.actors.length = 0;
    });

    it("tops every pool up to full", async () => {
        const actor = spawnActor({ flags: { mystix: { value: 1, max: 3 } } });
        const changes = await refreshAllMysticPoints({ announce: false });
        assert.equal(changes.length, 1);
        assert.equal(changes[0].to, 3);
        assert.deepEqual(getMysticData(actor), { value: 3, max: 3 });
    });

    it("keeps respecting the skipRefresh opt-out", async () => {
        const optedOut = spawnActor({ flags: { mystix: { value: 0, max: 3, skipRefresh: true } } });
        await refreshAllMysticPoints({ announce: false });
        assert.deepEqual(getMysticData(optedOut), { value: 0, max: 3 });
    });
});

describe("runEncounterRefresh (style dispatch)", () => {
    beforeEach(() => {
        game.settings.set(SLUG, "defaultMax", 3);
        game.actors.length = 0;
    });

    it("uses refill mode when the world style is 'refill'", async () => {
        game.settings.set(SLUG, "encounterRefreshStyle", "refill");
        const actor = spawnActor({ flags: { mystix: { value: 1, max: 3 } } });
        await runEncounterRefresh({ announce: false });
        assert.deepEqual(getMysticData(actor), { value: 3, max: 3 });
    });

    it("uses fixed mode when the world style is 'fixed'", async () => {
        game.settings.set(SLUG, "encounterRefreshStyle", "fixed");
        game.settings.set(SLUG, "encounterGrant", 1);
        const actor = spawnActor({ flags: { mystix: { value: 1, max: 3 } } });
        await runEncounterRefresh({ announce: false });
        // Refill would give 3; fixed grant gives 2.
        assert.deepEqual(getMysticData(actor), { value: 2, max: 3 });
    });

    it("allows overriding style and amount via options", async () => {
        game.settings.set(SLUG, "encounterRefreshStyle", "refill");
        const actor = spawnActor({ flags: { mystix: { value: 1, max: 3 } } });
        await runEncounterRefresh({ announce: false, style: "fixed", amount: 2 });
        assert.deepEqual(getMysticData(actor), { value: 3, max: 3 });
    });
});
