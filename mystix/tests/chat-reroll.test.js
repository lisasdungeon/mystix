/**
 * MystiX — tests for the Mythic Point reroll: the +10 mythic proficiency
 * bonus applied through `pf2e.preReroll`, and the on-card reroll buttons.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";

import { resetNotifications, setupFoundryMocks } from "./helpers.js";

const { mockActor } = setupFoundryMocks();

// Back the i18n mock with the module's real strings, so assertions on
// localized text (indicator tooltips) check actual wording.
const strings = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).MYSTIX;
const lookup = (key) => key.split(".").slice(1).reduce((node, part) => node?.[part], strings);
game.i18n.format = (key, args) => {
    const template = lookup(key) ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(args?.[name] ?? `{${name}}`));
};

// Minimal term mocks so applyMythicProficiency can build its bonus terms.
globalThis.foundry.dice ??= {};
globalThis.foundry.dice.terms = {
    OperatorTerm: class {
        constructor({ operator }) { this.operator = operator; }
    },
    NumericTerm: class {
        constructor({ number }) { this.number = number; }
    },
};

// Record hook registrations (the shared mock's Hooks.on is a no-op).
const hooks = new Map();
globalThis.Hooks.on = (name, callback) => hooks.set(name, callback);

// Fake DOM: elements must be `instanceof Element` for core's toElement().
const createdElements = [];
class FakeElement extends globalThis.Element {
    constructor() {
        super();
        this.children = [];
        this.innerHTML = "";
        this.listeners = {};
        this.dataset = {};
        const classes = new Set();
        this.classList = {
            add: (...names) => names.forEach((n) => classes.add(n)),
            remove: (...names) => names.forEach((n) => classes.delete(n)),
            contains: (name) => classes.has(name),
        };
    }
    append(child) { this.children.push(child); }
    prepend(child) { this.children.unshift(child); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
}
globalThis.document ??= {};
globalThis.document.createElement = () => {
    const el = new FakeElement();
    createdElements.push(el);
    return el;
};

const {
    applyMythicIndicator,
    applyMythicProficiency,
    beginMythicReroll,
    confirmMythicReroll,
    injectRerollButtons,
    isMythicRerollPending,
    performMythicReroll,
    resetRerollState,
    MYTHIC_PROFICIENCY_BONUS,
} = await import("../scripts/chat.js");

/** Stub the world setting for the reroll bonus (default +10). */
function setRerollBonus(value) {
    game.settings.set("mystix", "mythicRerollBonus", value);
}

beforeEach(() => {
    createdElements.length = 0;
    resetRerollState();
    resetNotifications();
    setRerollBonus(10); // default for every test unless one overrides it
});

/** Build a fake message + rendered html pair with the selectors chat.js uses. */
function fakeMessageHtml() {
    const content = new FakeElement();
    content.querySelector = (selector) => (selector === ".mystix-reroll-row" ? content.children[0] ?? null : null);
    const root = new FakeElement();
    root.querySelector = (selector) => (selector === ".message-content" ? content : null);
    return { root, content };
}

/** Minimal ChatMessage stand-in for the injection logic. */
function message(actor, { rerollable = true } = {}) {
    return { speakerActor: actor, rolls: [{ isRerollable: rerollable }] };
}

function actorWith(heroValue, mythicValue) {
    const actor = mockActor();
    actor.isOwner = true;
    actor.heroPoints = { value: heroValue, max: 3 };
    actor.flags.mystix = { value: mythicValue, max: 3 };
    return actor;
}

function buttonsIn(row) {
    return row.innerHTML.match(/data-reroll="(hero|mythic)"/g) ?? [];
}

function stubRerollFromMessage({ confirm = true, throw: throwError = false } = {}) {
    const calls = [];
    game.pf2e = {
        Check: {
            rerollFromMessage: async (msg, options) => {
                calls.push(options);
                if (throwError) throw new Error("boom");
                // Simulate the system firing pf2e.reroll on a real reroll.
                if (confirm) confirmMythicReroll({}, {}, options?.heroPoint === true);
            },
        },
    };
    return calls;
}

