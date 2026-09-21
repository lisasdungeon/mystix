import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addMystixSceneControls } from "../scripts/scene-controls.js";

function createActions(isGM = false) {
    const calls = [];
    return {
        calls,
        options: {
            isGM,
            togglePartyHUD: () => calls.push("hud"),
            openEffectManager: () => calls.push("effects"),
            openLogViewer: () => calls.push("log"),
        },
    };
}

describe("addMystixSceneControls", () => {
    it("adds the player HUD tool to a v14 object keyed by token", () => {
        const token = { tools: [] };
        const { calls, options } = createActions();

        assert.equal(addMystixSceneControls({ token }, options), true);
        assert.deepEqual(token.tools.map((tool) => tool.name), ["mystix-hud"]);
        token.tools[0].onClick();
        assert.deepEqual(calls, ["hud"]);
    });

    it("supports v14 objects keyed by tokens", () => {
        const tokens = { tools: [] };
        const { options } = createActions();

        assert.equal(addMystixSceneControls({ tokens }, options), true);
        assert.equal(tokens.tools[0].name, "mystix-hud");
    });

    it("adds all GM tools to the legacy array layout", () => {
        const token = { name: "token", tools: [] };
        const { calls, options } = createActions(true);

        assert.equal(addMystixSceneControls([{ name: "controls" }, token], options), true);
        assert.deepEqual(token.tools.map((tool) => tool.name), ["mystix-hud", "mystix-effects", "mystix-log"]);
        token.tools.forEach((tool) => tool.onClick());
        assert.deepEqual(calls, ["hud", "effects", "log"]);
    });

    it("finds named controls among object values", () => {
        const token = { name: "tokens", tools: [] };
        const { options } = createActions();

        assert.equal(addMystixSceneControls({ canvas: token }, options), true);
        assert.equal(token.tools[0].name, "mystix-hud");
    });

    it("returns false when no token control or tools array exists", () => {
        const { options } = createActions();

        assert.equal(addMystixSceneControls(null, options), false);
        assert.equal(addMystixSceneControls("invalid", options), false);
        assert.equal(addMystixSceneControls([null, { name: "controls", tools: [] }], options), false);
        assert.equal(addMystixSceneControls({ canvas: { name: "controls", tools: [] } }, options), false);
        assert.equal(addMystixSceneControls({ token: { name: "token" } }, options), false);
    });
});
