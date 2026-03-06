import { CHARACTERS_KEY, LAST_PROCESSED_KEY, MEMORIES_KEY, METADATA_KEY } from '../constants.js';
import { getDeps } from '../deps.js';
import { showToast } from './dom.js';
import { log } from './logging.js';

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
