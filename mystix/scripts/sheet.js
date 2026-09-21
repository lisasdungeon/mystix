/**
 * MystiX — character sheet widget.
 *
 * Injects a Mythic Point pip row next to the system's Hero Point pips in the
 * character sheet header. Left-click spends a point, right-click opens the
 * GM award dialog.
 */

import { awardMysticPoints, getMysticData, isMystixActor, loc, toElement } from "./core.js";

/** FontAwesome glyph used for filled pips (system's hero points use fa-circle-h). */
const PIP_ICON = "fa-solid fa-circle-m";

/**
 * Inject the Mythic Points widget into a rendered character sheet.
 * @param {CharacterSheetPF2e} sheet The rendered sheet application
 * @param {HTMLElement} html The sheet's root element
 */
export function renderCharacterSheet(sheet, html) {
    const root = toElement(html);
    if (!root || !isMystixActor(sheet?.actor)) return;
    const actor = sheet.actor;

    // Anchor: the hero-points dots block in the header (falls back to the header itself).
    const anchor =
        root.querySelector(".char-header .char-details .dots") ??
        root.querySelector(".char-header .char-details") ??
        root.querySelector(".char-header");
    if (!anchor) {
        console.warn("MystiX | Could not find a header anchor on the character sheet.");
        return;
    }

    // Idempotency: drop any stale widget before re-adding.
    root.querySelector(".mystix-points")?.remove();

    const { value, max } = getMysticData(actor);
    if (max <= 0) return;

    const pips = Array.from({ length: max }, (_, index) => {
        const filled = index < value;
        return `<i class="${filled ? PIP_ICON : "fa-regular fa-circle"}"></i>`;
    }).join("");

    // Deliberately NOT shaped like the system's hero-point pips (no `dots`
    // class, no `data-index`): PF2e's sheet delegates hero-point clicks on
    // that markup and would move hero points instead of Mythic Points.
    const widget = document.createElement("div");
    widget.classList.add("mystix-points");
    widget.innerHTML = `
        <span class="label">${loc("MYSTIX.Sheet.Label")}</span>
        <span class="pips mystix-pips" data-tooltip="${loc("MYSTIX.Sheet.Tooltip", { value, max })}">
            ${pips}
        </span>
    `;

    anchor.after(widget);

    // Hero-point-style pips: left-click adds one, right-click removes one.
    // (The Mythic reroll lives on chat cards; spend-with-effects is in the
    // party HUD.) Players use their own pool; the GM adjusts anyone's.
    widget.querySelector(".mystix-pips")?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (game.user.isGM || actor.isOwner) awardMysticPoints(actor, 1);
    });
    widget.querySelector(".mystix-pips")?.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (game.user.isGM || actor.isOwner) awardMysticPoints(actor, -1);
    });
}
