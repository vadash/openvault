/**
 * OpenVault Backfill
 *
 * Handles automatic backfill detection and triggering.
 */

import { getDeps } from './deps.js';
import { getOpenVaultData, getCurrentChatId, showToast, log, isAutomaticMode } from './utils.js';
import { getBackfillStats } from './extraction/scheduler.js';
import { extensionName } from './constants.js';
import { extractAllMessages } from './extraction/batch.js';

/**
 * Check and trigger automatic backfill if there are enough unprocessed messages
 * Uses same logic as manual "Backfill Chat History" button
 * @param {function} updateEventListenersFn - Function to update event listeners after backfill
 * @param {string} targetChatId - Optional chat ID to verify we haven't switched chats
 */
export async function checkAndTriggerBackfill(updateEventListenersFn, targetChatId) {
    if (!isAutomaticMode()) return;

    // Don't backfill if chat has changed since this was queued
    if (targetChatId && getCurrentChatId() !== targetChatId) return;

    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName];
    const context = deps.getContext();
    const chat = context.chat || [];
    if (chat.length === 0) return;

    const data = getOpenVaultData();
    if (!data) return;

    const messageCount = settings.messagesPerExtraction || 10;

    // Use scheduler to check for backfill work
    const stats = getBackfillStats(chat, data, messageCount);

    if (stats.completeBatches >= 1) {
        log(`Auto-backfill: ${stats.totalUnextracted} messages ready (${stats.completeBatches} batches)`);
        showToast('info', `Auto-backfill: ${stats.completeBatches} batches...`, 'OpenVault');

        try {
            await extractAllMessages(updateEventListenersFn);
        } catch (error) {
            deps.console.error('[OpenVault] Auto-backfill error:', error);
        }
    }
}
