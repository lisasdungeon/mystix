/**
 * MystiX — tests for the Mystic Point activity log.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { setupFoundryMocks } from "./helpers.js";

const { mockActor } = setupFoundryMocks();

const { awardMysticPoints, spendMysticPoint } = await import("../scripts/core.js");
const { describeRerollDetail } = await import("../scripts/chat.js");
const {
    appendLogEntry,
    clearLog,
    describeAction,
    describeDetail,
    formatTime,
    getLog,
    recordActivity,
    registerActivityLog,
} = await import("../scripts/activity-log.js");

// Wire the socket listener exactly as main.js does during `init`.
registerActivityLog();

const SLUG = "mystix";

/** Dispatch a socket message as if it arrived from another client. */
function deliverSocket(message) {
    for (const handler of game.socket.handlers) {
        if (handler.name === `module.${SLUG}` && handler.callback) handler.callback(message);
    }
}

/** Wait for the fire-and-forget log writes to settle. */
async function settle() {
    await new Promise((resolve) => setImmediate(resolve));
}

describe("appendLogEntry (GM-side writes)", () => {
    beforeEach(() => {
        game.actors.length = 0;
        game.user.isGM = true;
        Hooks.calls.length = 0;
        return clearLog();
    });

    it("stores a shaped entry, newest first", async () => {
        await appendLogEntry({ actorId: "a1", actorName: "Kyra", action: "spend", from: 3, to: 2 });
        await appendLogEntry({ actorId: "a2", actorName: "Merisiel", action: "award", amount: 2, from: 0, to: 2 });
        const log = getLog();
        assert.equal(log.length, 2);
        assert.equal(log[0].actorName, "Merisiel");
        assert.equal(log[1].actorName, "Kyra");
        assert.equal(typeof log[0].at, "number");
        assert.equal(log[0].userName, "GM");
    });

    it("caps the log at 200 entries", async () => {
        for (let i = 0; i < 210; i += 1) {
            await appendLogEntry({ actorName: `Actor ${i}`, action: "award", amount: 1 });
        }
        const log = getLog();
        assert.equal(log.length, 200);
        assert.equal(log[0].actorName, "Actor 209");
        assert.equal(log.at(-1).actorName, "Actor 10");
    });

    it("ignores writes from non-GM clients", async () => {
        game.user.isGM = false;
        await appendLogEntry({ actorName: "Sneaky", action: "award", amount: 5 });
        assert.equal(getLog().length, 0);
        game.user.isGM = true;
    });
});

describe("recordActivity routing", () => {
    beforeEach(async () => {
        game.actors.length = 0;
        game.socket.sent.length = 0; // keep registered socket handlers
        Hooks.calls.length = 0;
        await clearLog();
    });

    it("GM activity is written locally, not socketed", async () => {
        const actor = mockActor({ name: "Seelah", flags: { mystix: { value: 1, max: 3 } } });
        recordActivity({ actor, action: "spend" });
        await settle();
        assert.equal(getLog().length, 1);
        assert.equal(getLog()[0].actorName, "Seelah");
    });

    it("player activity is relayed to the GM and appended there", async () => {
        game.user.isGM = false;
        const actor = mockActor({ name: "Player Spender", flags: { mystix: { value: 2, max: 3 } } });
        recordActivity({ actor, action: "spend" });
        // No direct write on the player's client.
        assert.equal(getLog().length, 0);
        // The GM client receives the relay and records it.
        game.user.isGM = true;
        deliverSocket({ type: "log-entry", payload: { actorName: "Player Spender", action: "spend" } });
        await settle();
        assert.equal(getLog().length, 1);
        assert.equal(getLog()[0].actorName, "Player Spender");
    });

    it("relay entries are appended by the GM, then broadcast", async () => {
        await appendLogEntry({ actorName: "Valeros", action: "award", amount: 1 });
        const changed = Hooks.calls.filter((call) => call.name === "mystixLogChanged");
        assert.equal(changed.length, 1);
    });
});

