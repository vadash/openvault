/**
 * OpenVault Utilities
 *
 * Core utility functions used throughout the extension.
 * Re-exports from submodules for backwards compatibility.
 */

import { getDeps } from './deps.js';
import { extensionName } from './constants.js';

// Re-export from submodules
export { escapeHtml, showToast } from './utils/dom.js';
export { getOpenVaultData, getCurrentChatId, saveOpenVaultData, generateId } from './utils/data.js';
export { estimateTokens, sliceToTokenBudget, safeParseJSON, sortMemoriesBySequence } from './utils/text.js';
// Re-export scheduler functions for backwards compatibility
export { getExtractedMessageIds, getUnextractedMessageIds } from './extraction/scheduler.js';

/**
 * Wrap a promise with a timeout
 * @param {Promise} promise - The promise to wrap
 * @param {number} ms - Timeout in milliseconds
 * @param {string} operation - Name for error message
 */
export function withTimeout(promise, ms, operation = 'Operation') {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)
        )
    ]);
}

/**
 * Safe wrapper for setExtensionPrompt with error handling
 * @param {string} content - Content to inject
 * @returns {boolean} True if successful
 */
export function safeSetExtensionPrompt(content) {
    try {
        const deps = getDeps();
        deps.setExtensionPrompt(
            extensionName,
            content,
            deps.extension_prompt_types.IN_PROMPT,
            0
        );
        return true;
    } catch (error) {
        getDeps().console.error('[OpenVault] Failed to set extension prompt:', error);
        return false;
    }
}

/**
 * Log message if debug mode is enabled
 * @param {string} message
 */
export function log(message) {
    const settings = getDeps().getExtensionSettings()[extensionName];
    if (settings?.debugMode) {
        getDeps().console.log(`[OpenVault] ${message}`);
    }
}

/**
 * Check if OpenVault extension is enabled
 * @returns {boolean}
 */
export function isExtensionEnabled() {
    return getDeps().getExtensionSettings()[extensionName]?.enabled === true;
}

/**
 * Check if OpenVault extension is enabled (automatic mode is now implicit)
 * @returns {boolean}
 */
export function isAutomaticMode() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    return settings?.enabled === true;
}
