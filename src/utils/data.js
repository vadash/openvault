/**
 * OpenVault Data Utilities
 *
 * Data persistence and metadata access utilities.
 */

import { getDeps } from '../deps.js';
import { extensionName, METADATA_KEY, MEMORIES_KEY, CHARACTERS_KEY, LAST_PROCESSED_KEY } from '../constants.js';
import { showToast } from './dom.js';

/**
 * Log message if debug mode is enabled
 * @param {string} message
 */
function log(message) {
    const settings = getDeps().getExtensionSettings()[extensionName];
    if (settings?.debugMode) {
        getDeps().console.log(`[OpenVault] ${message}`);
    }
}

/**
 * Get OpenVault data from chat metadata
 * @returns {Object|null} Returns null if context is not available
 */
export function getOpenVaultData() {
    const context = getDeps().getContext();
    if (!context) {
        getDeps().console.warn('[OpenVault] getContext() returned null/undefined');
        return null;
    }
    if (!context.chatMetadata) {
        context.chatMetadata = {};
    }
    if (!context.chatMetadata[METADATA_KEY]) {
        context.chatMetadata[METADATA_KEY] = {
            [MEMORIES_KEY]: [],
            [CHARACTERS_KEY]: {},
            [LAST_PROCESSED_KEY]: -1,
        };
    }
    return context.chatMetadata[METADATA_KEY];
}

/**
 * Get current chat ID for tracking across async operations
 * @returns {string|null}
 */
export function getCurrentChatId() {
    const context = getDeps().getContext();
    return context?.chatId || context?.chat_metadata?.chat_id || null;
}

/**
 * Save OpenVault data to chat metadata
 * @param {string} [expectedChatId] - If provided, verify chat hasn't changed before saving
 * @returns {Promise<boolean>} True if save succeeded, false otherwise
 */
export async function saveOpenVaultData(expectedChatId = null) {
    // If expectedChatId provided, verify we're still on the same chat
    if (expectedChatId !== null) {
        const currentId = getCurrentChatId();
        if (currentId !== expectedChatId) {
            getDeps().console.warn(`[OpenVault] Chat changed during operation (expected: ${expectedChatId}, current: ${currentId}), aborting save`);
            return false;
        }
    }

    try {
        await getDeps().saveChatConditional();
        log('Data saved to chat metadata');
        return true;
    } catch (error) {
        getDeps().console.error('[OpenVault] Failed to save data:', error);
        showToast('error', `Failed to save data: ${error.message}`);
        return false;
    }
}

/**
 * Generate a unique ID
 * @returns {string}
 */
export function generateId() {
    return `${getDeps().Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
