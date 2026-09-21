function isTokenControl(control) {
    return control?.name === "token" || control?.name === "tokens";
}

function findTokenControl(controls) {
    if (Array.isArray(controls)) {
        return controls.find(isTokenControl) ?? null;
    }

    if (!controls || typeof controls !== "object") return null;

    const keyedControl = controls.token ?? controls.tokens;
    if (keyedControl) return keyedControl;

    return Object.values(controls).find(isTokenControl) ?? null;
}

export function addMystixSceneControls(controls, { isGM, togglePartyHUD, openEffectManager, openLogViewer }) {
    const tokenTools = findTokenControl(controls);
    if (!tokenTools?.tools) return false;

    tokenTools.tools.push({
        name: "mystix-hud",
        title: "MYSTIX.HUD.Title",
        icon: "fa-solid fa-circle-m",
        onClick: () => togglePartyHUD(),
        toggle: false,
        button: true,
    });

    if (isGM) {
        tokenTools.tools.push({
            name: "mystix-effects",
            title: "MYSTIX.Manager.Title",
            icon: "fa-solid fa-wand-magic-sparkles",
            onClick: () => openEffectManager(),
            toggle: false,
            button: true,
        });
        tokenTools.tools.push({
            name: "mystix-log",
            title: "MYSTIX.LogViewer.OpenTooltip",
            icon: "fa-solid fa-clipboard-list",
            onClick: () => openLogViewer(),
            toggle: false,
            button: true,
        });
    }

    return true;
}
