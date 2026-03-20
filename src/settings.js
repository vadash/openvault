/**
 * OpenVault Settings Initialization
 *
 * Initializes extension settings with defaults using lodash.merge.
 * Preserves existing user settings while adding any missing defaults.
 */

import { defaultSettings, extensionName } from './constants.js';
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

    // SillyTavern provides lodash.merge via context
    const { extensionSettings, lodash } = context;

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
}

// Auto-initialize on import
loadSettings();