describe("instrumented pool actions", () => {
    beforeEach(async () => {
        game.actors.length = 0;
        game.user.isGM = true;
        await clearLog();
    });

    it("spendMysticPoint records a spend", async () => {
        const actor = mockActor({ name: "Kyra", flags: { mystix: { value: 2, max: 3 } } });
        game.actors.push(actor);
        const ok = await spendMysticPoint(actor);
        assert.ok(ok);
        await settle();
        const [entry] = getLog();
        assert.equal(entry.action, "spend");
        assert.equal(entry.from, 2);
        assert.equal(entry.to, 1);
    });

    it("spendMysticPoint records labeled spends (effect/reroll) with detail", async () => {
        const actor = mockActor({ name: "Labeled", flags: { mystix: { value: 2, max: 3 } } });
        game.actors.push(actor);
        await spendMysticPoint(actor, { logAction: "effect", logDetail: "Mystic Surge" });
        await spendMysticPoint(actor, { logAction: "reroll", logDetail: "Strike (DC 18)" });
        await settle();
        const log = getLog();
        assert.equal(log.length, 2);
        assert.equal(log[1].action, "effect");
        assert.equal(log[1].detail, "Mystic Surge");
        assert.equal(log[0].action, "reroll");
        assert.equal(log[0].detail, "Strike (DC 18)");
    });

    it("appendLogEntry keeps a provided detail field", async () => {
        await appendLogEntry({ actorName: "Detail", action: "effect", detail: "Mystic Mending" });
        assert.equal(getLog()[0].detail, "Mystic Mending");
    });

    it("award records an award or removal; clamped no-ops are skipped", async () => {
        const actor = mockActor({ name: "Merisiel", flags: { mystix: { value: 1, max: 3 } } });
        game.actors.push(actor);
        await awardMysticPoints(actor, 2); // 1 → 3 (clamped at max)
        await awardMysticPoints(actor, 5); // 3 → 3: no-op, not logged
        await awardMysticPoints(actor, -9); // 3 → 0 (clamped at zero)
        await settle();
        const log = getLog();
        assert.equal(log.length, 2);
        assert.equal(log[1].action, "award");
        assert.equal(log[1].from, 1);
        assert.equal(log[1].to, 3);
        assert.equal(log[0].action, "remove");
        assert.equal(log[0].to, 0);
    });

    it("no-op awards are not logged", async () => {
        const actor = mockActor({ name: "Ezren", flags: { mystix: { value: 3, max: 3 } } });
        game.actors.push(actor);
        await awardMysticPoints(actor, 1); // already full
        await settle();
        assert.equal(getLog().length, 0);
    });
});

describe("presentation helpers", () => {
    it("formats times as HH:MM", () => {
        const stamp = new Date(2026, 0, 15, 9, 5).getTime();
        assert.equal(formatTime(stamp), "09:05");
    });

    it("describes actions (mock i18n returns keys verbatim)", () => {
        assert.equal(describeAction("spend"), "MYSTIX.Log.Actions.Spend");
        assert.equal(describeAction("award", 2), "MYSTIX.Log.Actions.Award");
        assert.equal(describeAction("remove", -3), "MYSTIX.Log.Actions.Remove");
        assert.equal(describeAction("refresh"), "MYSTIX.Log.Actions.Refresh");
        assert.equal(describeAction("fixed-grant", 1), "MYSTIX.Log.Actions.FixedGrant");
        assert.equal(describeAction("effect"), "MYSTIX.Log.Actions.Effect");
        assert.equal(describeAction("reroll"), "MYSTIX.Log.Actions.Reroll");
        assert.equal(describeAction("mystery"), "mystery");
    });

    it("describeDetail trims and rejects empty detail", () => {
        assert.equal(describeDetail("  Mystic Surge  "), "Mystic Surge");
        assert.equal(describeDetail("   "), "");
        assert.equal(describeDetail(null), "");
        assert.equal(describeDetail(undefined), "");
    });
});

describe("reroll detail extraction", () => {
    it("extracts a clean check name from a PF2e flavor line", () => {
        assert.equal(
            describeRerollDetail({ flavor: "Strike [attack-strike] (DC 18)" }),
            "Strike",
        );
        assert.equal(
            describeRerollDetail({ flavor: "Medicine (DC 15)" }),
            "Medicine",
        );
        assert.equal(
            describeRerollDetail({ flavor: "Arcana [skill-check]" }),
            "Arcana",
        );
    });

    it("falls back to the whole flavor when it has no bracket/DC tail", () => {
        assert.equal(describeRerollDetail({ flavor: "Freeform flavor text" }), "Freeform flavor text");
    });

    it("falls back to a generic d20 check when no flavor exists", () => {
        assert.equal(describeRerollDetail({}), "d20 check");
        assert.equal(describeRerollDetail(null), "d20 check");
        assert.equal(describeRerollDetail({ flavor: "   " }), "d20 check");
    });
});