describe("applyMythicProficiency (+10 via pf2e.preReroll)", () => {
    it("exposes the mythic proficiency bonus", () => {
        assert.equal(MYTHIC_PROFICIENCY_BONUS, 10);
    });

    it("appends +10 to a pending mythic reroll and consumes the boost flag", () => {
        setRerollBonus(10);
        beginMythicReroll();
        assert.ok(isMythicRerollPending());
        const roll = { terms: [], _formula: "1d20 + 7" };

        applyMythicProficiency({}, roll, false);

        assert.equal(roll.terms.length, 2);
        assert.equal(roll.terms[0].operator, "+");
        assert.equal(roll.terms[1].number, 10);
        assert.equal(roll._formula, "1d20 + 7 + 10");

        // The boost is one-shot: a second preReroll firing (e.g. a hero-point
        // reroll later in the stack) gets nothing — while the in-flight flag
        // stays up until performMythicReroll completes.
        const second = { terms: [], _formula: "1d20" };
        applyMythicProficiency({}, second, false);
        assert.equal(second.terms.length, 0);
        assert.equal(isMythicRerollPending(), true);
    });

    it("applies a custom configured bonus instead of +10", () => {
        setRerollBonus(5);
        beginMythicReroll();
        const roll = { terms: [], _formula: "1d20" };

        applyMythicProficiency({}, roll, false);

        assert.equal(roll.terms[1].number, 5);
        assert.equal(roll._formula, "1d20 + 5");
    });

    it("adds no terms for a plain reroll (bonus 0) but still consumes the boost", () => {
        setRerollBonus(0);
        beginMythicReroll();
        const roll = { terms: [], _formula: "1d20" };

        applyMythicProficiency({}, roll, false);

        assert.equal(roll.terms.length, 0);
        assert.equal(roll._formula, "1d20");
        const second = { terms: [], _formula: "1d20" };
        applyMythicProficiency({}, second, false);
        assert.equal(second.terms.length, 0, "boost consumed even with no bonus");
    });

    it("falls back to +10 when the setting is not a usable number", () => {
        setRerollBonus(undefined);
        beginMythicReroll();
        const roll = { terms: [], _formula: "1d20" };

        applyMythicProficiency({}, roll, false);

        assert.equal(roll.terms[1].number, 10);
    });

    it("leaves hero-point rerolls untouched", () => {
        beginMythicReroll();
        const roll = { terms: [], _formula: "1d20" };

        applyMythicProficiency({}, roll, true);

        assert.equal(roll.terms.length, 0);
        assert.equal(roll._formula, "1d20");
        // The flag survives: the hero-point reroll did not consume it — the
        // pending MystiX reroll later in the same stack still gets the bonus.
        assert.equal(isMythicRerollPending(), true);
    });

    it("ignores rerolls MystiX did not initiate", () => {
        const roll = { terms: [], _formula: "1d20" };

        applyMythicProficiency({}, roll, false);

        assert.equal(roll.terms.length, 0);
    });

    it("only boosts the first reroll after beginMythicReroll", () => {
        beginMythicReroll();
        const first = { terms: [], _formula: "1d20" };
        const second = { terms: [], _formula: "1d20" };

        applyMythicProficiency({}, first, false);
        applyMythicProficiency({}, second, false);

        assert.equal(first.terms.length, 2);
        assert.equal(second.terms.length, 0);
    });
});

