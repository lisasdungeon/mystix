/**
 * MystiX — per-actor Mystic Point history popout.
 *
 * A GM dialog showing one character's complete logged Mystic Point
 * history: a lifetime summary (net change, spent, gained, pools) plus the
 * full chronological entry list. Launched from the party HUD or the macro
 * API; re-renders live while the log changes.
 */

import { describeAction, describeDetail, getLog } from "./activity-log.js";
import { loc } from "./core.js";
import { csvDate, csvTime, entryDelta } from "./log-viewer.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The full (newest-first) log for one actor. Entries without an actor name
 * are excluded; per-actor rows and totals use the shared delta helper so
 * they agree with the summary views.
 * @param {string} actorName
 * @param {object[]} [log] Newest-first log; defaults to the stored log.
 * @returns {object[]}
 */
export function actorHistory(actorName, log = getLog()) {
    if (!actorName) return [];
    return log.filter((entry) => entry.actorName === actorName);
}

/**
 * Lifetime totals for one actor's history.
 * @param {object[]} history Newest-first entries from actorHistory.
 * @returns {{ net: number, spent: number, gained: number,
 *             firstPool: number|null, lastPool: number|null }}
 */
export function summarizeHistory(history) {
    let net = 0;
    let spent = 0;
    let gained = 0;
    let firstPool = null;
    let lastPool = null;
    for (let i = history.length - 1; i >= 0; i -= 1) {
        const entry = history[i];
        const delta = entryDelta(entry);
        net += delta;
        if (delta < 0) spent += -delta;
        else if (delta > 0) gained += delta;
        if (firstPool === null && entry.from != null && Number.isFinite(Number(entry.from))) {
            firstPool = Number(entry.from);
        }
        if (entry.to != null && Number.isFinite(Number(entry.to))) lastPool = Number(entry.to);
    }
    return { net, spent, gained, firstPool, lastPool };
}

/**
 * One chronological history row: date, time, action, detail, pool change.
 * @param {object} entry
 * @returns {{ when: string, action: string, detail: string, pool: string, delta: number }}
 */
export function renderHistoryRow(entry) {
    const delta = entryDelta(entry);
    const pool = entry.from != null && entry.to != null ? `${entry.from} → ${entry.to}` : "";
    return {
        when: `${csvDate(entry.at)} ${csvTime(entry.at)}`,
        action: describeAction(entry.action, entry.amount),
        detail: describeDetail(entry.detail),
        pool,
        delta,
    };
}

/** The ApplicationV2 popout class. GM-only content; lazily registered. */
class MystiXActorLog extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "mystix-actor-log",
        tag: "div",
        window: {
            frame: true,
            positioned: true,
            minimizable: true,
            resizable: true,
            title: "MystiX — Actor Log",
        },
        position: { width: 480, top: 200, left: 120 },
    };

    static PARTS = {
        main: { template: "modules/mystix/templates/actor-log.hbs" },
    };

    /** @override */
    async _prepareContext(_options) {
        const context = await super._prepareContext(_options);
        const actorName = this.options.actorName ?? "";
        const history = actorHistory(actorName);
        const summary = summarizeHistory(history);

        context.actorName = actorName;
        context.summary = summary;
        context.netClass = summary.net < 0 ? "down" : summary.net > 0 ? "up" : "flat";
        context.netLabel = summary.net > 0 ? `+${summary.net}` : `${summary.net}`;
        context.rows = [...history].reverse().map(renderHistoryRow);
        context.empty = loc("MYSTIX.ActorLog.Empty");
        context.spentLabel = loc("MYSTIX.ActorLog.Spent");
        context.gainedLabel = loc("MYSTIX.ActorLog.Gained");
        context.netTotalLabel = loc("MYSTIX.ActorLog.NetTotal");
        context.lifetimeLabel = loc("MYSTIX.ActorLog.Lifetime", {
            first: summary.firstPool ?? "?",
            last: summary.lastPool ?? "?",
        });
        return context;
    }
}

/**
 * Open (or focus) the history popout for one character. GM only.
 * @param {ActorPF2e|string} actorOrName Actor, or an exact actor name.
 * @returns {Promise<boolean>} true if a popout was opened or focused
 */
export async function openActorLog(actorOrName) {
    if (!game.user.isGM) {
        ui.notifications.warn(loc("MYSTIX.Errors.GMOnly"));
        return false;
    }
    const actorName = typeof actorOrName === "string" ? actorOrName : actorOrName?.name;
    if (!actorName) return false;

    const existing = Object.values(ui.windows ?? {}).find(
        (app) => app.constructor === MystiXActorLog && app.options?.actorName === actorName,
    );
    if (existing) {
        existing.bringToFront();
        return true;
    }

    const app = new MystiXActorLog({
        actorName,
        id: "mystix-actor-log",
        window: { title: loc("MYSTIX.ActorLog.Title", { actor: actorName }) },
    });
    await app.render({ force: true });
    return true;
}
