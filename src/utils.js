/**
 * OpenVault Utilities
 *
 * Consolidated utility functions for the extension.
 */

import { CHARACTERS_KEY, extensionName, LAST_PROCESSED_KEY, MEMORIES_KEY, METADATA_KEY } from './constants.js';
import { getDeps } from './deps.js';
import { jsonrepair } from './vendor/json-repair.js';

// --- Async ---

/**
 * Wrap a promise with a timeout
 * @param {Promise} promise - The promise to wrap
 * @param {number} ms - Timeout in milliseconds
 * @param {string} operation - Name for error message
 * @returns {Promise} Promise that rejects on timeout
 */
export function withTimeout(promise, ms, operation = 'Operation') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)),
    ]);
}

// --- DOM ---

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
 * Safe wrapper for toastr to handle cases where it might not be available
 * @param {string} type - 'success', 'error', 'warning', 'info'
 * @param {string} message - Message to display
 * @param {string} title - Toast title (default: 'OpenVault')
 * @param {object} options - Additional toastr options
 */
export function showToast(type, message, title = 'OpenVault', options = {}) {
    getDeps().showToast(type, message, title, options);
}

// --- Settings ---

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

// --- ST Helpers ---

/**
 * Safe wrapper for setExtensionPrompt with error handling
 * @param {string} content - Content to inject
 * @returns {boolean} True if successful
 */
export function safeSetExtensionPrompt(content) {
    try {
        const deps = getDeps();
        deps.setExtensionPrompt(extensionName, content, deps.extension_prompt_types.IN_PROMPT, 0);
        return true;
    } catch (error) {
        getDeps().console.error('[OpenVault] Failed to set extension prompt:', error);
        return false;
    }
}

