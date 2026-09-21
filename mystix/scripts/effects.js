/**
 * MystiX — custom mythic-only effects.
 *
 * The GM defines a registry of effects in world settings (Mystic Surge,
 * Mystic Mending, or their own). Players pick one via a chooser dialog when
 * spending a point from the sheet widget or the party HUD. Mechanical
 * application:
 *
 * - "bonus"     → an AE-like effect item granting a FlatModifier to checks
 * - "stabilize" → removes the dying condition (hero-point-style)
 * - "message"   → posts a chat card; nothing mechanical
 */

import { getMysticData, loc, spendMysticPoint } from "./core.js";
import { recordActivity } from "./activity-log.js";

const SLUG = "mystix";

/** Read the effect registry. */
export function getEffects() {
    return game.settings.get(SLUG, "customEffects") ?? {};
}

/** Read one effect definition by key, or null. */
export function getEffect(key) {
    return getEffects()[key] ?? null;
}

/**
 * Persist an effect definition (create or update).
 * @param {string} key
 * @param {object} data
 */
export async function upsertEffect(key, data) {
    if (!game.user.isGM) return;
    const effects = fu.deepClone(getEffects());
    effects[key] = data;
    await game.settings.set(SLUG, "customEffects", effects);
}

/** Remove an effect from the registry. */
export async function deleteEffect(key) {
    if (!game.user.isGM) return;
    const effects = fu.deepClone(getEffects());
    delete effects[key];
    await game.settings.set(SLUG, "customEffects", effects);
}

/** Enabled effects, as [{key, ...definition}] sorted by name. */
export function getEnabledEffects() {
    return Object.entries(getEffects())
        .filter(([, def]) => def.enabled !== false)
        .map(([key, def]) => ({ key, ...def }))
        .sort((a, b) => (a.name ?? a.key).localeCompare(b.name ?? b.key));
}

// ----------------------------------------------------------------------
// Chat cards
// ----------------------------------------------------------------------

/** Post a styled chat card for a mystic effect trigger. */
function postEffectCard({ actor, effect, description, image }) {
    return ChatMessage.create({
        author: game.user.id,
        speaker: { alias: actor?.name ?? "MystiX", scene: actor?.token?.scene?.id, token: actor?.token?.id },
        speakerActor: undefined,
        flavor: undefined,
        content: `
            <div class="mystix-effect-card" data-actor-id="${actor?.id ?? ""}">
                <div class="mystix-effect-header">
                    <img class="mystix-effect-image" src="${image}" alt="" />
                    <div>
                        <div class="mystix-effect-name"><i class="fa-solid fa-circle-m"></i> ${effect.name}</div>
                        <div class="mystix-effect-actor">${actor?.name ?? ""}</div>
                    </div>
                </div>
                <div class="mystix-effect-body">${description}</div>
            </div>
        `,
    });
}

// ----------------------------------------------------------------------
// Mechanical application
// ----------------------------------------------------------------------

/** The FlatModifier rule element for a bonus effect. */
function bonusRuleElement({ bonus }) {
    return {
        key: "FlatModifier",
        selector: "all",
        value: Number(bonus) || 0,
        type: "circumstance",
    };
}

/** Build the effect item source for a "bonus" effect. */
function buildBonusEffectSource({ actor, effect, rounds }) {
    const slug = `mystix-${effect.key ?? "effect"}`;
    const duration = { units: "rounds", value: Number(rounds) || 1, sustained: false, expiry: "turn-start" };
    return {
        type: "effect",
        name: `${effect.name} (${actor.name})`,
        img: "systems/pf2e/icons/effects/condition-effects.webp",
        system: {
            slug,
            description: {
                value: `<p>${loc("MYSTIX.EffectCard.BonusDescription", { name: effect.name, bonus: effect.bonus })}</p>`,
            },
            duration,
            tokenIcon: { show: true },
            traits: { value: [], custom: "" },
            rules: [bonusRuleElement(effect)],
        },
    };
}

/** The dying condition source, for the stabilize effect. */
function dyingConditionSource() {
    return {
        key: "dying",
        img: "systems/pf2e/icons/conditions/dying.webp",
        system: { slug: "dying" },
    };
}

/**
 * Apply one effect to an actor. Returns the description shown on the card.
 * @param {ActorPF2e} actor
 * @param {{key: string, name: string} & Record<string, unknown>} effect
 */
