/**
 * MystiX — dialogs for awarding and spending Mystic Points.
 */

import {
    awardMysticPoints,
    getMysticData,
    getSkipRefresh,
    loc,
    setMysticData,
    setSkipRefresh,
    spendMysticPoint,
} from "./core.js";

const { DialogV2 } = foundry.applications.api;

/**
 * GM dialog: award or remove points, set the actor's pool size, and toggle
 * the per-actor opt-out of automatic refreshes.
 * @param {ActorPF2e} actor
 */
export async function openAwardDialog(actor) {
    if (!game.user.isGM) {
        ui.notifications.warn(loc("MYSTIX.Errors.GMOnly"));
        return;
    }
    const data = getMysticData(actor);
    const skipping = getSkipRefresh(actor);
    const content = `
        <div class="form-group">
            <label>${loc("MYSTIX.Dialog.AwardLabel")}</label>
            <div class="form-fields">
                <input type="number" name="award" value="1" step="1" />
            </div>
            <p class="hint">${loc("MYSTIX.Dialog.AwardHint")}</p>
        </div>
        <div class="form-group">
            <label>${loc("MYSTIX.Dialog.SetMaxLabel")}</label>
            <div class="form-fields">
                <input type="number" name="max" value="${data.max}" min="0" step="1" />
            </div>
            <p class="hint">${loc("MYSTIX.Dialog.SetMaxHint")}</p>
        </div>
        <hr />
        <div class="form-group mystix-dialog-checkbox">
            <label>${loc("MYSTIX.Dialog.SkipRefreshLabel")}</label>
            <div class="form-fields">
                <input type="checkbox" name="skipRefresh" ${skipping ? "checked" : ""} />
            </div>
            <p class="hint">${loc("MYSTIX.Dialog.SkipRefreshHint")}</p>
        </div>
    `;
    const result = await DialogV2.input({
        window: { title: loc("MYSTIX.Dialog.AwardTitle", { actor: actor.name }) },
        content,
        ok: {
            label: loc("MYSTIX.Dialog.Award"),
            icon: "fa-solid fa-circle-m",
        },
        modal: true,
    });
    if (!result) return;

    const awardAmount = Number(result.award);
    const newMax = Math.max(0, Math.trunc(Number(result.max)) || 0);
    // Award first (clamped against the old max), then persist the new max.
    // Both writes are dot-path updates, so flags.mystix.skipRefresh is kept.
    if (Number.isFinite(awardAmount) && awardAmount !== 0) {
        await awardMysticPoints(actor, awardAmount);
    }
    await setMysticData(actor, { max: newMax });
    await setSkipRefresh(actor, result.skipRefresh === true);
}

/**
 * Player-facing spend dialog: confirm using a Mystic Point on a
 * Hero-Point-style use. The reroll itself is handled from chat cards via
 * chat.js; this dialog covers freeform "table ruling" spends.
 * @param {ActorPF2e} actor
 */
export async function openSpendDialog(actor) {
    const data = getMysticData(actor);
    if (data.value <= 0) {
        ui.notifications.warn(loc("MYSTIX.Chat.RerollNoPoints", { actor: actor.name }));
        return;
    }
    const confirmed = await DialogV2.confirm({
        window: { title: loc("MYSTIX.Dialog.SpendTitle") },
        content: `<p>${loc("MYSTIX.Dialog.SpendBody", { value: data.value })}</p>`,
        modal: true,
    });
    if (confirmed) await spendMysticPoint(actor);
}
