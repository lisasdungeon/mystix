/**
 * MystiX — floating party tracker HUD.
 *
 * An ApplicationV2 panel listing every character with Hero and Mystic Point
 * pip rows. GM quick-award buttons (+/−) for Mystic Points; Hero Point pips
 * adjust the native pool for actors the user may edit.
 */

import { describeAction, describeUser, formatTime, getLog, clearLog, filterLogData, describeDetail } from "./activity-log.js";
import { awardMysticPoints, getMysticData, getSkipRefresh, loc, toElement } from "./core.js";
import { openEffectChooser } from "./effects.js";
import { openEffectManager } from "./effect-manager.js";
import { openLogViewer } from "./log-viewer.js";
import { openActorLog } from "./actor-log.js";
import { postSessionReport } from "./session-report.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const APP_ID = "mystix-party-hud";

/** FontAwesome classes for filled/empty pips per pool. */
const PIPS = {
    hero: { filled: "fa-solid fa-circle-h", empty: "fa-regular fa-circle" },
    mystic: { filled: "fa-solid fa-circle-m", empty: "fa-regular fa-circle" },
};

function buildPips(value, max, pool) {
    const classes = PIPS[pool];
    return Array.from({ length: max }, (_, index) => ({
        index,
        cls: index < value ? classes.filled : classes.empty,
    }));
}

class MystiXPartyHUD extends HandlebarsApplicationMixin(ApplicationV2) {
    /** Whether the activity log panel is expanded (per client). */
    #logExpanded = false;

    static DEFAULT_OPTIONS = {
        id: APP_ID,
        tag: "div",
        window: {
            frame: true,
            positioned: true,
            minimizable: true,
            resizable: false,
            title: "MYSTIX.HUD.Title",
        },
        position: {
            width: 340,
            top: 120,
            left: 40,
        },
        actions: {
            "mystic-plus": MystiXPartyHUD.#onMysticAward,
            "mystix-effect-manager": MystiXPartyHUD.#onOpenEffectManager,
            "mystic-minus": MystiXPartyHUD.#onMysticRemove,
            "openSheet": MystiXPartyHUD.#onOpenSheet,
            "toggle-log": MystiXPartyHUD.#onToggleLog,
            "clear-log": MystiXPartyHUD.#onClearLog,
            "open-log-viewer": MystiXPartyHUD.#onOpenLogViewer,
            "session-report": MystiXPartyHUD.#onSessionReport,
            "actor-history": MystiXPartyHUD.#onActorHistory,
        },
    };

    static PARTS = {
        main: { template: "modules/mystix/templates/party-hud.hbs" },
    };

    /** @override */
    async _prepareContext(_options) {
        const context = await super._prepareContext(_options);
        const isGMView = game.user.isGM;
        const activePartyId = this.#getActivePartyId();

        const characters = game.actors.filter(
            (actor) => actor.type === "character" && this.#inActiveParty(actor, activePartyId),
        );

        const heroName = loc("MYSTIX.HeroName");
        const rows = characters.map((actor) => {
            const mystic = getMysticData(actor);
            const hero = actor.heroPoints ?? actor.system?.resources?.heroPoints ?? { value: 0, max: 0 };
            const heroEditable = isGMView || actor.isOwner;

            return {
                actorId: actor.id,
                actorName: actor.name,
                tooltip: actor.name,
                skipRefresh: getSkipRefresh(actor),
                skipTooltip: loc("MYSTIX.Dialog.SkipRefreshBadge"),
                isGMView,
                canEditHero: heroEditable,
                heroPips: buildPips(hero.value, hero.max, "hero"),
                heroMax: hero.max,
                heroTooltip: loc("PF2E.Actor.ResourceRatio", {
                    value: hero.value,
                    max: hero.max,
                    resource: heroName,
                }),
                mysticPips: buildPips(mystic.value, mystic.max, "mystic"),
                mysticMax: mystic.max,
                mysticTooltip: loc("MYSTIX.Sheet.Tooltip", { value: mystic.value, max: mystic.max }),
            };
        });

        context.hudTitle = loc("MYSTIX.HUD.Title");
        context.heroLabel = heroName;
        context.mysticLabel = loc("MYSTIX.Name");
        context.rows = rows;
        context.isGMView = isGMView;
        context.emptyMessage = loc("MYSTIX.HUD.Empty");

        // Activity log panel (collapsed by default; state survives re-renders).
        context.logExpanded = this.#logExpanded;
        context.logLabel = loc("MYSTIX.HUD.LogLabel");
        context.emptyLog = loc("MYSTIX.Log.Empty");
        context.clearLabel = loc("MYSTIX.Log.Clear");
        context.clearTooltip = loc("MYSTIX.Log.ClearTooltip");
        context.logViewerTooltip = loc("MYSTIX.LogViewer.OpenTooltip");
        context.reportTooltip = loc("MYSTIX.Report.Title");
        context.historyTooltip = loc("MYSTIX.ActorLog.ButtonTooltip");
        context.logEntries = this.#logExpanded
            ? filterLogData(getLog(), 8).map((entry) => ({
                time: formatTime(entry.at),
                actorName: entry.actorName,
                action: describeAction(entry.action, entry.amount),
                by: describeUser(entry.userName),
                detail: describeDetail(entry.detail),
              }))
            : [];
        context.logCount = getLog().length;
        return context;
    }

