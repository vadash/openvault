/**
 * OpenVault Extraction Pipeline - Stage 5: Result Committing
 *
 * Commits extraction results to storage:
 * - Updates data with new events
 * - Updates character states
 * - Saves with chat ID verification
 */

import { MEMORIES_KEY, LAST_PROCESSED_KEY } from '../../constants.js';
import { saveOpenVaultData, log } from '../../utils.js';
import { updateCharacterStatesFromEvents } from '../parser.js';

/**
 * Commit extraction results to storage
 * @param {Array} events - Final processed events to commit
 * @param {Array} messages - Source messages (for getting max ID)
 * @param {Object} data - OpenVault data object (mutated)
 * @param {string} [targetChatId=null] - Optional chat ID for verification
 * @returns {Promise<{success: boolean, eventsCreated: number}>}
 */
export async function commitResults(events, messages, data, targetChatId = null) {
    // Track processed message IDs for max calculation
    const processedIds = messages.map(m => m.id);
    const maxId = processedIds.length > 0 ? Math.max(...processedIds) : 0;

    if (events.length > 0) {
        // Add events to storage
        data[MEMORIES_KEY] = data[MEMORIES_KEY] || [];
        data[MEMORIES_KEY].push(...events);

        // Update character states
        updateCharacterStatesFromEvents(events, data);
    }

    // Update last processed message ID
    data[LAST_PROCESSED_KEY] = Math.max(data[LAST_PROCESSED_KEY] || -1, maxId);

    // Save with chat ID verification to prevent saving to wrong chat
    const saved = await saveOpenVaultData(targetChatId);
    if (!saved && targetChatId) {
        throw new Error('Chat changed during extraction');
    }

    if (events.length > 0) {
        log(`Extracted ${events.length} events`);
    } else {
        log('No significant events found in messages');
    }

    return { success: true, eventsCreated: events.length };
}
