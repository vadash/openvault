/**
 * OpenVault Dependencies
 *
 * Centralized dependency injection for testability.
 * All external dependencies (SillyTavern, browser globals) are accessed through this module.
 */

import { getContext as stGetContext, extension_settings as stExtensionSettings } from '../../../../extensions.js';
import { saveChatConditional as stSaveChatConditional, setExtensionPrompt as stSetExtensionPrompt, extension_prompt_types as stPromptTypes, saveSettingsDebounced as stSaveSettingsDebounced, eventSource as stEventSource, event_types as stEventTypes } from '../../../../../script.js';
import { ConnectionManagerRequestService as stConnectionManager } from '../../../shared.js';

/**
 * Default dependencies - real SillyTavern implementations
 */
const defaultDeps = {
    // SillyTavern context
    getContext: () => stGetContext(),
    getExtensionSettings: () => stExtensionSettings,

    // Chat operations
    saveChatConditional: () => stSaveChatConditional(),
    saveSettingsDebounced: () => stSaveSettingsDebounced(),

    // Event system
    eventSource: stEventSource,
    eventTypes: stEventTypes,

    // Prompt injection
    setExtensionPrompt: (name, content, type, position) =>
        stSetExtensionPrompt(name, content, type, position),
    extension_prompt_types: stPromptTypes,

    // LLM communication
    connectionManager: stConnectionManager,

    // Notifications
    showToast: (type, message, title, options) => {
        if (typeof toastr !== 'undefined' && toastr[type]) {
            toastr[type](message, title, options);
        } else {
            console.log(`[OpenVault] Toast (${type}): ${message}`);
        }
    },

    // Console
    console: {
        log: (...args) => console.log(...args),
        warn: (...args) => console.warn(...args),
        error: (...args) => console.error(...args),
    },

    // Timing
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    Date: {
        now: () => Date.now(),
    },

    // Fetch (for embeddings)
    fetch: (...args) => fetch(...args),
};

// Current active dependencies (can be replaced for testing)
let currentDeps = defaultDeps;

/**
 * Get current dependencies
 * @returns {typeof defaultDeps}
 */
export function getDeps() {
    return currentDeps;
}

/**
 * Set dependencies (for testing)
 * @param {Partial<typeof defaultDeps>} deps
 */
export function setDeps(deps) {
    currentDeps = { ...defaultDeps, ...deps };
}

/**
 * Reset to default dependencies
 */
export function resetDeps() {
    currentDeps = defaultDeps;
}