    /**
     * The PF2e system's active party id, if one is set; null means "all
     * characters".
     * @returns {string|null}
     */
    #getActivePartyId() {
        try {
            const active = game.settings.get("pf2e", "activeParty");
            return typeof active === "string" && active ? active : null;
        } catch {
            return null;
        }
    }

    /**
     * When the system has an active party, restrict the HUD to its members.
     * Any surprise about the party data shape falls back to showing everyone.
     * @param {ActorPF2e} actor
     * @param {string|null} activePartyId
     */
    #inActiveParty(actor, activePartyId) {
        if (!activePartyId) return true;
        try {
            const party = game.actors.get(activePartyId);
            if (party?.type !== "party") return true;
            const members = party.system?.details?.members;
            if (!Array.isArray(members)) return true;
            return members.some((member) =>
                typeof member === "string" ? member === actor.uuid : member?.uuid === actor.uuid,
            );
        } catch {
            return true;
        }
    }

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------

    /** GM quick-award: +1 Mystic Point. */
    static async #onMysticAward(_event, target) {
        if (!game.user.isGM) return;
        const actor = MystiXPartyHUD.#actorFromRow(target);
        if (actor) await awardMysticPoints(actor, 1);
    }

    /** GM quick-remove: −1 Mystic Point. */
    static async #onMysticRemove(_event, target) {
        if (!game.user.isGM) return;
        const actor = MystiXPartyHUD.#actorFromRow(target);
        if (actor) await awardMysticPoints(actor, -1);
    }

    /** Click a character's name to open their sheet. */
    static #onOpenSheet(_event, target) {
        const actor = MystiXPartyHUD.#actorFromRow(target);
        actor?.sheet?.render(true, { focus: true });
    }

    /** Open the GM custom-effect manager. */
    static async #onOpenEffectManager() {
        await openEffectManager();
    }

    /** Expand/collapse the activity log panel. */
    static #onToggleLog() {
        const hud = MystiXPartyHUD.#instance();
        if (!hud) return;
        hud.#logExpanded = !hud.#logExpanded;
        hud.render(false);
    }

    /** Clear the activity log (GM only). */
    static async #onClearLog() {
        if (!game.user.isGM) return;
        await clearLog();
    }

    /** Open the GM log viewer dialog. */
    static async #onOpenLogViewer() {
        await openLogViewer();
    }

    /** Post the end-of-session report card. */
    static async #onSessionReport() {
        await postSessionReport();
    }

    /** Open one character's Mystic Point history popout. */
    static async #onActorHistory(_event, target) {
        const actor = MystiXPartyHUD.#actorFromRow(target);
        if (actor) await openActorLog(actor);
    }

    static #instance() {
        return Object.values(ui.windows ?? {}).find((app) => app.id === APP_ID) ?? null;
    }

    static #actorFromRow(target) {
        const row = target?.closest?.(".mystix-hud-row");
        const actorId = row?.dataset?.actorId;
        return actorId ? game.actors.get(actorId) ?? null : null;
    }

    // ------------------------------------------------------------------
    // Rendering helpers
    // ------------------------------------------------------------------

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);
        const root = toElement(this.element);
        if (!root) return;

        // Hero pips: left-click +1, right-click −1 (owners only).
        for (const pips of root.querySelectorAll(".mystix-hud-pool.hero .pips:not(.locked)")) {
            pips.addEventListener("click", () => this.#onHeroPipAdjust(pips, 1));
            pips.addEventListener("contextmenu", (event) => {
                event.preventDefault();
                this.#onHeroPipAdjust(pips, -1);
            });
        }

        // Mystic pips: left-click spends one, shift-click awards one (GM),
        // right-click removes one (GM).
        for (const pips of root.querySelectorAll(".mystix-hud-pool.mystic .pips")) {
            pips.addEventListener("click", (event) => this.#onMysticPipClick(event, pips));
            pips.addEventListener("contextmenu", (event) => {
                event.preventDefault();
                this.#onMysticPipAdjust(pips, -1);
            });
        }
    }

    async #onHeroPipAdjust(pips, delta) {
        const actor = MystiXPartyHUD.#actorFromRow(pips);
        if (!actor || !(game.user.isGM || actor.isOwner)) return;
        const hero = actor.heroPoints ?? actor.system?.resources?.heroPoints;
        if (!hero || hero.max <= 0) return;
        const next = Math.clamp(hero.value + delta, 0, hero.max);
        await actor.update({ "system.resources.heroPoints.value": next });
    }

    #onMysticPipClick(event, pips) {
        if (event.shiftKey) {
            this.#onMysticPipAdjust(pips, 1);
        } else {
            this.#onMysticPipSpend(pips);
        }
    }

    async #onMysticPipSpend(pips) {
        const actor = MystiXPartyHUD.#actorFromRow(pips);
        if (!actor || !(game.user.isGM || actor.isOwner)) return;
        // Spend through the effect chooser so custom effects are available.
        await openEffectChooser(actor);
    }

    async #onMysticPipAdjust(pips, delta) {
        if (!game.user.isGM) return;
        const actor = MystiXPartyHUD.#actorFromRow(pips);
        if (actor) await awardMysticPoints(actor, delta);
    }
}

/** Lazily create and toggle the singleton HUD. */
export function togglePartyHUD() {
    const existing = Object.values(ui.windows ?? {}).find((app) => app.id === APP_ID);
    if (existing) {
        existing.close();
        return null;
    }
    const hud = new MystiXPartyHUD();
    hud.render(true);
    return hud;
}

/** Re-render the HUD if it is open (keeps pips live on actor updates). */
export function refreshPartyHUD() {
    const existing = Object.values(ui.windows ?? {}).find((app) => app.id === APP_ID);
    if (existing?.rendered) existing.render(false);
}

/** Register the toggle keybinding. */
export function registerKeybinding() {
    game.keybindings.register("mystix", "togglePartyHUD", {
        name: "MYSTIX.HUD.KeybindingName",
        hint: "MYSTIX.HUD.KeybindingHint",
        editable: [{ key: "KeyH", modifiers: ["SHIFT"] }],
        onDown: () => {
            togglePartyHUD();
            return true;
        },
    });
}
