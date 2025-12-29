/**
 * OpenVault Backfill
 *
 * Handles automatic backfill detection and triggering.
 */

import { getContext, extension_settings } from '../../../../extensions.js';
import { getOpenVaultData, showToast, log, getExtractedMessageIds } from './utils.js';
import { extensionName } from './constants.js';
import { extractAllMessages } from './extraction/batch.js';

/**
 * Check and trigger automatic backfill if there are enough unprocessed messages
 * Uses same logic as manual "Backfill Chat History" button
 * @param {function} updateEventListenersFn - Function to update event listeners after backfill
 */
export async function checkAndTriggerBackfill(updateEventListenersFn) {
    const settings = extension_settings[extensionName];
    if (!settings.enabled || !settings.automaticMode) return;

    const context = getContext();
    const chat = context.chat || [];
    if (chat.length === 0) return;

    const data = getOpenVaultData();
    if (!data) return;

    const messageCount = settings.messagesPerExtraction || 10;

    // Get already extracted message IDs
    const extractedMessageIds = getExtractedMessageIds(data);

    // Get unextracted message IDs
    const unextractedIds = [];
    for (let i = 0; i < chat.length; i++) {
        if (!extractedMessageIds.has(i)) {
            unextractedIds.push(i);
        }
    }

    // Exclude last N messages (buffer for automatic extraction)
    const messagesToBackfill = unextractedIds.slice(0, -messageCount);

    // Only trigger if we have at least one complete batch
    const completeBatches = Math.floor(messagesToBackfill.length / messageCount);

    if (completeBatches >= 1) {
        log(`Auto-backfill: ${messagesToBackfill.length} messages ready (${completeBatches} batches)`);
        showToast('info', `Auto-backfill: ${completeBatches} batches...`, 'OpenVault');

        try {
            await extractAllMessages(updateEventListenersFn);
        } catch (error) {
            console.error('[OpenVault] Auto-backfill error:', error);
        }
    }
}
