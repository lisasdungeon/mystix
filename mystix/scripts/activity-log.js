/**
 * MystiX — Mystic Point activity log.
 *
 * A rolling, newest-first record of who spent, was awarded, or gained Mystic
 * Points from refreshes. Stored in a hidden world setting (synced to every
 * client) and appended on the GM client, so a single authoritative copy is
 * kept regardless of which user performed the action:
 *
 * - GM-side spends/awards are recorded directly.
 * - Player-side spends are relayed over the module socket to the GM client,
 *   which appends the entry — players see the log once the setting syncs.
 */

import { getMysticData, loc } from "./core.js";

const SLUG = "mystix";
const SETTING = "activityLog";
const MAX_ENTRIES = 200;

/** The socket message types MystiX understands. */
export const LOG_SOCKET_TYPE = "log-entry";
export const LOG_CHANGED_TYPE = "log-changed";

/** The most recent log entries, newest first. */
export function getLog() {
    return game.settings.get(SLUG, SETTING) ?? [];
}

/**
 * The newest `count` entries from the log, or a shallow copy of the whole
 * log when `count` is not a positive number. Shared by the HUD panel and
 * the GM log viewer.
 * @param {object[]} log Newest-first log entries.
 * @param {number|null} count
 * @returns {object[]}
 */
export function filterLogData(log, count = null) {
    const limit = Math.trunc(Number(count));
    return Number.isFinite(limit) && limit > 0 ? log.slice(0, limit) : [...log];
}

/** Append an entry locally (no relay). GM tooling and tests. */
export async function appendLogEntry(entry) {
    if (!game.user.isGM) return;
    const record = {
        at: Date.now(),
        actorId: entry.actorId ?? null,
        actorName: entry.actorName ?? "Unknown",
        action: entry.action ?? "unknown",
        amount: entry.amount ?? null,
        from: entry.from ?? null,
        to: entry.to ?? null,
        userName: entry.userName ?? game.user?.name ?? "GM",
        detail: entry.detail ?? null,
    };
    const log = fu.deepClone(getLog());
    log.unshift(record);
    if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES;
    await game.settings.set(SLUG, SETTING, log);
    // Nudge every client (and this one) to re-render the HUD log panel.
    Hooks.callAll("mystixLogChanged");
    game.socket?.emit(`module.${SLUG}`, { type: LOG_CHANGED_TYPE });
}

/** Clear the log (GM only). */
export async function clearLog() {
    if (!game.user.isGM) return;
    await game.settings.set(SLUG, SETTING, []);
}

/**
 * Record an activity. GMs write directly; players relay to the GM client.
 * Fire-and-forget from callers — failures never block a spend or award.
 * @param {{ actor: ActorPF2e|null, action: string, amount?: number,
 *           from?: number, to?: number, detail?: string|null }} payload
 */
export function recordActivity({ actor, action, amount = null, from = null, to = null, detail = null }) {
    try {
        const payload = {
            actorId: actor?.id ?? null,
            actorName: actor?.name ?? "Unknown",
            action,
            amount,
            from,
            to,
            userName: game.user?.name ?? "GM",
            detail,
        };
        if (game.user.isGM) {
            void appendLogEntry(payload);
            return;
        }
        game.socket?.emit(`module.${SLUG}`, { type: LOG_SOCKET_TYPE, payload });
    } catch (error) {
        console.warn("MystiX | could not record activity:", error);
    }
}

/** Handle an inbound socket message from a player relaying an activity. */
async function onSocketMessage(message) {
    if (message?.type === LOG_CHANGED_TYPE) {
        Hooks.callAll("mystixLogChanged");
        return;
    }
    if (message?.type !== LOG_SOCKET_TYPE) return;
    if (!game.user.isGM) return;
    await appendLogEntry(message.payload ?? {});
}

/** Register the hidden setting and the socket listener. Call during `init`. */
export function registerActivityLog() {
    game.settings.register(SLUG, SETTING, {
        scope: "world",
        config: false,
        type: Array,
        default: [],
    });
    game.socket?.on(`module.${SLUG}`, (message) => {
        void onSocketMessage(message);
    });
}

// ----------------------------------------------------------------------
// Presentation helpers
// ----------------------------------------------------------------------

/** One localized action label for a log entry's `action` code. */
export function describeAction(action, amount = null) {
    switch (action) {
        case "spend":
            return loc("MYSTIX.Log.Actions.Spend");
        case "award":
            return loc("MYSTIX.Log.Actions.Award", { amount });
        case "remove":
            return loc("MYSTIX.Log.Actions.Remove", { amount: Math.abs(amount ?? 0) });
        case "refresh":
            return loc("MYSTIX.Log.Actions.Refresh");
        case "fixed-grant":
            return loc("MYSTIX.Log.Actions.FixedGrant", { amount });
        case "effect":
            return loc("MYSTIX.Log.Actions.Effect");
        case "reroll":
            return loc("MYSTIX.Log.Actions.Reroll");
        case "cancel":
            return loc("MYSTIX.Log.Actions.Cancel");
        case "failed":
            return loc("MYSTIX.Log.Actions.Failed");
        default:
            return action;
    }
}

/** HH:MM local time for a log entry, for the HUD list. */
export function formatTime(timestamp) {
    const date = new Date(timestamp);
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

/**
 * Locale date + time for a log entry, for the GM log viewer. Invalid or
 * missing timestamps render as an em dash.
 * @param {number|null|undefined} timestamp
 */
export function formatDateTime(timestamp) {
    if (!Number.isFinite(Number(timestamp))) return "—";
    const date = new Date(Number(timestamp));
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** Localized "who did it" fragment: the user behind the change. */
export function describeUser(userName) {
    return loc("MYSTIX.Log.ByUser", { user: userName });
}

/**
 * The effect name or check involved in an effect/reroll entry, trimmed;
 * plain spends and refreshes have no detail (empty string).
 * @param {string|null|undefined} detail
 * @returns {string}
 */
export function describeDetail(detail) {
    return typeof detail === "string" && detail.trim() ? detail.trim() : "";
}
