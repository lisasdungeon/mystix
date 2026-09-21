/**
 * MystiX — automatic Mystic Point refresh.
 *
 * Optional world settings top everyone's pool up to full when a new session
 * starts (guarded to once per calendar day, so world reloads and multiple GM
 * clients don't double-trigger) and/or when each combat encounter begins.
 *
 * The encounter refresh comes in two styles (world setting):
 *  - `refill`: top every pool up to full (the original behavior).
 *  - `fixed`:  grant a fixed number of points per encounter, accumulating
 *              toward each character's max instead of resetting it.
 */

import { recordActivity } from "./activity-log.js";
import { getMysticData, getSkipRefresh, loc, setMysticData } from "./core.js";

const SLUG = "mystix";

/**
 * Characters that carry a Mystic Point pool and have not opted out of
 * automatic refreshes.
 */
function refreshableCharacters() {
    return game.actors.filter(
        (actor) =>
            actor.type === "character" &&
            getMysticData(actor).max > 0 &&
            !getSkipRefresh(actor),
    );
}

/**
 * Grant a fixed number of Mystic Points, accumulating toward the actor's max.
 * @param {ActorPF2e} actor
 * @param {number} amount
 * @returns {Promise<{ changed: boolean, from: number, to: number }>}
 */
export async function applyFixedGrant(actor, amount) {
    const data = getMysticData(actor);
    const raw = Number(amount);
    const grant = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
    const to = Math.clamp(data.value + grant, 0, data.max);
    if (to === data.value) return { changed: false, from: data.value, to };
    await setMysticData(actor, { value: to });
    return { changed: true, from: data.value, to };
}

/**
 * Refresh every character's Mystic Points to full.
 * @param {{ announce?: boolean }} [options]
 * @returns {Promise<Array<{ actor: ActorPF2e, from: number, to: number }>>}
 *   The actors that changed, for callers that want the details.
 */
export async function refreshAllMysticPoints({ announce = true } = {}) {
    if (!game.user.isGM) {
        ui.notifications.warn(loc("MYSTIX.Errors.GMOnly"));
        return [];
    }
    const changes = [];
    for (const actor of refreshableCharacters()) {
        const data = getMysticData(actor);
        if (data.value >= data.max) continue;
        await setMysticData(actor, { value: data.max });
        changes.push({ actor, from: data.value, to: data.max });
        recordActivity({ actor, action: "refresh", from: data.value, to: data.max });
    }
    if (announce && changes.length > 0) announceRefresh("full", changes);
    return changes;
}

/**
 * Run the encounter refresh in the configured style: refill every pool to
 * full, or grant the fixed per-encounter amount.GM-only.
 * @param {{ announce?: boolean, style?: "refill" | "fixed", amount?: number }} [options]
 *   Override the world settings with `style`/`amount` if you like.
 * @returns {Promise<Array<{ actor: ActorPF2e, from: number, to: number }>>}
 */
export async function runEncounterRefresh({ announce = true, style, amount } = {}) {
    if (!game.user.isGM) {
        ui.notifications.warn(loc("MYSTIX.Errors.GMOnly"));
        return [];
    }
    const mode = style ?? game.settings.get(SLUG, "encounterRefreshStyle");
    if (mode === "fixed") {
        const grant = amount ?? game.settings.get(SLUG, "encounterGrant");
        return refreshFixed({ announce, grant });
    }
    return refreshAllMysticPoints({ announce });
}

/**
 * Grant a fixed number of Mystic Points to every refreshable character,
 * accumulating toward their max.
 * @param {{ announce?: boolean, grant?: number }} [options]
 * @returns {Promise<Array<{ actor: ActorPF2e, from: number, to: number }>>}
 */
export async function refreshFixed({ announce = true, grant } = {}) {
    if (!game.user.isGM) {
        ui.notifications.warn(loc("MYSTIX.Errors.GMOnly"));
        return [];
    }
    const amount = grant ?? game.settings.get(SLUG, "encounterGrant");
    const changes = [];
    for (const actor of refreshableCharacters()) {
        const { changed, from, to } = await applyFixedGrant(actor, amount);
        if (changed) {
            changes.push({ actor, from, to });
            recordActivity({ actor, action: "fixed-grant", amount, from, to });
        }
    }
    if (announce && changes.length > 0) announceRefresh("fixed", changes, amount);
    return changes;
}

/**
 * Post a chat message listing the refreshed characters, visible to everyone.
 * @param {"full" | "fixed"} style
 * @param {Array<{ actor: ActorPF2e, from: number, to: number }>} changes
 * @param {number} [amount] the fixed grant, for the "fixed" style header
 */
function announceRefresh(style, changes, amount) {
    const key = style === "fixed" ? "MYSTIX.Refresh.AnnounceFixed" : "MYSTIX.Refresh.Announce";
    const header = loc(key, { amount });
    const list = changes
        .map(({ actor, from, to }) => `<li><strong>${actor.name}</strong> ${from} → ${to}</li>`)
        .join("");
    ChatMessage.create({
        author: game.user.id,
        speaker: { alias: "MystiX" },
        content: `<div class="mystix-refresh-message"><p><i class="fa-solid fa-circle-m"></i> ${header}</p><ul>${list}</ul></div>`,
    });
}

/** Register the automatic refresh hooks. Call during `init`. */
export function registerRefreshHooks() {
    // Session start: once per calendar day, guarded against world reloads.
    Hooks.on("ready", async () => {
        if (!game.user.isGM) return;
        if (!game.settings.get(SLUG, "refreshOnSession")) return;
        const today = new Date().toISOString().slice(0, 10);
        const last = game.settings.get(SLUG, "lastSessionRefresh");
        if (last === today) return;
        await game.settings.set(SLUG, "lastSessionRefresh", today);
        await refreshAllMysticPoints();
    });

    // Encounter start: refresh at the start of every combat, in the
    // configured style (refill to full, or a fixed grant per encounter).
    Hooks.on("combatStart", async () => {
        if (!game.user.isGM) return;
        if (!game.settings.get(SLUG, "refreshOnEncounter")) return;
        await runEncounterRefresh();
    });
}
