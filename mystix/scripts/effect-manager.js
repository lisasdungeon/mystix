/**
 * MystiX — GM manager for the custom mystic effect registry.
 *
 * Lists every effect with an enable toggle, add/edit/delete controls, and an
 * editor form supporting the three built-in effect types.
 */

import { loc } from "./core.js";
import { deleteEffect, getEffects, summarizeEffect, upsertEffect } from "./effects.js";

const { DialogV2 } = foundry.applications.api;
const SLUG = "mystix";

/** The currently-open manager dialog, if any (guards re-entrancy). */
let activeManager = null;

/**
 * Open (or focus) the effect manager. GM only.
 * @returns {Promise<void>}
 */
export async function openEffectManager() {
    if (!game.user.isGM) {
        ui.notifications.warn(loc("MYSTIX.Errors.GMOnly"));
        return;
    }
    if (activeManager) {
        activeManager.bringToFront();
        return;
    }

    const entries = Object.entries(getEffects());
    const content = `
        <div class="mystix-manager">
            <p class="mystix-manager-hint">${loc("MYSTIX.Manager.Hint")}</p>
            ${
                entries.length
                    ? entries
                          .map(
                              ([key, def]) => `
                    <div class="mystix-manager-row" data-key="${key}">
                        <label class="mystix-manager-enabled" data-tooltip="${loc("MYSTIX.Manager.EnabledTooltip")}">
                            <input type="checkbox" data-action="toggle" ${def.enabled !== false ? "checked" : ""} />
                        </label>
                        <div class="mystix-manager-info">
                            <div class="mystix-manager-name">${def.name ?? key}</div>
                            <div class="mystix-manager-summary">${summarizeEffect({ ...def, key })}</div>
                        </div>
                        <div class="mystix-manager-controls">
                            <button type="button" class="mystix-manager-btn" data-action="edit" data-tooltip="${loc("MYSTIX.Manager.Edit")}"><i class="fa-solid fa-pen"></i></button>
                            <button type="button" class="mystix-manager-btn" data-action="delete" data-tooltip="${loc("MYSTIX.Manager.Delete")}"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>`,
                          )
                          .join("")
                    : `<p class="mystix-manager-empty">${loc("MYSTIX.Manager.Empty")}</p>`
            }
            <div class="mystix-manager-footer">
                <button type="button" class="mystix-manager-add" data-action="add">
                    <i class="fa-solid fa-plus"></i> ${loc("MYSTIX.Manager.Add")}
                </button>
                <button type="button" class="mystix-manager-close" data-action="close-dialog">
                    <i class="fa-solid fa-xmark"></i> ${loc("MYSTIX.Dialog.Cancel")}
                </button>
            </div>
        </div>
    `;

    const dialog = new DialogV2({
        window: { title: loc("MYSTIX.Manager.Title"), resizable: true },
        content,
        modal: false,
    });
    activeManager = dialog;
    dialog.addEventListener("close", () => {
        activeManager = null;
    });

    await dialog.render({ force: true });
    const root = dialog.element;

    // Enable toggles.
    for (const checkbox of root.querySelectorAll('.mystix-manager-row input[data-action="toggle"]')) {
        checkbox.addEventListener("change", onToggle);
    }

    // Row and footer buttons.
    root.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-action]");
        if (!button || button.dataset.action === "toggle") return;
        const key = button.closest(".mystix-manager-row")?.dataset.key ?? null;
        switch (button.dataset.action) {
            case "add":
                await dialog.close();
                await editEffectDialog(null);
                break;
            case "close-dialog":
                await dialog.close();
                break;
            case "edit":
                if (key) {
                    await dialog.close();
                    await editEffectDialog(key);
                }
                break;
            case "delete":
                if (key) {
                    await dialog.close();
                    await confirmAndDelete(key);
                }
                break;
        }
    });
}

/** Toggle an effect's enabled flag in the registry. */
async function onToggle(event) {
    const key = event.target.closest(".mystix-manager-row")?.dataset.key;
    if (!key) return;
    const effects = fu.deepClone(getEffects());
    const def = effects[key];
    if (!def) return;
    def.enabled = event.target.checked;
    await game.settings.set(SLUG, "customEffects", effects);
}

/** Confirm, then delete an effect; reopen the manager afterwards. */
async function confirmAndDelete(key) {
    const effects = getEffects();
    const name = effects[key]?.name ?? key;
    const confirmed = await DialogV2.confirm({
        window: { title: loc("MYSTIX.Manager.DeleteTitle") },
        content: `<p>${loc("MYSTIX.Manager.DeleteBody", { name })}</p>`,
        modal: true,
    });
    if (confirmed) await deleteEffect(key);
    await openEffectManager();
}

