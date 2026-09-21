/**
 * MystiX — chat integration.
 *
 * Adds a "Reroll using a Mythic Point" entry to chat message context menus.
 * The reroll is delegated to the system's `Check.rerollFromMessage`, which
 * handles message replacement, degree-of-success recalculation, and initiative
 * syncing. MystiX spends the Mythic Point itself, then applies the mythic
 * proficiency bonus (+10) to the rerolled die through the system's
 * `pf2e.preReroll` hook — the sanctioned point for altering the cloned roll.
 */

import { getMysticData, loc, spendMysticPoint, toElement } from "./core.js";
import { recordActivity } from "./activity-log.js";

/** The standard mythic proficiency bonus (the setting's default). */
export const MYTHIC_PROFICIENCY_BONUS = 10;

/**
 * The configured reroll bonus. A world setting so tables can play plain
 * rerolls (0) or any house-rule value; falls back to the standard +10.
 * @returns {number}
 */
export function getMythicRerollBonus() {
    const value = Number(game.settings?.get("mystix", "mythicRerollBonus"));
    return Number.isFinite(value) && value >= 0 ? value : MYTHIC_PROFICIENCY_BONUS;
}

/**
 * One-shot flag marking the in-flight reroll as a Mythic Point reroll, so the
 * `pf2e.preReroll` hook only touches rerolls this module initiated.
 */
let pendingMythicReroll = false;

/**
 * Mark the next `pf2e.preReroll` firing as a MystiX-initiated Mythic Point
 * reroll. Exposed for testing; the click path calls this via `onRerollClick`.
 */
export function beginMythicReroll() {
    pendingMythicReroll = true;
}

/** Whether a Mythic Point reroll is currently in flight. */
export function isMythicRerollPending() {
    return pendingMythicReroll;
}

/**
 * Register the chat context menu hook, the on-card reroll buttons, and the
 * reroll adjustment hook. All are gated by the same setting.
 */
export function registerChatReroll() {
    Hooks.on("getChatMessageContextOptions", (app, menuItems) => {
        if (!game.settings.get("mystix", "enableChatReroll")) return;
        const bonus = getMythicRerollBonus();
        menuItems.push({
            name: bonus > 0
                ? loc("MYSTIX.Settings.MythicRerollBonus.MenuLabelBonus", { bonus })
                : loc("MYSTIX.Settings.MythicRerollBonus.MenuLabel"),
            icon: "fa-solid fa-circle-m",
            condition: (element) => canRerollMessage(element),
            callback: (element) => onRerollClick(element),
        });
    });
    Hooks.on("renderChatMessage", (message, html) => {
        if (!game.settings.get("mystix", "enableChatReroll")) return;
        injectRerollButtons(message, html);
    });
    Hooks.on("pf2e.preReroll", applyMythicProficiency);
}

/**
 * Is this chat element a rerollable check belonging to an actor the user owns?
 * @param {HTMLElement} element
 */
function canRerollMessage(element) {
    const message = getMessage(element);
    if (!message) return false;
    const actor = message.speakerActor ?? null;
    if (!actor) return false;
    // Ownership gate: players may only reroll their own actors' checks.
    if (!(actor.isOwner || game.user.isGM)) return false;
    if (getMysticData(actor).value <= 0) return false;
    const roll = message.rolls?.at(0);
    return Boolean(roll?.isRerollable ?? false);
}

/**
 * Context-menu entry: resolve the message, then run the Mythic reroll.
 * @param {HTMLElement} element
 */
async function onRerollClick(element) {
    const message = getMessage(element);
    if (message) await performMythicReroll(message);
}

/**
 * Spend a Mythic Point and hand off to the system's reroll implementation,
 * which receives the +10 mythic proficiency bonus via `pf2e.preReroll`.
 * @param {ChatMessage} message
 */
export async function performMythicReroll(message) {
    const actor = message?.speakerActor ?? null;
    if (!message || !actor) return;
    const spent = await spendMysticPoint(actor, {
        logAction: "reroll",
        logDetail: describeRerollDetail(message),
    });
    if (!spent) {
        ui.notifications.warn(loc("MYSTIX.Chat.RerollNoPoints", { actor: actor.name }));
        return;
    }
    beginMythicReroll();
    try {
        await game.pf2e.Check.rerollFromMessage(message, {});
    } catch (error) {
        // Refund the point rather than silently eating it on a failed reroll.
        const data = getMysticData(actor);
        await actor.update({ "flags.mystix.value": data.value + 1 });
        recordActivity({ actor, action: "failed", detail: describeRerollDetail(message) });
        ui.notifications.error(loc("MYSTIX.Chat.RerollFailed"));
        console.error("MystiX | rerollFromMessage error:", error);
    } finally {
        pendingMythicReroll = false;
    }
}

