/**
 * OpenVault Extraction Pipeline - Stage 1: Message Selection
 *
 * Handles message selection for extraction:
 * - Incremental mode: last N unprocessed messages
 * - Targeted mode: specific message IDs (backfill)
 * - Generates unique batch ID
 */

import { getDeps } from '../../deps.js';
import { MEMORIES_KEY, LAST_PROCESSED_KEY, PROCESSED_MESSAGES_KEY } from '../../constants.js';
import { getOpenVaultData } from '../../utils.js';

/**
 * Select messages to extract from the chat
 * @param {Array} chat - The full chat array from context
 * @param {Object} data - OpenVault data object
 * @param {Object} settings - Extension settings
 * @param {number[]} [messageIds=null] - Optional specific message IDs for targeted extraction
 * @returns {{messages: Array[], batchId: string} | {status: 'skipped', reason: string}}
 */
export function selectMessagesToExtract(chat, data, settings, messageIds = null) {
    if (!chat || chat.length === 0) {
        return { status: 'skipped', reason: 'no_messages' };
    }

    let messagesToExtract = [];

    if (messageIds && messageIds.length > 0) {
        // Targeted mode: When specific IDs are provided (e.g., backfill), include hidden messages
        messagesToExtract = messageIds
            .map(id => ({ id, ...chat[id] }))
            .filter(m => m != null);
    } else {
        // Incremental mode: Extract last few unprocessed messages
        const lastProcessedId = data[LAST_PROCESSED_KEY] || -1;
        const messageCount = settings.messagesPerExtraction || 5;

        messagesToExtract = chat
            .map((m, idx) => ({ id: idx, ...m }))
            .filter(m => !m.is_system && m.id > lastProcessedId)
            .slice(-messageCount);
    }

    if (messagesToExtract.length === 0) {
        return { status: 'skipped', reason: 'no_new_messages' };
    }

    // Generate a unique batch ID for this extraction run
    const batchId = `batch_${getDeps().Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return { messages: messagesToExtract, batchId };
}
