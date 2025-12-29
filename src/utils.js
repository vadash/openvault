/**
 * OpenVault Utilities
 *
 * Core utility functions used throughout the extension.
 */

import { getContext } from '../../../../extensions.js';
import { saveChatConditional, setExtensionPrompt, extension_prompt_types } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { extensionName, METADATA_KEY, MEMORIES_KEY, CHARACTERS_KEY, RELATIONSHIPS_KEY, LAST_PROCESSED_KEY, EXTRACTED_BATCHES_KEY } from './constants.js';

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
 * Get OpenVault data from chat metadata
 * @returns {Object|null} Returns null if context is not available
 */
export function getOpenVaultData() {
    const context = getContext();
    if (!context) {
        console.warn('[OpenVault] getContext() returned null/undefined');
        return null;
    }
    if (!context.chatMetadata) {
        context.chatMetadata = {};
    }
    if (!context.chatMetadata[METADATA_KEY]) {
        context.chatMetadata[METADATA_KEY] = {
            [MEMORIES_KEY]: [],
            [CHARACTERS_KEY]: {},
            [RELATIONSHIPS_KEY]: {},
            [LAST_PROCESSED_KEY]: -1,
            [EXTRACTED_BATCHES_KEY]: [],
        };
    }
    return context.chatMetadata[METADATA_KEY];
}

/**
 * Get current chat ID for tracking across async operations
 * @returns {string|null}
 */
export function getCurrentChatId() {
    const context = getContext();
    return context?.chatId || context?.chat_metadata?.chat_id || null;
}

/**
 * Save OpenVault data to chat metadata
 * @returns {Promise<boolean>} True if save succeeded, false otherwise
 */
export async function saveOpenVaultData() {
    try {
        await saveChatConditional();
        log('Data saved to chat metadata');
        return true;
    } catch (error) {
        console.error('[OpenVault] Failed to save data:', error);
        showToast('error', `Failed to save data: ${error.message}`);
        return false;
    }
}

/**
 * Safe wrapper for toastr to handle cases where it might not be available
 * @param {string} type - 'success', 'error', 'warning', 'info'
 * @param {string} message - Message to display
 * @param {string} title - Toast title (default: 'OpenVault')
 * @param {object} options - Additional toastr options
 */
export function showToast(type, message, title = 'OpenVault', options = {}) {
    if (typeof toastr !== 'undefined' && toastr[type]) {
        toastr[type](message, title, options);
    } else {
        console.log(`[OpenVault] Toast (${type}): ${message}`);
    }
}

/**
 * Safe wrapper for setExtensionPrompt with error handling
 * @param {string} content - Content to inject
 * @returns {boolean} True if successful
 */
export function safeSetExtensionPrompt(content) {
    try {
        setExtensionPrompt(
            extensionName,
            content,
            extension_prompt_types.IN_CHAT,
            0
        );
        return true;
    } catch (error) {
        console.error('[OpenVault] Failed to set extension prompt:', error);
        return false;
    }
}

/**
 * Generate a unique ID
 * @returns {string}
 */
export function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 * @returns {string}
 */
export function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Log message if debug mode is enabled
 * @param {string} message
 */
export function log(message) {
    const settings = extension_settings[extensionName];
    if (settings?.debugMode) {
        console.log(`[OpenVault] ${message}`);
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
 * Check if OpenVault extension is enabled
 * @returns {boolean}
 */
export function isExtensionEnabled() {
    return extension_settings[extensionName]?.enabled === true;
}

/**
 * Check if OpenVault extension is enabled AND in automatic mode
 * @returns {boolean}
 */
export function isAutomaticMode() {
    const settings = extension_settings[extensionName];
    return settings?.enabled && settings?.automaticMode;
}

/**
 * Parse JSON from a response that may be wrapped in markdown code blocks
 * @param {string} response - Raw response potentially containing markdown
 * @returns {any} Parsed JSON object
 * @throws {Error} If JSON parsing fails
 */
export function parseJsonFromMarkdown(response) {
    let cleaned = response;
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        cleaned = jsonMatch[1];
    }
    return JSON.parse(cleaned.trim());
}

/**
 * Sort memories by sequence number or creation time
 * @param {Object[]} memories - Array of memory objects
 * @param {boolean} ascending - Sort ascending (oldest first) or descending (newest first)
 * @returns {Object[]} Sorted copy of memories array
 */
export function sortMemoriesBySequence(memories, ascending = true) {
    return [...memories].sort((a, b) => {
        const seqA = a.sequence ?? a.created_at ?? 0;
        const seqB = b.sequence ?? b.created_at ?? 0;
        return ascending ? seqA - seqB : seqB - seqA;
    });
}
