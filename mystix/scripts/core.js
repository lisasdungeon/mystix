/**
 * MystiX — Hero & Mythic Points for Pathfinder 2e (Foundry VTT)
 *
 * The Mystic Point pool is stored per-actor in the `flags.mystix` scope so it
 * is fully independent from the system's `mythic-points` resource (which the
 * PF2e system reserves for characters with a Mythic Calling).
 *
 * Pool writes use dot-path updates (`flags.mystix.value`) so sibling flags —
 * like the per-actor `skipRefresh` opt-out — are never clobbered.
 */

import { recordActivity } from "./activity-log.js";

const FLAG_SCOPE = "mystix";
const SLUG = "mystix";

export const MYSTIC_FLAG_SCOPE = FLAG_SCOPE;

/**
 * Current Mystic Point data for an actor.
 * `max` comes from actor flags, falling back to the world default.
 * @param {ActorPF2e|null} actor
 * @returns {{ value: number, max: number }}
 */
export function getMysticData(actor) {
    const flags = actor?.flags?.[FLAG_SCOPE] ?? {};
    const defaultMax = Number(game.settings.get(SLUG, "defaultMax")) || 0;
    // A stored max that isn't a usable number falls back to the world default.
    const storedMax = Number(flags.max);
    const max = Math.max(0, Math.trunc(Number.isFinite(storedMax) ? storedMax : defaultMax) || 0);
    const value = Math.clamp(Math.trunc(Number(flags.value ?? 0)) || 0, 0, max);
    return { value, max };
}

/**
 * Set the Mystic Point pool for an actor (GM tooling & dialogs).
 * @param {ActorPF2e} actor
 * @param {{ value?: number, max?: number }} data
 */
export async function setMysticData(actor, { value, max } = {}) {
    if (!actor) return;
    const current = getMysticData(actor);
    const nextMax = Math.max(0, Math.trunc(Number(max ?? current.max)) || 0);
    const nextValue = Math.clamp(Math.trunc(Number(value ?? current.value)) || 0, 0, nextMax);
    await actor.update({
        [`flags.${FLAG_SCOPE}.value`]: nextValue,
        [`flags.${FLAG_SCOPE}.max`]: nextMax,
    });
}

/**
 * Does this actor opt out of automatic Mystic Point refreshes
 * (session-start and encounter-start)? Manual spending/awarding is unaffected.
 * @param {ActorPF2e|null} actor
 * @returns {boolean}
 */
export function getSkipRefresh(actor) {
    return actor?.flags?.[FLAG_SCOPE]?.skipRefresh === true;
}

/**
 * Toggle an actor's opt-out of automatic refreshes.
 * @param {ActorPF2e} actor
 * @param {boolean} skip
 */
export async function setSkipRefresh(actor, skip) {
    if (!actor) return;
    await actor.update({ [`flags.${FLAG_SCOPE}.skipRefresh`]: skip === true });
}

/**
 * Award (or remove, if negative) Mystic Points, clamped to the actor's max.
 * @param {ActorPF2e} actor
 * @param {number} amount
 */
export async function awardMysticPoints(actor, amount) {
    if (!actor || !Number.isFinite(amount) || amount === 0) return;
    const data = getMysticData(actor);
    const from = data.value;
    await setMysticData(actor, { value: data.value + Math.trunc(amount) });
    const to = getMysticData(actor).value;
    if (to === from) return;
    recordActivity({
        actor,
        action: amount > 0 ? "award" : "remove",
        amount: Math.trunc(amount),
        from,
        to,
    });
}

/**
 * Spend one Mystic Point. Returns false when the pool is empty.
 * @param {ActorPF2e} actor
 * @param {{ logAction?: string, logDetail?: string|null }} [options]
 *   `logAction` relabels the spend in the activity log ("effect", "reroll",
 *   …); `logDetail` records what it was for (effect name, check DC…).
 * @returns {Promise<boolean>}
 */
export async function spendMysticPoint(actor, { logAction = "spend", logDetail = null } = {}) {
    const data = getMysticData(actor);
    if (!actor || data.value <= 0) return false;
    await setMysticData(actor, { value: data.value - 1 });
    recordActivity({
        actor,
        action: logAction,
        amount: -1,
        from: data.value,
        to: data.value - 1,
        detail: logDetail,
    });
    return true;
}

/**
 * Should MystiX show a Mystic Point widget for this actor?
 * @param {ActorPF2e|null} actor
 */
export function isMystixActor(actor) {
    return actor?.type === "character";
}

/** Localize with optional format arguments. */
export function loc(key, formatArgs) {
    return game.i18n.format(key, formatArgs ?? {});
}

/** Normalize hook-provided `html` (Element, jQuery, or array) to an Element. */
export function toElement(html) {
    if (html instanceof Element) return html;
    const first = Array.isArray(html) ? html[0] : html?.[0];
    return first instanceof Element ? first : null;
}
