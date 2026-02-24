/**
 * OpenVault Data Actions
 *
 * Data manipulation layer for OpenVault.
 * This module handles all mutations to OpenVault data, keeping UI components decoupled from persistence logic.
 */

import { getDeps } from '../deps.js';
import { getOpenVaultData, showToast, log } from '../utils.js';
import { MEMORIES_KEY } from '../constants.js';

// =============================================================================
// Memory Actions
// =============================================================================

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

    const memory = data[MEMORIES_KEY]?.find(m => m.id === id);
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

    const idx = data[MEMORIES_KEY]?.findIndex(m => m.id === id);
    if (idx === -1) {
        log(`Memory ${id} not found`);
        return false;
    }

    data[MEMORIES_KEY].splice(idx, 1);
    await getDeps().saveChatConditional();
    log(`Deleted memory ${id}`);
    return true;
}

// =============================================================================
// Chat Data Actions
// =============================================================================

/**
 * Delete all OpenVault data for the current chat
 * @returns {Promise<boolean>} True if deleted, false otherwise
 */
export async function deleteCurrentChatData() {
    const { METADATA_KEY } = await import('../constants.js');
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