/**
 * Add-or-edit dialog for one effect. Reopens the manager when done.
 * @param {string|null} key Null creates a new effect.
 */
export async function editEffectDialog(key) {
    const isNew = !key;
    const effects = fu.deepClone(getEffects());
    const def = isNew
        ? { name: "", type: "bonus", bonus: 2, rounds: 1, text: "", enabled: true }
        : effects[key];
    if (!def) return;

    const typeOptions = [
        ["bonus", "MYSTIX.Manager.TypeBonus"],
        ["stabilize", "MYSTIX.Manager.TypeStabilize"],
        ["message", "MYSTIX.Manager.TypeMessage"],
    ];
    const typeSelect = typeOptions
        .map(
            ([value, langKey]) =>
                `<option value="${value}" ${def.type === value ? "selected" : ""}>${loc(langKey)}</option>`,
        )
        .join("");

    const content = `
        <div class="mystix-editor">
            <div class="form-group">
                <label>${loc("MYSTIX.Manager.NameLabel")}</label>
                <div class="form-fields">
                    <input type="text" name="name" value="${escapeAttr(def.name)}" placeholder="${loc("MYSTIX.Manager.NamePlaceholder")}" />
                </div>
            </div>
            <div class="form-group">
                <label>${loc("MYSTIX.Manager.TypeLabel")}</label>
                <div class="form-fields"><select name="type">${typeSelect}</select></div>
                <p class="hint">${loc("MYSTIX.Manager.TypeHint")}</p>
            </div>
            <div class="form-group">
                <label>${loc("MYSTIX.Manager.BonusLabel")}</label>
                <div class="form-fields"><input type="number" name="bonus" value="${Number(def.bonus) || 0}" step="1" /></div>
                <p class="hint">${loc("MYSTIX.Manager.BonusHint")}</p>
            </div>
            <div class="form-group">
                <label>${loc("MYSTIX.Manager.RoundsLabel")}</label>
                <div class="form-fields"><input type="number" name="rounds" value="${Math.max(1, Number(def.rounds) || 1)}" min="1" step="1" /></div>
                <p class="hint">${loc("MYSTIX.Manager.RoundsHint")}</p>
            </div>
            <div class="form-group">
                <label>${loc("MYSTIX.Manager.TextLabel")}</label>
                <div class="form-fields"><input type="text" name="text" value="${escapeAttr(def.text ?? "")}" /></div>
                <p class="hint">${loc("MYSTIX.Manager.TextHint")}</p>
            </div>
        </div>
    `;

    const result = await DialogV2.wait({
        window: {
            title: isNew ? loc("MYSTIX.Manager.AddTitle") : loc("MYSTIX.Manager.EditTitle", { name: def.name ?? key }),
        },
        content,
        buttons: [
            {
                action: "save",
                label: loc("MYSTIX.Manager.Save"),
                icon: "fa-solid fa-floppy-disk",
                default: true,
                callback: (event, button) => collectEditorForm(button.form),
            },
            {
                action: "cancel",
                label: loc("MYSTIX.Dialog.Cancel"),
                icon: "fa-solid fa-xmark",
            },
        ],
        modal: true,
    });

    if (result === "cancel" || !result) {
        await openEffectManager();
        return;
    }

    // Persist the collected definition.
    const name = (result.name ?? "").trim();
    if (!name) {
        ui.notifications.warn(loc("MYSTIX.Manager.NameRequired"));
        await openEffectManager();
        return;
    }
    const finalKey = isNew ? slugifyKey(name) : key;
    const current = fu.deepClone(getEffects());
    if (!isNew && finalKey !== key) delete current[key];
    current[finalKey] = {
        name,
        type: result.type ?? "bonus",
        bonus: Number(result.bonus) || 0,
        rounds: Math.max(1, Number(result.rounds) || 1),
        text: (result.text ?? "").toString(),
        enabled: isNew ? true : (effects[key]?.enabled !== false),
    };
    await game.settings.set(SLUG, "customEffects", current);
    await openEffectManager();
}

/** Read the editor form fields into a plain object. */
function collectEditorForm(form) {
    if (!form) return null;
    const fd = new FormData(form);
    return {
        name: fd.get("name")?.toString() ?? "",
        type: fd.get("type")?.toString() ?? "bonus",
        bonus: Number(fd.get("bonus")) || 0,
        rounds: Number(fd.get("rounds")) || 1,
        text: fd.get("text")?.toString() ?? "",
    };
}

/** Derive a stable registry key from an effect name. */
function slugifyKey(name) {
    const slug = String(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug || `effect-${Date.now()}`;
}

/** Escape a value for safe inclusion in a double-quoted HTML attribute. */
function escapeAttr(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
