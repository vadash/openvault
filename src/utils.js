/**
 * OpenVault Utilities
 *
 * Core utility functions used throughout the extension.
 * Re-exports from submodules for backwards compatibility.
 */

import { getDeps } from './deps.js';
import { extensionName, MEMORIES_KEY } from './constants.js';

// Re-export from submodules
export { escapeHtml, showToast } from './utils/dom.js';
export { getOpenVaultData, getCurrentChatId, saveOpenVaultData, generateId } from './utils/data.js';
export { estimateTokens, sliceToTokenBudget, safeParseJSON, sortMemoriesBySequence } from './utils/text.js';

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
 * Get set of message IDs that have been extracted into memories
 * @param {Object} data - OpenVault data object
 * @returns {Set<number>} Set of extracted message IDs
 */
export function getExtractedMessageIds(data) {
    const extractedIds = new Set();
    if (!data) return extractedIds;

    for (const memory of (data[MEMORIES_KEY] || [])) {
        for (const msgId of (memory.message_ids || [])) {
            extractedIds.add(msgId);
        }
    }
    return extractedIds;
}

/**
 * Get array of message indices that have not been extracted yet
 * @param {Object[]} chat - Chat messages array
 * @param {Set<number>} extractedIds - Set of already extracted message IDs
 * @param {number} excludeLastN - Number of recent messages to exclude
 * @returns {number[]} Array of unextracted message indices
 */
export function getUnextractedMessageIds(chat, extractedIds, excludeLastN = 0) {
    const unextractedIds = [];
    for (let i = 0; i < chat.length; i++) {
        if (!extractedIds.has(i)) {
            unextractedIds.push(i);
        }
    }
    return excludeLastN > 0 ? unextractedIds.slice(0, -excludeLastN) : unextractedIds;
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