async function applyEffect(actor, effect) {
    switch (effect.type) {
        case "bonus": {
            const source = buildBonusEffectSource({ actor, effect, rounds: effect.rounds });
            const [item] = await actor.createEmbeddedDocuments("Item", [source]);
            return loc("MYSTIX.EffectCard.BonusDescription", { name: effect.name, bonus: effect.bonus });
        }
        case "stabilize": {
            const dying = actor.getCondition?.("dying");
            if (dying) {
                await dying.delete();
                return loc("MYSTIX.EffectCard.StabilizedDescription", { name: effect.name });
            }
            return loc("MYSTIX.EffectCard.NoConditionDescription", { name: effect.name });
        }
        case "message":
        default:
            return loc("MYSTIX.EffectCard.MessageDescription", { name: effect.name, text: effect.text ?? "" });
    }
}

/**
 * Trigger an effect for an actor: spend a Mystic Point, apply the effect,
 * and post the chat card. Shared by the chooser dialog and the macro API.
 * @param {ActorPF2e} actor
 * @param {string} effectKey
 * @param {{ skipSpend?: boolean }} [options]
 * @returns {Promise<boolean>} true if the effect was applied
 */
export async function triggerEffect(actor, effectKey, { skipSpend = false } = {}) {
    const effect = getEffect(effectKey);
    if (!effect) {
        ui.notifications.error(loc("MYSTIX.EffectCard.UnknownEffect"));
        return false;
    }
    const data = getMysticData(actor);
    if (!skipSpend) {
        if (data.value <= 0) {
            ui.notifications.warn(loc("MYSTIX.Chat.RerollNoPoints", { actor: actor.name }));
            return false;
        }
        const spent = await spendMysticPoint(actor, { logAction: "effect", logDetail: effect.name ?? effectKey });
        if (!spent) return false;
    }
    try {
        const description = await applyEffect(actor, effect);
        const image = actor.prototypeToken?.texture?.src ?? actor.img ?? "";
        await postEffectCard({ actor, effect, description, image });
        return true;
    } catch (error) {
        if (!skipSpend) {
            // Refund on failure so the point is never eaten.
            await actor.update({ "flags.mystix.value": getMysticData(actor).value + 1 });
            recordActivity({
                actor,
                action: "failed",
                detail: effect.name ?? effectKey,
            });
        }
        ui.notifications.error(loc("MYSTIX.EffectCard.Failed"));
        console.error("MystiX | effect trigger failed:", error);
        return false;
    }
}

// ----------------------------------------------------------------------
// Chooser dialog
// ----------------------------------------------------------------------

/**
 * Open the effect chooser for an actor. If the GM's registry has exactly one
 * enabled effect, it is applied directly; otherwise a DialogV2 picker shows.
 * @param {ActorPF2e} actor
 * @param {{ skipSpend?: boolean }} [options]
 */
export async function openEffectChooser(actor, { skipSpend = false } = {}) {
    const effects = getEnabledEffects();
    if (effects.length === 0) {
        ui.notifications.warn(loc("MYSTIX.EffectCard.NoEffects"));
        return;
    }
    const data = getMysticData(actor);
    if (!skipSpend && data.value <= 0) {
        ui.notifications.warn(loc("MYSTIX.Chat.RerollNoPoints", { actor: actor.name }));
        return;
    }

    if (effects.length === 1) {
        await triggerEffect(actor, effects[0].key, { skipSpend });
        return;
    }

    const content = `
        <div class="mystix-chooser">
            <p class="mystix-chooser-points">${loc("MYSTIX.EffectCard.ChooserPoints", { value: data.value })}</p>
            ${effects
                .map(
                    (effect) => `
                <button type="button" class="mystix-chooser-btn" data-effect-key="${effect.key}">
                    <i class="fa-solid fa-circle-m"></i>
                    <span class="mystix-chooser-name">${effect.name}</span>
                    <span class="mystix-chooser-summary">${summarizeEffect(effect)}</span>
                </button>
            `,
                )
                .join("")}
        </div>
    `;

    const { DialogV2 } = foundry.applications.api;
    const dialog = new DialogV2({
        window: { title: loc("MYSTIX.EffectCard.ChooserTitle", { actor: actor.name }) },
        content,
        modal: true,
    });
    await dialog.render({ force: true });

    // Wire the choice buttons; each closes the dialog and triggers.
    const root = dialog.element;
    for (const button of root.querySelectorAll(".mystix-chooser-btn")) {
        button.addEventListener("click", async () => {
            await dialog.close();
            await triggerEffect(actor, button.dataset.effectKey, { skipSpend });
        });
    }
}

/** One-line summary of what an effect does, for buttons and tooltips. */
export function summarizeEffect(effect) {
    switch (effect.type) {
        case "bonus":
            return loc("MYSTIX.EffectCard.SummaryBonus", { bonus: effect.bonus, rounds: effect.rounds });
        case "stabilize":
            return loc("MYSTIX.EffectCard.SummaryStabilize");
        case "message":
            return effect.text || loc("MYSTIX.EffectCard.SummaryMessage");
        default:
            return "";
    }
}