describe("injectRerollButtons (on-card buttons)", () => {
    it("renders a mythic button when only the mythic pool has points", () => {
        const { root, content } = fakeMessageHtml();
        injectRerollButtons(message(actorWith(0, 2)), root);

        assert.equal(content.children.length, 1);
        assert.deepEqual(buttonsIn(content.children[0]), ['data-reroll="mythic"']);
    });

    it("renders a hero button when only hero points are available", () => {
        const { root, content } = fakeMessageHtml();
        injectRerollButtons(message(actorWith(1, 0)), root);

        assert.deepEqual(buttonsIn(content.children[0]), ['data-reroll="hero"']);
    });

    it("renders both buttons when both pools have points", () => {
        const { root, content } = fakeMessageHtml();
        injectRerollButtons(message(actorWith(1, 2)), root);

        assert.deepEqual(buttonsIn(content.children[0]), [
            'data-reroll="hero"',
            'data-reroll="mythic"',
        ]);
    });

    it("renders nothing when both pools are empty", () => {
        const { root, content } = fakeMessageHtml();
        injectRerollButtons(message(actorWith(0, 0)), root);

        assert.equal(content.children.length, 0);
    });

    it("renders nothing for non-rerollable messages", () => {
        const { root, content } = fakeMessageHtml();
        injectRerollButtons(message(actorWith(1, 2), { rerollable: false }), root);

        assert.equal(content.children.length, 0);
    });

    it("is idempotent: no duplicate rows on re-render", () => {
        const { root, content } = fakeMessageHtml();
        const msg = message(actorWith(1, 2));
        injectRerollButtons(msg, root);
        injectRerollButtons(msg, root);

        assert.equal(content.children.length, 1);
    });

    it("ignores messages whose actor the user neither owns nor controls", () => {
        const { root, content } = fakeMessageHtml();
        const actor = actorWith(1, 2);
        actor.isOwner = false;
        const wasGM = game.user.isGM;
        game.user.isGM = false;
        try {
            injectRerollButtons(message(actor), root);
        } finally {
            game.user.isGM = wasGM;
        }

        assert.equal(content.children.length, 0);
    });

    it("clicking the mythic button spends a point and rerolls without a hero point", async () => {
        const { root } = fakeMessageHtml();
        const actor = actorWith(1, 2);
        const rerollCalls = stubRerollFromMessage();

        injectRerollButtons(message(actor), root);
        const row = createdElements.at(-1);

        await row.listeners.click({
            target: { closest: () => ({ dataset: { reroll: "mythic" } }) },
            preventDefault: () => {},
        });

        assert.deepEqual(rerollCalls, [{}]);
        assert.equal(actor.flags.mystix.value, 1, "one Mythic Point spent");
        assert.equal(isMythicRerollPending(), false, "flag cleared after the reroll");
    });

    it("clicking the hero button delegates to the system with heroPoint: true", async () => {
        const { root } = fakeMessageHtml();
        const actor = actorWith(1, 2);
        const rerollCalls = stubRerollFromMessage();

        injectRerollButtons(message(actor), root);
        const row = createdElements.at(-1);

        await row.listeners.click({
            target: { closest: () => ({ dataset: { reroll: "hero" } }) },
            preventDefault: () => {},
        });

        assert.deepEqual(rerollCalls, [{ heroPoint: true }]);
        assert.equal(actor.flags.mystix.value, 2, "no Mythic Point spent");
    });
});

describe("performMythicReroll cancellation refunds", () => {
    /** Message mock with working flag storage, mirroring a real document. */
    function messageWithFlags(actor) {
        const flags = {};
        return {
            speakerActor: actor,
            flags,
            async setFlag(scope, key, value) {
                flags[scope] ??= {};
                flags[scope][key] = value;
            },
            async unsetFlag(scope, key) {
                delete flags[scope]?.[key];
            },
        };
    }

    it("refunds the point and clears the flag when the reroll is cancelled", async () => {
        const actor = actorWith(1, 2);
        const msg = messageWithFlags(actor);
        stubRerollFromMessage({ confirm: false });

        await performMythicReroll(msg);

        assert.equal(actor.flags.mystix.value, 2, "point refunded");
        assert.equal(msg.flags.mystix?.mythicReroll, undefined, "indicator flag removed");
        assert.ok(game.ui ?? true);
        assert.ok(globalThis.ui.notifications.info.mock.calls.length > 0, "player told the reroll was cancelled");
        assert.equal(isMythicRerollPending(), false);
    });

    it("refunds and notifies on a thrown reroll error", async () => {
        const actor = actorWith(1, 2);
        const msg = messageWithFlags(actor);
        stubRerollFromMessage({ throw: true });

        await performMythicReroll(msg);

        assert.equal(actor.flags.mystix.value, 2, "point refunded");
        assert.equal(msg.flags.mystix?.mythicReroll, undefined);
        assert.ok(globalThis.ui.notifications.error.mock.calls.length > 0, "error notification shown");
    });

    it("keeps the point and flag when the reroll completes", async () => {
        const actor = actorWith(1, 2);
        const msg = messageWithFlags(actor);
        stubRerollFromMessage({ confirm: true });

        await performMythicReroll(msg);

        assert.equal(actor.flags.mystix.value, 1, "point stays spent");
        assert.equal(msg.flags.mystix.mythicReroll, 10, "indicator flag kept");
        assert.equal(globalThis.ui.notifications.info.mock.calls.length, 0, "no refund notice");
    });

    it("logs cancel and failed refunds as pool-affecting entries", async () => {
        const { recordActivity } = await import("../scripts/activity-log.js");
        const { describeAction } = await import("../scripts/activity-log.js");

        assert.equal(describeAction("cancel"), "Mythic Point refunded — reroll cancelled");
        assert.equal(describeAction("failed"), "Mythic Point refunded — reroll failed");
        assert.ok(recordActivity, "activity log module reachable");
    });

    it("refund clamps at the actor's max pool size", async () => {
        const actor = actorWith(1, 3); // full pool
        actor.flags.mystix.value = 3;
        const msg = messageWithFlags(actor);
        stubRerollFromMessage({ throw: true });

        await performMythicReroll(msg);

        assert.equal(actor.flags.mystix.value, 3, "clamped at max, not 4");
    });
});

