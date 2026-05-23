/**
 * OpenVault Settings Initialization
 *
 * Initializes extension settings with defaults using lodash.merge.
 * Preserves existing user settings while adding any missing defaults.
 */

import { defaultSettings, extensionName, MEMORIES_KEY } from './constants.js';
import { getDeps } from './deps.js';

/**
 * Initialize extension settings with defaults using lodash.merge.
 * Preserves existing user settings while adding any missing defaults.
 *
 * Note: This is called automatically on module import when running in SillyTavern.
 * In tests, the mocks may not provide lodash - this is expected and handled gracefully.
 */
export function loadSettings() {
    const deps = getDeps();
    const context = deps.getContext();
    const extensionSettings = deps.getExtensionSettings();

    // SillyTavern provides lodash.merge via context
    const { lodash } = context;

    // If lodash isn't available yet (e.g., in test mocks), skip initialization
    // The settings will be initialized properly when running in actual ST
    if (!lodash || !lodash.merge) {
        return;
    }

    // Use lodash.merge (bundled in ST) for proper deep merge
    // This ensures new default settings are added without overwriting user customizations
    extensionSettings[extensionName] = lodash.merge(
        structuredClone(defaultSettings),
        extensionSettings[extensionName] || {}
    );

    // Migration check: ST Vector storage has been removed
    const settings = extensionSettings[extensionName];
    if (settings.embeddingSource === 'st_vector') {
        const console = deps.getContext().console;
        const toastr = deps.getContext().toastr;

        // Log detailed error to console
        if (console) {
            console.error(
                'OpenVault: ST Vector storage has been removed. ' +
                    'Maintaining two parallel storage systems (local + ST Vectra DB) was unsustainable ' +
                    'due to fragile sync and subpar similarity quality. Local embeddings now provide ' +
                    'full cosine similarity control. If you need ST Vector, switch to the stable_23 branch.'
            );
        }

        // Show toast notification
        if (toastr) {
            toastr.error(
                'ST Vector storage has been removed. Your embedding source has been automatically reset to the local model. See F12 console for details.',
                'OpenVault Migration',
                { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true }
            );
        }

        // Auto-reset to default local model
        settings.embeddingSource = 'multilingual-e5-small';
    }
}

/**
 * Get settings object or nested value using lodash.get
 * @param {string} [path] - Optional lodash path (dot notation)
 * @param {*} [defaultValue] - Default value if path not found
 * @returns {Settings|*} Settings object or value at path
 */
export function getSettings(path, defaultValue) {
    const deps = getDeps();
    const lodash = deps.getContext()?.lodash;
    const settings = deps.getExtensionSettings()[extensionName];

    if (path === undefined) {
        return settings;
    }

    return lodash?.get(settings, path, defaultValue) ?? defaultValue;
}

/**
 * Handle side effects when settings change (e.g., wipe data on feature disable).
 * @param {string} path - Lodash path (dot notation)
 * @param {*} value - Value being set
 */
async function handleSettingChangeSideEffects(path, value) {
    // Only handle side effects for injection position = -2 (DISABLED)
    if (path !== 'injection.reflections.position' && path !== 'injection.world.position') {
        return;
    }

    if (value !== -2) {
        return; // Not disabling
    }

    // Lazy-load dependencies to avoid circular imports
    const { getOpenVaultData, saveOpenVaultData } = await import('./store/chat-data.js');
    const { refreshAllUI } = await import('./ui/render.js');

    const data = getOpenVaultData();
    if (!data) {
        return; // No data to wipe
    }

    let madeChanges = false;

    if (path === 'injection.reflections.position') {
        // Wipe reflection memories, keep events and global_synthesis
        const originalLength = data[MEMORIES_KEY]?.length || 0;
        data[MEMORIES_KEY] = (data[MEMORIES_KEY] || []).filter((m) => m.type !== 'reflection');
        madeChanges = madeChanges || data[MEMORIES_KEY].length !== originalLength;

        // Clear reflection state accumulator
        if (data.reflection_state && Object.keys(data.reflection_state).length > 0) {
            data.reflection_state = {};
            madeChanges = true;
        }
    }

    if (path === 'injection.world.position') {
        // Delete global world state
        if (data.global_world_state) {
            delete data.global_world_state;
            madeChanges = true;
        }

        // Clear edges needing consolidation
        if (data.graph?._edgesNeedingConsolidation?.length > 0) {
            data.graph._edgesNeedingConsolidation = [];
            madeChanges = true;
        }

        // Reset graph message count
        if (data.graph_message_count !== 0) {
            data.graph_message_count = 0;
            madeChanges = true;
        }
    }

    if (madeChanges) {
        await saveOpenVaultData();
        refreshAllUI();
    }
}

/**
 * Set settings value using lodash.set
 * @param {string} path - Lodash path (dot notation)
 * @param {*} value - Value to set
 */
export async function setSetting(path, value) {
    const deps = getDeps();
    const lodash = deps.getContext()?.lodash;
    const settings = deps.getExtensionSettings()[extensionName];

    if (lodash?.set) {
        lodash.set(settings, path, value);
    } else {
        // Fallback: simple setByPath implementation
        const keys = String(path)
            .split(/[.[\]]+/)
            .filter(Boolean);
        let current = settings;
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            const numKey = /^\d+$/.test(key) ? parseInt(key, 10) : key;
            if (!(numKey in current)) {
                current[numKey] = /^\d+$/.test(keys[i + 1]) ? [] : {};
            }
            current = current[numKey];
        }
        const lastKey = keys[keys.length - 1];
        const numLastKey = /^\d+$/.test(lastKey) ? parseInt(lastKey, 10) : lastKey;
        current[numLastKey] = value;
    }
    deps.saveSettingsDebounced();

    // Handle side effects (e.g., wipe data on disable)
    await handleSettingChangeSideEffects(path, value);
}

/**
 * Check if path exists in settings
 * @param {string} path - Lodash path (dot notation)
 * @returns {boolean}
 */
export function hasSettings(path) {
    const deps = getDeps();
    const lodash = deps.getContext()?.lodash;
    const settings = deps.getExtensionSettings()[extensionName];

    return lodash?.has(settings, path) ?? false;
}

// Auto-initialize on import
loadSettings();
