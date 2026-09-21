import assert from "node:assert/strict";
import { it } from "node:test";

import { setupFoundryMocks } from "./helpers.js";

setupFoundryMocks();

const hooks = new Map();
globalThis.Hooks.once = (name, callback) => hooks.set(name, callback);
globalThis.Hooks.on = (name, callback) => hooks.set(name, callback);
await import("../scripts/main.js?scene-controls-test");

it("registers MystiX toolbar tools without assuming controls is an array", () => {
    const sceneControlHook = hooks.get("getSceneControlButtons");
    const tokenControl = { tools: [] };

    assert.equal(typeof sceneControlHook, "function");
    sceneControlHook({ token: tokenControl });
    assert.deepEqual(tokenControl.tools.map((tool) => tool.name), [
        "mystix-hud",
        "mystix-effects",
        "mystix-log",
    ]);
});
