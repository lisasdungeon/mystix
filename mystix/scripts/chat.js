/**
 * MystiX — chat integration.
 *
 * Adds a "Reroll with Mystic Point" entry to chat message context menus.
 * The reroll is delegated to the system's `Check.rerollFromMessage`, which
 * handles message replacement, degree-of-success recalculation, and initiative
 * syncing. MystiX spends the Mystic Point itself and rerolls with no resource
 * so the system does not apply the mythic proficiency-swap.
 */

import { getMysticData, loc, spendMysticPoint } from "./core.js";
import { recordActivity } from "./activity-log.js";

/**
 * Register the chat context menu hook. No-op when disabled by setting.
 */
export function registerChatReroll() {
    Hooks.on("getChatMessageContextOptions", (app, menuItems) => {
        if (!game.settings.get("mystix", "enableChatReroll")) return;
        menuItems.push({
            name: loc("MYSTIX.Chat.RerollMenu"),
            icon: "fa-solid fa-circle-m",
            condition: (element) => canRerollMessage(element),
            callback: (element) => onRerollClick(element),
        });
    });
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
 * Spend a Mystic Point and hand off to the system's reroll implementation.
 * @param {HTMLElement} element
 */
async function onRerollClick(element) {
    const message = getMessage(element);
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
    try {
        await game.pf2e.Check.rerollFromMessage(message, {});
    } catch (error) {
        // Refund the point rather than silently eating it on a failed reroll.
        const data = getMysticData(actor);
        await actor.update({ "flags.mystix.value": data.value + 1 });
        recordActivity({ actor, action: "failed", detail: describeRerollDetail(message) });
        ui.notifications.error(loc("MYSTIX.Chat.RerollFailed"));
        console.error("MystiX | rerollFromMessage error:", error);
    }
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
