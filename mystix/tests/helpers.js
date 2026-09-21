/**
 * MystiX — shared test helpers.
 *
 * Installs minimal mocks for the Foundry/PF2e globals used by the code under
 * test (game, ui, actor flags, Math.clamp), so `scripts/core.js` runs under
 * plain Node.
 */

import { mock } from "node:test";

/**
 * Install global mocks. Call once at the top of each test file.
 * @returns {{ mockActor: (overrides?: object) => object }} factory for test actors
 */
export function setupFoundryMocks() {
    // Math.clamp exists in Foundry's ES build, not in older Node versions.
    if (typeof Math.clamp !== "function") {
        Math.clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    }

    // Shim the browser DOM global that toElement() checks against.
    globalThis.Element ??= class Element {};

    const settingsStore = new Map();
    const socketHandlers = [];
    const socketSent = [];
    const hookCalls = [];
    globalThis.game = {
        actors: [],
        user: {
            isGM: true,
            name: "GM",
            // User document flags, backed by getFlag/setFlag/unsetFlag.
            flags: {},
            getFlag(scope, key) {
                return this.flags?.[scope]?.[key];
            },
            async setFlag(scope, key, value) {
                this.flags ??= {};
                this.flags[scope] ??= {};
                this.flags[scope][key] = structuredClone(value);
            },
            async unsetFlag(scope, key) {
                if (this.flags?.[scope]) delete this.flags[scope][key];
            },
        },
        i18n: {
            format: (key, args) => {
                let text = key;
                for (const [k, v] of Object.entries(args ?? {})) text = text.replace(`{${k}}`, v);
                return text;
            },
        },
        settings: {
            get: (scope, key) => settingsStore.get(`${scope}.${key}`),
            set: async (scope, key, value) => settingsStore.set(`${scope}.${key}`, value),
            register: () => {},
        },
        // Socket mock: `on` captures handlers, `emit` records into `sent`
        // without loopback (like the real cross-client socket). Tests dispatch
        // inbound messages manually via the handlers.
        socket: {
            handlers: socketHandlers,
            sent: socketSent,
            on: (name, callback) => socketHandlers.push({ name, callback }),
            emit: (name, data) => socketSent.push({ name, data }),
        },
    };
    // Foundry helper library used by the modules under test. ApplicationV2
    // stubs let modules define ApplicationV2 classes at import time.
    class MockApplicationV2 {
        constructor(options = {}) {
            this.options = options;
        }
    }
    globalThis.foundry = {
        applications: {
            api: {
                ApplicationV2: MockApplicationV2,
                HandlebarsApplicationMixin: (Base) => class extends Base {},
            },
        },
    };
    // Foundry helpers used by the modules under test.
    globalThis.fu ??= { deepClone: (value) => structuredClone(value) };
    globalThis.Hooks = {
        calls: hookCalls,
        callAll: (name, ...args) => hookCalls.push({ name, args }),
        on: () => {},
        off: () => {},
    };
    globalThis.ui = {
        notifications: {
            warn: mock.fn(),
            error: mock.fn(),
        },
    };

    /** Build a fake character actor with a mutable flags.mystix pool. */
    const mockActor = (overrides = {}) => ({
        type: "character",
        name: overrides.name ?? "Test Actor",
        id: overrides.id ?? "actor-1",
        isOwner: true,
        flags: overrides.flags ?? { mystix: { value: 1, max: 3 } },
        updates: [],
        update(data) {
            this.updates.push(data);
            // Mirror real document semantics for both update shapes:
            // whole-scope writes ({"flags.mystix": {...}}) and dot-path
            // writes ({"flags.mystix.value": 1}), which merge per-key.
            for (const [key, val] of Object.entries(data)) {
                if (key === "flags.mystix") {
                    this.flags.mystix = { ...this.flags.mystix, ...val };
                } else if (key.startsWith("flags.mystix.")) {
                    this.flags.mystix ??= {};
                    this.flags.mystix[key.slice("flags.mystix.".length)] = val;
                }
            }
        },
    });

    return { mockActor };
}

/** Clear the notifications call history between assertions. */
export function resetNotifications() {
    globalThis.ui.notifications.warn.mock.resetCalls();
    globalThis.ui.notifications.error.mock.resetCalls();
}
