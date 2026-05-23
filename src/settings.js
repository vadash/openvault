/**
 * OpenVault Settings Initialization
 *
 * Initializes extension settings with defaults using lodash.merge.
 * Preserves existing user settings while adding any missing defaults.
 */

import { defaultSettings, extensionName, MEMORIES_KEY } from './constants.js';
import { getDeps } from './deps.js';

// Module-level initialization flag
let settingsInitialized = false;

// All required settings paths for validation
const REQUIRED_SETTINGS_PATHS = [
    'enabled',
    'extractionProfile',
    'backupProfile',
    'debugMode',
    'requestLogging',
    'extractionTokenBudget',
    'extractionRearviewTokens',
    'extractionMaxTurns',
    'retrievalFinalTokens',
    'autoHideEnabled',
    'visibleChatBudget',
    'backfillMaxRPM',
    'maxConcurrency',
    'embeddingSource',
    'ollamaUrl',
    'embeddingModel',
    'embeddingQueryPrefix',
    'embeddingDocPrefix',
    'alpha',
    'vectorSimilarityThreshold',
    'dedupSimilarityThreshold',
    'dedupJaccardThreshold',
    'forgetfulnessBaseLambda',
    'transientDecayMultiplier',
    'reflectionThreshold',
    'maxInsightsPerReflection',
    'worldContextBudget',
    'worldStateInterval',
    'entityWindowSize',
    'embeddingWindowSize',
    'recencyDecayFactor',
    'topEntitiesCount',
    'entityBoostWeight',
    'exactPhraseBoostWeight',
    'maxReflectionsPerCharacter',
    'bucketMinRepresentation',
    'bucketSoftBalanceBudget',
    'preambleLanguage',
    'extractionPrefill',
    'outputLanguage',
    'injection.memory.position',
    'injection.memory.depth',
    'injection.reflections.position',
    'injection.reflections.depth',
    'injection.world.position',
    'injection.world.depth',
];

/**
 * Validate that all required settings paths exist.
 * Throws if any required path is undefined.
 * @param {Object} settings - The settings object to validate
 */
function validateSettingsStructure(settings) {
    const deps = getDeps();
    const { lodash } = deps.getContext();

    for (const path of REQUIRED_SETTINGS_PATHS) {
        if (lodash.get(settings, path) === undefined) {
            throw new Error(`Required setting path "${path}" is undefined`);
        }
    }
}

/**
 * Initialize extension settings with strict validation.
 * Must be called before accessing any settings via getSettings().
 * Uses lodash.merge for deep merge of defaults with user settings.
 */
export function initializeSettings() {
    // Idempotent: skip if already initialized
    if (settingsInitialized) {
        return;
    }

    const deps = getDeps();
    const context = deps.getContext();
    const extensionSettings = deps.getExtensionSettings();
    const { lodash } = context;

    // Deep merge defaults with existing user settings
    extensionSettings[extensionName] = lodash.merge(
        structuredClone(defaultSettings),
        extensionSettings[extensionName] || {}
    );

    // Validate that all required paths exist after merge
    validateSettingsStructure(extensionSettings[extensionName]);

    // Migration check: ST Vector storage has been removed
    const settings = extensionSettings[extensionName];
    if (settings.embeddingSource === 'st_vector') {
        const console = context.console;
        const toastr = context.toastr;

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

    settingsInitialized = true;
}

/**
 * @deprecated Use initializeSettings() instead.
 * This is kept for backward compatibility but now calls initializeSettings().
 */
export function loadSettings() {
    initializeSettings();
}

/**
 * Get settings object or nested value using lodash.get
 * @param {string} [path] - Optional lodash path (dot notation)
 * @returns {Settings|*} Settings object or value at path
 * @throws {Error} If accessed before initialization or path is undefined
 */
export function getSettings(path) {
    if (!settingsInitialized) {
        throw new Error('Settings accessed before initialization. Call initializeSettings() first.');
    }

    const deps = getDeps();
    const lodash = deps.getContext()?.lodash;
    const settings = deps.getExtensionSettings()[extensionName];

    if (path === undefined) {
        return settings;
    }

    const result = lodash.get(settings, path);
    if (result === undefined) {
        throw new Error(`Setting "${path}" is undefined`);
    }
    return result;
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