/**
 * Apply the mythic proficiency bonus (+10) to the cloned reroll while it is
 * still unevaluated — exactly what `pf2e.preReroll` exists to allow. Plain
 * hero-point rerolls (and any reroll not initiated by MystiX) are untouched.
 * @param {Roll} _oldRoll The original evaluated roll (read-only by contract)
 * @param {Roll} newRoll The cloned, unevaluated reroll to alter
 * @param {boolean} [heroPoint] True when the system is spending a hero point
 */
export function applyMythicProficiency(_oldRoll, newRoll, heroPoint = false) {
    if (heroPoint || !pendingMythicReroll) return;
    pendingMythicReroll = false;
    const bonus = getMythicRerollBonus();
    if (bonus === 0) return; // plain reroll — nothing to add
    const { OperatorTerm, NumericTerm } = foundry.dice.terms;
    newRoll.terms.push(
        new OperatorTerm({ operator: "+" }),
        new NumericTerm({ number: bonus }),
    );
    newRoll._formula = `${newRoll._formula} + ${bonus}`;
}

/**
 * Describe the check behind a reroll for the activity log: a PF2e flavor
 * line ("Strike [attack-strike] (DC 18)") becomes "Strike (DC 18)". Falls
 * back to the message flavor, then to a generic "d20 check".
 * @param {ChatMessage} message
 * @returns {string}
 */
export function describeRerollDetail(message) {
    const flavor = message?.flavor;
    if (typeof flavor === "string" && flavor) {
        const match = flavor.match(/^(.*?)\s*(?:\[[^\]]*\])?\s*(?:\(DC\s*\d+\))?\s*$/u);
        if (match?.[1]) return match[1];
    }
    return "d20 check";
}

/**
 * Resolve the ChatMessage document from a context-menu element.
 * @param {HTMLElement} element
 * @returns {ChatMessage|null}
 */
function getMessage(element) {
    const messageId = element?.dataset?.messageId
        ?? element?.closest("li.message, [data-message-id]")?.dataset?.messageId;
    return messageId ? game.messages?.get(messageId) ?? null : null;
}

/**
 * Append reroll buttons (Hero Point and Mythic Point) to a rendered check
 * card. Buttons only appear for owners/GMs on rerollable d20 checks, and
 * each button only when that pool has a point to spend.
 * @param {ChatMessage} message
 * @param {HTMLElement|jQuery|Array} html
 */
export function injectRerollButtons(message, html) {
    const content = toElement(html)?.querySelector?.(".message-content");
    if (!content) return;
    const actor = message?.speakerActor ?? null;
    if (!actor) return;
    // Same gate as the context menu: owners and the GM only.
    if (!(actor.isOwner || game.user.isGM)) return;
    const roll = message.rolls?.at(0);
    if (!(roll?.isRerollable ?? false)) return;
    if (content.querySelector(".mystix-reroll-row")) return;

    const hero = actor.heroPoints ?? actor.system?.resources?.heroPoints;
    const mythic = getMysticData(actor);
    const buttons = [];
    if ((hero?.value ?? 0) > 0) {
        buttons.push(
            `<button type="button" class="mystix-reroll-btn" data-reroll="hero" `
            + `data-tooltip="${loc("MYSTIX.Chat.RerollTooltipHero")}">`
            + `<i class="fa-solid fa-hospital-symbol"></i>${loc("MYSTIX.Chat.RerollButtonHero")}</button>`,
        );
    }
    if (mythic.value > 0) {
        const bonus = getMythicRerollBonus();
        const tooltip = bonus > 0
            ? loc("MYSTIX.Settings.MythicRerollBonus.TooltipMythicBonus", { bonus })
            : loc("MYSTIX.Settings.MythicRerollBonus.TooltipMythic");
        buttons.push(
            `<button type="button" class="mystix-reroll-btn" data-reroll="mythic" `
            + `data-tooltip="${tooltip}">`
            + `<i class="fa-solid fa-circle-m"></i>${loc("MYSTIX.Chat.RerollButtonMythic")}</button>`,
        );
    }
    if (buttons.length === 0) return;

    const row = document.createElement("div");
    row.classList.add("mystix-reroll-row");
    row.innerHTML = buttons.join("");
    row.addEventListener("click", async (event) => {
        const button = event.target.closest(".mystix-reroll-btn");
        if (!button) return;
        event.preventDefault();
        if (button.dataset.reroll === "hero") {
            // The system handles the hero-point spend, flavor, and warnings.
            await game.pf2e.Check.rerollFromMessage(message, { heroPoint: true });
        } else {
            await performMythicReroll(message);
        }
    });
    content.append(row);
}