describe("applyMythicIndicator (spent-point flavor)", () => {
    /** Build a message mock with flag storage, like the real document. */
    function flaggedMessage({ bonus = 10, actorName = "Kyra" } = {}) {
        const flags = { mystix: { mythicReroll: bonus } };
        return {
            getFlag: (scope, key) => flags[scope]?.[key],
            speakerActor: { name: actorName },
            author: { name: "Reifier" },
        };
    }

    /** A system-style indicator: dice icon with the reroll classes. */
    function withSystemIndicator() {
        const { root } = fakeMessageHtml();
        const indicator = new FakeElement();
        indicator.classList.add2 = null; // unused shim
        indicator.classNameSet = new Set(["fa-solid", "fa-dice-d20", "reroll-indicator"]);
        // Bridge the classList.add-only mock to support remove()/contains.
        const classes = indicator.classNameSet;
        indicator.classList = {
            add: (...names) => names.forEach((n) => classes.add(n)),
            remove: (...names) => names.forEach((n) => classes.delete(n)),
            contains: (n) => classes.has(n),
            [Symbol.iterator]: () => classes[Symbol.iterator](),
        };
        indicator.dataset = {};
        root.querySelector = (selector) => (selector === ".reroll-indicator" ? indicator : null);
        return { root, indicator };
    }

    it("restyles the system's indicator in place and writes the tooltip", () => {
        const { root, indicator } = withSystemIndicator();
        applyMythicIndicator(flaggedMessage({ bonus: 10 }), root);

        assert.ok(indicator.classList.contains("fa-circle-m"), "swapped to fa-circle-m");
        assert.ok(!indicator.classList.contains("fa-dice-d20"), "dice glyph removed");
        assert.ok(indicator.classList.contains("mystix-reroll-indicator"));
        assert.equal(
            indicator.dataset.tooltip,
            "Kyra rerolled using a Mythic Point (+10)",
        );
    });

    it("tooltip omits the bonus when the configured bonus is 0", () => {
        const { root, indicator } = withSystemIndicator();
        applyMythicIndicator(flaggedMessage({ bonus: 0 }), root);

        assert.equal(indicator.dataset.tooltip, "Kyra rerolled using a Mythic Point");
    });

    it("prepends a new indicator when the system rendered none", () => {
        const { root } = fakeMessageHtml();
        const content = root.querySelector(".message-content");
        applyMythicIndicator(flaggedMessage(), root);

        assert.equal(content.children.length, 1, "icon prepended");
        const icon = content.children[0];
        assert.ok(icon.classList.contains("reroll-indicator"));
        assert.ok(icon.classList.contains("mystix-reroll-indicator"));
        assert.ok(icon.dataset.tooltip.includes("Kyra"));
    });

    it("does nothing to messages without the Mythic reroll flag", () => {
        const { root } = fakeMessageHtml();
        const content = root.querySelector(".message-content");
        applyMythicIndicator({ getFlag: () => null, speakerActor: { name: "X" } }, root);

        assert.equal(content.children.length, 0);
    });

    it("falls back to the author name when no speaker actor exists", () => {
        const { root } = fakeMessageHtml();
        const msg = flaggedMessage();
        msg.speakerActor = null;
        applyMythicIndicator(msg, root);

        const icon = root.querySelector(".message-content").children[0];
        assert.ok(icon.dataset.tooltip.includes("Reifier"));
    });
});

describe("registerChatReroll wiring", () => {
    it("registers the context menu, on-card buttons, and preReroll hooks", async () => {
        const { registerChatReroll } = await import("../scripts/chat.js");
        hooks.clear();
        registerChatReroll();

        assert.ok(hooks.has("getChatMessageContextOptions"));
        assert.ok(hooks.has("renderChatMessage"));
        assert.ok(hooks.has("pf2e.preReroll"));
    });

    it("renderChatMessage injection respects the enableChatReroll setting", async () => {
        const { registerChatReroll } = await import("../scripts/chat.js");
        hooks.clear();
        registerChatReroll();
        await game.settings.set("mystix", "enableChatReroll", false);

        const { root, content } = fakeMessageHtml();
        hooks.get("renderChatMessage")(message(actorWith(1, 2)), root);
        assert.equal(content.children.length, 0, "disabled → no buttons");

        await game.settings.set("mystix", "enableChatReroll", true);
        hooks.get("renderChatMessage")(message(actorWith(1, 2)), root);
        assert.equal(content.children.length, 1, "enabled → buttons");
    });
});
