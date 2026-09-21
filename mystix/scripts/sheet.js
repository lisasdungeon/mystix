/**
 * MystiX — character sheet widget.
 *
 * Injects a Mystic Point pip row next to the system's Hero Point pips in the
 * character sheet header. Left-click spends a point, right-click opens the
 * GM award dialog.
 */

import { getMysticData, isMystixActor, loc, toElement } from "./core.js";
import { openAwardDialog } from "./dialog.js";
import { openEffectChooser } from "./effects.js";

/** FontAwesome glyph used for filled pips (system's hero points use fa-circle-h). */
const PIP_ICON = "fa-solid fa-circle-m";

/**
 * Inject the Mystic Points widget into a rendered character sheet.
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
        return `<i class="${filled ? PIP_ICON : "fa-regular fa-circle"}" data-index="${index}"></i>`;
    }).join("");

    const widget = document.createElement("div");
    widget.classList.add("dots", "mystix-points");
    widget.innerHTML = `
        <span class="label">${loc("MYSTIX.Sheet.Label")}</span>
        <span class="pips mystix-pips" data-tooltip="${loc("MYSTIX.Sheet.Tooltip", { value, max })}">
            ${pips}
        </span>
    `;

    anchor.after(widget);

    // Left-click spends a point via the effect chooser (custom effects or
    // a plain spend); right-click opens the GM award dialog.
    widget.querySelector(".mystix-pips")?.addEventListener("click", (event) => {
        event.preventDefault();
        openEffectChooser(actor);
    });
    widget.querySelector(".mystix-pips")?.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (game.user.isGM) openAwardDialog(actor);
    });
}
