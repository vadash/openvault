import { CHARACTERS_KEY, MEMORIES_KEY, METADATA_KEY } from '../constants.js';
import { getDeps } from '../deps.js';
import { record } from '../perf/store.js';
import { purgeSTCollection } from '../services/st-vector.js';
import { showToast } from '../utils/dom.js';
import { deleteEmbedding } from '../utils/embedding-codec.js';
import { logDebug, logError, logInfo, logWarn } from '../utils/logging.js';

/**
 * Get OpenVault data from chat metadata
 * @returns {Object|null} Returns null if context is not available
 */
export function getOpenVaultData() {
    const context = getDeps().getContext();
    if (!context) {
        logWarn('getContext() returned null/undefined');
        return null;
    }
    if (!context.chatMetadata) {
        context.chatMetadata = {};
    }
    if (!context.chatMetadata[METADATA_KEY]) {
        context.chatMetadata[METADATA_KEY] = {
            [MEMORIES_KEY]: [],
            [CHARACTERS_KEY]: {},
        };
    }
    const data = context.chatMetadata[METADATA_KEY];

    return data;
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
    const t0 = performance.now();
    if (expectedChatId !== null) {
        const currentId = getCurrentChatId();
        if (currentId !== expectedChatId) {
            logWarn(
                `Chat changed during operation (expected: ${expectedChatId}, current: ${currentId}), aborting save`
            );
            return false;
        }
    }

    try {
        await getDeps().saveChatConditional();
        record('chat_save', performance.now() - t0);
        logDebug('Data saved to chat metadata');
        return true;
    } catch (error) {
        record('chat_save', performance.now() - t0);
        logError('Failed to save data', error);
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
        logDebug(`Memory ${id} not found`);
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
        deleteEmbedding(memory);
    }

    await getDeps().saveChatConditional();
    logDebug(`Updated memory ${id}${summaryChanged ? ' (embedding invalidated)' : ''}`);
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
        logDebug(`Memory ${id} not found`);
        return false;
    }

    data[MEMORIES_KEY].splice(idx, 1);
    await getDeps().saveChatConditional();
    logDebug(`Deleted memory ${id}`);
    return true;
}

/**
 * Delete all OpenVault data for the current chat
 * @returns {Promise<boolean>} True if deleted, false otherwise
 */
export async function deleteCurrentChatData() {
    const context = getDeps().getContext();

    if (!context.chatMetadata) {
        logDebug('No chat metadata found');
        return false;
    }

    // Unhide all messages that were hidden by auto-hide
    // is_system flags persist even when memories are cleared, which would
    // leave those messages permanently unextractable
    const chat = context.chat || [];
    let unhiddenCount = 0;
    for (const msg of chat) {
        if (msg.is_system) {
            msg.is_system = false;
            unhiddenCount++;
        }
    }
    if (unhiddenCount > 0) {
        logDebug(`Unhid ${unhiddenCount} messages after memory clear`);
    }

    // Purge ST Vector Storage if using st_vector
    const settings = getDeps().getExtensionSettings()?.openvault;
    if (settings?.embeddingSource === 'st_vector') {
        const chatId = getCurrentChatId();
        if (chatId) {
            try {
                const purged = await purgeSTCollection(chatId);
                if (!purged) {
                    logWarn('Failed to purge ST collection during chat data deletion', new Error('Purge failed'));
                } else {
                    logInfo(`Purged ST Vector collection for cleared chat: ${chatId}`);
                }
            } catch (err) {
                logWarn('Failed to purge ST collection during chat data deletion', err);
                // Don't fail the whole operation - OpenVault data is already cleared
            }
        }
    }

    delete context.chatMetadata[METADATA_KEY];
    await getDeps().saveChatConditional();
    logDebug('Deleted all chat data');
    return true;
}
