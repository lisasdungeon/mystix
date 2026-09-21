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
 * A MystiX-initiated Mythic Point reroll is in flight: true from the click
 * until `performMythicReroll` finishes. `pf2e.reroll` (completion) fires while
 * this is still true, so `confirmMythicReroll` can see it.
 */
let pendingMythicReroll = false;

/** The +10 boost has not been applied yet; consumed by `applyMythicProficiency`. */
let pendingMythicBoost = false;

/**
 * Set once the system has genuinely rerolled (`pf2e.reroll` fired); a MystiX
 * reroll that finishes without it was cancelled or silently bailed, and its
 * point is refunded.
 */
let completedMythicReroll = false;

/**
 * Mark a MystiX-initiated Mythic Point reroll as started. Exposed for
 * testing; the click path calls this via `performMythicReroll`.
 */
export function beginMythicReroll() {
    pendingMythicReroll = true;
    pendingMythicBoost = true;
}

/** Whether a Mythic Point reroll is currently in flight. */
export function isMythicRerollPending() {
    return pendingMythicReroll;
}

/** Clear all reroll state. Defensive; also used between tests. */
export function resetRerollState() {
    pendingMythicReroll = false;
    pendingMythicBoost = false;
    completedMythicReroll = false;
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
        // The spent-point indicator documents a past reroll, so it renders
        // even when the context-menu setting is off.
        applyMythicIndicator(message, html);
        if (!game.settings.get("mystix", "enableChatReroll")) return;
        injectRerollButtons(message, html);
    });
    Hooks.on("pf2e.preReroll", applyMythicProficiency);
    // Confirms that a reroll actually happened; drives cancellation refunds.
    Hooks.on("pf2e.reroll", confirmMythicReroll);
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
    completedMythicReroll = false;
    try {
        // Flag the message so every client renders the Mythic indicator;
        // `applyMythicIndicator` swaps it in on render.
        await message.setFlag?.("mystix", "mythicReroll", getMythicRerollBonus());
        await game.pf2e.Check.rerollFromMessage(message, {});

        // The system fires `pf2e.reroll` only when a new roll actually
        // happened. If it never fired, the reroll was cancelled or silently
        // bailed (authorship guards, dismissed interactions) — refund.
        if (!completedMythicReroll) {
            await message.unsetFlag?.("mystix", "mythicReroll").catch(() => {});
            await refundMythicPoint(actor, describeRerollDetail(message), "cancel");
            ui.notifications.info(loc("MYSTIX.Chat.RerollRefunded"));
        }
    } catch (error) {
        await message.unsetFlag?.("mystix", "mythicReroll").catch(() => {});
        await refundMythicPoint(actor, describeRerollDetail(message), "failed");
        ui.notifications.error(loc("MYSTIX.Chat.RerollFailed"));
        console.error("MystiX | rerollFromMessage error:", error);
    } finally {
        pendingMythicReroll = false;
        pendingMythicBoost = false;
        completedMythicReroll = false;
    }
}

/**
 * `pf2e.reroll` hook: the system has genuinely rerolled. Marks the in-flight
 * MystiX reroll as complete so no cancellation refund fires.
 * @param {Roll} _oldRoll
 * @param {Roll} _newRoll
 * @param {boolean} [heroPoint]
 */
export function confirmMythicReroll(_oldRoll, _newRoll, heroPoint = false) {
    if (heroPoint || !pendingMythicReroll) return;
    completedMythicReroll = true;
}

/**
 * Return one Mythic Point to an actor's pool and log the reversal.
 * @param {ActorPF2e} actor
 * @param {string} detail What the reroll was for, for the log entry
 * @param {"cancel"|"failed"} action Log action code
 */
async function refundMythicPoint(actor, detail, action) {
    const data = getMysticData(actor);
    const max = data.max;
    await actor.update({ "flags.mystix.value": Math.clamp(data.value + 1, 0, max) });
    recordActivity({ actor, action, amount: 1, from: data.value, to: Math.min(data.value + 1, max), detail });
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
    if (heroPoint || !pendingMythicBoost) return;
    pendingMythicBoost = false;
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
 * Swap the system's generic reroll indicator for the Mythic one on cards that
 * carry a Mythic reroll flag — the same `.reroll-indicator` icon treatment the
 * system uses for hero-point rerolls (its dice icon becomes a glowing
 * fa-circle-m whose tooltip says who spent the Mythic Point).
 * @param {ChatMessage} message
 * @param {HTMLElement|jQuery|Array} html
 */
export function applyMythicIndicator(message, html) {
    const flag = message?.getFlag?.("mystix", "mythicReroll");
    if (flag == null) return;
    const root = toElement(html);
    if (!root) return;

    const bonus = Number(flag) || 0;
    const actorName = message.speakerActor?.name ?? message?.author?.name ?? "?";
    const tooltip = bonus > 0
        ? loc("MYSTIX.Chat.MythicIndicatorBonus", { actor: actorName, bonus })
        : loc("MYSTIX.Chat.MythicIndicator", { actor: actorName });

    const indicator = root.querySelector(".reroll-indicator");
    if (indicator) {
        // Replace the system's dice icon in place, keeping its positioning.
        for (const cls of [...indicator.classList]) {
            if (cls.startsWith("fa-dice")) indicator.classList.remove(cls);
        }
        indicator.classList.add("fa-solid", "fa-circle-m", "mystix-reroll-indicator");
        indicator.dataset.tooltip = tooltip;
        return;
    }

    // The system didn't render an indicator (e.g. an older message re-rendered
    // elsewhere) — create one at the top of the message content.
    const icon = document.createElement("i");
    icon.classList.add("fa-solid", "fa-circle-m", "reroll-indicator", "mystix-reroll-indicator");
    icon.dataset.tooltip = tooltip;
    root.querySelector(".message-content")?.prepend(icon);
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
