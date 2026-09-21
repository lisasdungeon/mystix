/**
 * MystiX — Hero & Mystic Points for Pathfinder 2e (Foundry VTT)
 *
 * Entry point: registers settings, hooks, the macro-facing API, and the
 * floating party tracker HUD.
 */

import { openActorLog } from "./actor-log.js";
import { awardMysticPoints, getMysticData, getSkipRefresh, setMysticData, setSkipRefresh, spendMysticPoint } from "./core.js";
import { clearLog, getLog, registerActivityLog } from "./activity-log.js";
import { registerChatReroll } from "./chat.js";
import { openAwardDialog } from "./dialog.js";
import { openEffectManager } from "./effect-manager.js";
import { getEnabledEffects, openEffectChooser, triggerEffect } from "./effects.js";
import { refreshPartyHUD, registerKeybinding, togglePartyHUD } from "./hud.js";
import { openLogViewer } from "./log-viewer.js";
import { refreshAllMysticPoints, refreshFixed, registerRefreshHooks, runEncounterRefresh } from "./refresh.js";
import { closeSession, postSessionReport } from "./session-report.js";
import { renderCharacterSheet } from "./sheet.js";
import { registerSettings } from "./settings.js";

const SLUG = "mystix";

Hooks.once("init", () => {
    registerSettings();
    registerActivityLog();
    registerChatReroll();
    registerKeybinding();
    registerRefreshHooks();

    console.log("MystiX | Hero & Mystic Points initialized.");
});

// Register the HUD button in the main control bar.
Hooks.on("getSceneControlButtons", (controls) => {
    const tokenTools = controls.find((control) => control.name === "token");
    if (!tokenTools?.tools) return;
    tokenTools.tools.push({
        name: "mystix-hud",
        title: "MYSTIX.HUD.Title",
        icon: "fa-solid fa-circle-m",
        onClick: () => togglePartyHUD(),
        toggle: false,
        button: true,
    });
    if (game.user.isGM) {
        tokenTools.tools.push({
            name: "mystix-effects",
            title: "MYSTIX.Manager.Title",
            icon: "fa-solid fa-wand-magic-sparkles",
            onClick: () => openEffectManager(),
            toggle: false,
            button: true,
        });
        tokenTools.tools.push({
            name: "mystix-log",
            title: "MYSTIX.LogViewer.OpenTooltip",
            icon: "fa-solid fa-clipboard-list",
            onClick: () => openLogViewer(),
            toggle: false,
            button: true,
        });
    }
});

// Keep pips and the HUD in sync on any actor change, and the activity log
// panel in sync when the log changes (e.g. a player spends on their client).
Hooks.on("updateActor", () => refreshPartyHUD());
Hooks.on("mystixLogChanged", () => refreshPartyHUD());

// Character sheets re-render themselves on document updates; just refresh
// the HUD alongside them.
Hooks.on("renderCharacterSheetPF2e", (sheet, html) => {
    renderCharacterSheet(sheet, html);
});

// Expose a small macro API: game.mystix.*
Hooks.once("ready", () => {
    game.mystix = Object.assign(game.mystix ?? {}, {
        get: (actor) => getMysticData(actor),
        award: (actor, amount) => awardMysticPoints(actor, amount),
        set: (actor, data) => setMysticData(actor, data),
        spend: (actor) => spendMysticPoint(actor),
        getSkipRefresh: (actor) => getSkipRefresh(actor),
        setSkipRefresh: (actor, skip) => setSkipRefresh(actor, skip),
        openAwardDialog: (actor) => openAwardDialog(actor),
        toggleHUD: () => togglePartyHUD(),
        refreshAll: () => refreshAllMysticPoints(),
        refreshEncounter: (options) => runEncounterRefresh(options),
        refreshFixed: (options) => refreshFixed(options),
        log: {
            get: () => getLog(),
            clear: () => clearLog(),
            view: () => openLogViewer(),
        },
        report: (options) => postSessionReport(options),
        closeSession: (options) => closeSession(options),
        actorLog: (actor) => openActorLog(actor),
        effects: {
            list: () => getEnabledEffects(),
            trigger: (actor, key, options) => triggerEffect(actor, key, options),
            chooser: (actor) => openEffectChooser(actor),
            manager: () => openEffectManager(),
        },
        version: "0.2.11",
    });

    // Optionally open the HUD on world load (GMs only, when enabled).
    if (game.user.isGM && game.settings.get(SLUG, "autoOpenHud")) {
        togglePartyHUD();
    }
});
