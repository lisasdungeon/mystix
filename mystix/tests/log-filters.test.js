/**
 * MystiX — tests for the log viewer's per-user saved filters
 * (storage helpers, cleaning, and save/fallback behavior).
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { setupFoundryMocks } from "./helpers.js";

setupFoundryMocks();

const { cleanLogFilters, getSavedLogFilters, saveLogFilters } = await import("../scripts/log-viewer.js");

describe("log viewer filter persistence", () => {
    beforeEach(() => {
        game.user.flags = {};
        game.user.isGM = true;
    });

    it("cleanLogFilters keeps string values and drops everything else", () => {
        const cleaned = cleanLogFilters({
            actorName: "Kyra",
            action: 42,
            userName: null,
            extra: "ignored",
        });
        assert.deepEqual(cleaned, { actorName: "Kyra", action: "", userName: "", view: "" });
    });

    it("cleanLogFilters tolerates non-object input", () => {
        const all = { actorName: "", action: "", userName: "", view: "" };
        assert.deepEqual(cleanLogFilters(null), all);
        assert.deepEqual(cleanLogFilters(undefined), all);
        assert.deepEqual(cleanLogFilters("garbage"), all);
        assert.deepEqual(cleanLogFilters([]), all);
    });

    it("no saved filters fall back to show-all", () => {
        assert.deepEqual(getSavedLogFilters(), { actorName: "", action: "", userName: "", view: "" });
    });

    it("saving then reading restores the same filters", async () => {
        await saveLogFilters({ actorName: "Merisiel", action: "effect", userName: "Alice", view: "summary" });
        assert.deepEqual(getSavedLogFilters(), {
            actorName: "Merisiel",
            action: "effect",
            userName: "Alice",
            view: "summary",
        });
    });

    it("saved filters live in the mystix scope of user flags", async () => {
        await saveLogFilters({ actorName: "Ezren", action: "", userName: "" });
        assert.equal(game.user.flags.mystix.logViewerFilters.actorName, "Ezren");
    });

    it("saving is per-user, not global state", async () => {
        await saveLogFilters({ actorName: "Kyra", action: "", userName: "" });
        // A different user would have their own flags document in Foundry;
        // here we just confirm writes go to game.user, not a shared store.
        assert.equal(game.user.flags.mystix.logViewerFilters.actorName, "Kyra");
    });

    it("saveLogFilters swallows storage failures", async () => {
        game.user.setFlag = async () => {
            throw new Error("disk full");
        };
        await assert.doesNotReject(() => saveLogFilters({ actorName: "X", action: "", userName: "", view: "" }));
        // Restore the working mock for other tests.
        game.user.setFlag = async function (scope, key, value) {
            this.flags ??= {};
            this.flags[scope] ??= {};
            this.flags[scope][key] = structuredClone(value);
        };
    });
});