// --- Data ---

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
    if (expectedChatId !== null) {
        const currentId = getCurrentChatId();
        if (currentId !== expectedChatId) {
            getDeps().console.warn(
                `[OpenVault] Chat changed during operation (expected: ${expectedChatId}, current: ${currentId}), aborting save`
            );
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

// --- Text ---

/**
 * Estimate token count for a text string
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
export function estimateTokens(text) {
    return Math.ceil((text || '').length / 3.5);
}

/**
 * Slice memories array to fit within a token budget
 * @param {Object[]} memories - Array of memory objects with summary field
 * @param {number} tokenBudget - Maximum tokens to include
 * @returns {Object[]} Sliced memories array that fits within budget
 */
export function sliceToTokenBudget(memories, tokenBudget) {
    if (!memories || memories.length === 0) return [];
    if (!tokenBudget || tokenBudget <= 0) return [];

    const result = [];
    let totalTokens = 0;

    for (const memory of memories) {
        const memoryTokens = estimateTokens(memory.summary);
        if (totalTokens + memoryTokens > tokenBudget) {
            break;
        }
        result.push(memory);
        totalTokens += memoryTokens;
    }

    return result;
}

/**
 * Strip thinking/reasoning tags from LLM response
 * @param {string} text - Raw LLM response text
 * @returns {string} Text with thinking tags removed
 */
export function stripThinkingTags(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .replace(/<reflection>[\s\S]*?<\/reflection>/gi, '')
        .replace(/\[THINK\][\s\S]*?\[\/THINK\]/gi, '')
        .replace(/\[THOUGHT\][\s\S]*?\[\/THOUGHT\]/gi, '')
        .replace(/\[REASONING\][\s\S]*?\[\/REASONING\]/gi, '')
        .replace(/\*thinks?:[\s\S]*?\*/gi, '')
        .replace(/\(thinking:[\s\S]*?\)/gi, '')
        .trim();
}

/**
 * Safely parse JSON, handling markdown code blocks and malformed JSON
 * @param {string} input - Raw JSON string potentially wrapped in markdown
 * @returns {any} Parsed JSON object/array, or null on failure
 */
export function safeParseJSON(input) {
    try {
        let cleanedInput = stripThinkingTags(input);

        const jsonMatch = cleanedInput.match(/\[[\s\S]*?\]|\{[\s\S]*?\}/);
        if (jsonMatch) {
            cleanedInput = jsonMatch[0];
        }

        const repaired = jsonrepair(cleanedInput);
        const parsed = JSON.parse(repaired);
        if (parsed === null || typeof parsed !== 'object') {
            getDeps().console.error('[OpenVault] JSON Parse returned non-object/array:', typeof parsed);
            getDeps().console.error('[OpenVault] Raw LLM response:', input);
            return null;
        }
        return parsed;
    } catch (e) {
        getDeps().console.error('[OpenVault] JSON Parse failed', e);
        getDeps().console.error('[OpenVault] Raw LLM response:', input);
        return null;
    }
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

// Re-export scheduler functions for backwards compatibility
export { getExtractedMessageIds, getUnextractedMessageIds } from './extraction/scheduler.js';

// =============================================================================
// Data Actions (from src/data/actions.js)
// =============================================================================

import { MEMORIES_KEY, METADATA_KEY } from './constants.js';

/**
 * Update a memory by ID
 * @param {string} id - Memory ID to update
 * @param {Object} updates - Fields to update (summary, importance, tags, is_secret)
 * @returns {Promise<boolean>} True if updated, false otherwise
 */
export async function updateMemory(id, updates) {
    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat loaded');
        return false;
    }

    const memory = data[MEMORIES_KEY]?.find((m) => m.id === id);
    if (!memory) {
        log(`Memory ${id} not found`);
        return false;
    }

    // Track if summary changed (requires re-embedding)
    const summaryChanged = updates.summary !== undefined && updates.summary !== memory.summary;

    // Apply allowed updates
    const allowedFields = ['summary', 'importance', 'tags', 'is_secret'];
    for (const field of allowedFields) {
        if (updates[field] !== undefined) {
            memory[field] = updates[field];
        }
    }

    // If summary changed, invalidate embedding so it can be regenerated
    if (summaryChanged) {
        delete memory.embedding;
    }

    await getDeps().saveChatConditional();
    log(`Updated memory ${id}${summaryChanged ? ' (embedding invalidated)' : ''}`);
    return true;
}

/**
 * Delete a memory by ID
 * @param {string} id - Memory ID to delete
 * @returns {Promise<boolean>} True if deleted, false otherwise
 */
export async function deleteMemory(id) {
    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat loaded');
        return false;
    }

    const idx = data[MEMORIES_KEY]?.findIndex((m) => m.id === id);
    if (idx === -1) {
        log(`Memory ${id} not found`);
        return false;
    }

    data[MEMORIES_KEY].splice(idx, 1);
    await getDeps().saveChatConditional();
    log(`Deleted memory ${id}`);
    return true;
}

/**
 * Delete all OpenVault data for the current chat
 * @returns {Promise<boolean>} True if deleted, false otherwise
 */
export async function deleteCurrentChatData() {
    const context = getDeps().getContext();

    if (!context.chatMetadata) {
        log('No chat metadata found');
        return false;
    }

    delete context.chatMetadata[METADATA_KEY];
    await getDeps().saveChatConditional();
    log('Deleted all chat data');
    return true;
}

/**
 * Delete embeddings from current chat's memories
 * @returns {Promise<number>} Number of embeddings deleted
 */
export async function deleteCurrentChatEmbeddings() {
    const data = getOpenVaultData();
    if (!data || !data[MEMORIES_KEY]) {
        return 0;
    }

    let count = 0;
    for (const memory of data[MEMORIES_KEY]) {
        if (memory.embedding) {
            delete memory.embedding;
            count++;
        }
    }

    if (count > 0) {
        await getDeps().saveChatConditional();
        log(`Deleted ${count} embeddings`);
    }

    return count;
}
