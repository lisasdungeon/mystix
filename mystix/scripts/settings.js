/**
 * MystiX — settings registration.
 */

const SLUG = "mystix";

export function registerSettings() {
    game.settings.register(SLUG, "defaultMax", {
        name: "MYSTIX.Settings.AwardDefaultMax.name",
        hint: "MYSTIX.Settings.AwardDefaultMax.hint",
        scope: "world",
        config: true,
        type: Number,
        default: 3,
        range: {
            min: 0,
            max: 10,
            step: 1,
        },
    });

    game.settings.register(SLUG, "enableChatReroll", {
        name: "MYSTIX.Settings.ChatReroll.name",
        hint: "MYSTIX.Settings.ChatReroll.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
    });

    game.settings.register(SLUG, "autoOpenHud", {
        name: "MYSTIX.Settings.AutoOpenHud.name",
        hint: "MYSTIX.Settings.AutoOpenHud.hint",
        scope: "client",
        config: true,
        type: Boolean,
        default: false,
    });

    game.settings.register(SLUG, "refreshOnSession", {
        name: "MYSTIX.Settings.RefreshOnSession.name",
        hint: "MYSTIX.Settings.RefreshOnSession.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
    });

    game.settings.register(SLUG, "refreshOnEncounter", {
        name: "MYSTIX.Settings.RefreshOnEncounter.name",
        hint: "MYSTIX.Settings.RefreshOnEncounter.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
    });

    // How each combat's refresh grants points: refill to max, or a fixed grant.
    game.settings.register(SLUG, "encounterRefreshStyle", {
        name: "MYSTIX.Settings.EncounterRefreshStyle.name",
        hint: "MYSTIX.Settings.EncounterRefreshStyle.hint",
        scope: "world",
        config: true,
        type: String,
        choices: {
            refill: "MYSTIX.Settings.EncounterRefreshStyle.Refill",
            fixed: "MYSTIX.Settings.EncounterRefreshStyle.Fixed",
        },
        default: "refill",
    });

    game.settings.register(SLUG, "encounterGrant", {
        name: "MYSTIX.Settings.EncounterGrant.name",
        hint: "MYSTIX.Settings.EncounterGrant.hint",
        scope: "world",
        config: true,
        type: Number,
        default: 1,
        range: {
            min: 0,
            max: 10,
            step: 1,
        },
    });

    // Bookkeeping for the once-per-day session refresh guard.
    game.settings.register(SLUG, "lastSessionRefresh", {
        scope: "world",
        config: false,
        type: String,
        default: "",
    });

    // Custom mystic-only effects, editable by the GM.
    game.settings.register(SLUG, "customEffects", {
        scope: "world",
        config: false,
        type: Object,
        default: {
            "bonus-next-check": {
                name: "Mystic Surge",
                type: "bonus",
                bonus: 2,
                rounds: 1,
                enabled: true,
            },
            "auto-stabilize": {
                name: "Mystic Mending",
                type: "stabilize",
                enabled: true,
            },
        },
    });

    // Keep a small API surface for macros and other modules.
    game.mystix = {
        slug: SLUG,
    };
}
