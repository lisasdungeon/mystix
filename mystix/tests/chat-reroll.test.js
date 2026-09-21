/**
 * MystiX — tests for the Mythic Point reroll: the +10 mythic proficiency
 * bonus applied through `pf2e.preReroll`, and the on-card reroll buttons.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { setupFoundryMocks } from "./helpers.js";

const { mockActor } = setupFoundryMocks();

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
        const classes = new Set();
        this.classList = { add: (...names) => names.forEach((n) => classes.add(n)) };
    }
    append(child) { this.children.push(child); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
}
globalThis.document ??= {};
globalThis.document.createElement = () => {
    const el = new FakeElement();
    createdElements.push(el);
    return el;
};

const {
    applyMythicProficiency,
    beginMythicReroll,
    injectRerollButtons,
    isMythicRerollPending,
    MYTHIC_PROFICIENCY_BONUS,
} = await import("../scripts/chat.js");

/** Consume any pending flag leaked from a previous test. */
function resetPendingFlag() {
    while (isMythicRerollPending()) {
        applyMythicProficiency({}, { terms: [], _formula: "" }, false);
    }
}

beforeEach(() => {
    createdElements.length = 0;
    resetPendingFlag();
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

function stubRerollFromMessage() {
    const calls = [];
    game.pf2e = { Check: { rerollFromMessage: async (_msg, options) => calls.push(options) } };
    return calls;
}

describe("applyMythicProficiency (+10 via pf2e.preReroll)", () => {
    it("exposes the mythic proficiency bonus", () => {
        assert.equal(MYTHIC_PROFICIENCY_BONUS, 10);
    });

    it("appends +10 to a pending mythic reroll and consumes the flag", () => {
        beginMythicReroll();
        assert.ok(isMythicRerollPending());
        const roll = { terms: [], _formula: "1d20 + 7" };

        applyMythicProficiency({}, roll, false);

        assert.equal(roll.terms.length, 2);
        assert.equal(roll.terms[0].operator, "+");
        assert.equal(roll.terms[1].number, 10);
        assert.equal(roll._formula, "1d20 + 7 + 10");
        assert.equal(isMythicRerollPending(), false, "pending flag must be one-shot");
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
