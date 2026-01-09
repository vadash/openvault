/**
 * OpenVault Batch Extraction
 *
 * Handles backfill extraction of all messages in batches.
 */

import { getDeps } from '../deps.js';
import { getOpenVaultData, showToast, log, safeSetExtensionPrompt, getCurrentChatId } from '../utils.js';
import { getBackfillMessageIds, getExtractedMessageIds } from './scheduler.js';
import { extensionName } from '../constants.js';
import { setStatus } from '../ui/status.js';
import { refreshAllUI } from '../ui/browser.js';
import { clearAllLocks } from '../state.js';
import { extractMemories } from './extract.js';

/**
 * Extract memories from all unextracted messages in current chat
 * Processes in batches determined by messagesPerExtraction setting
 * @param {function} updateEventListenersFn - Function to update event listeners after backfill
 */
export async function extractAllMessages(updateEventListenersFn) {
    const context = getDeps().getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) {
        showToast('warning', 'No chat messages to extract');
        return;
    }

    const settings = getDeps().getExtensionSettings()[extensionName];
    const messageCount = settings.messagesPerExtraction || 5;
    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat context available');
        return;
    }

    // Get initial estimate for progress display
    const { messageIds: initialMessageIds, batchCount: initialBatchCount } = getBackfillMessageIds(chat, data, messageCount);
    const alreadyExtractedIds = getExtractedMessageIds(data);

    if (alreadyExtractedIds.size > 0) {
        log(`Backfill: Skipping ${alreadyExtractedIds.size} already-extracted messages`);
    }

    if (initialMessageIds.length === 0) {
        if (alreadyExtractedIds.size > 0) {
            showToast('info', `All eligible messages already extracted (${alreadyExtractedIds.size} messages have memories)`);
        } else {
            showToast('warning', `Not enough messages for a complete batch (need ${messageCount})`);
        }
        return;
    }

    // Show persistent progress toast
    setStatus('extracting');
    $(toastr?.info(
        `Backfill: 0/${initialBatchCount} batches (0%)`,
        'OpenVault - Extracting',
        {
            timeOut: 0,
            extendedTimeOut: 0,
            tapToDismiss: false,
            toastClass: 'toast openvault-backfill-toast'
        }
    ));

    // Capture chat ID to detect if user switches during backfill
    const targetChatId = getCurrentChatId();

    // Process in batches - re-fetch indices each iteration to handle chat mutations
    let totalEvents = 0;
    let batchesProcessed = 0;

    while (true) {
        // Re-fetch current state to handle chat mutations (deletions/additions)
        const freshContext = getDeps().getContext();
        const freshChat = freshContext.chat;
        const freshData = getOpenVaultData();

        if (!freshChat || !freshData) {
            log('Backfill: Lost chat context, stopping');
            break;
        }

        const { messageIds: freshIds } = getBackfillMessageIds(freshChat, freshData, messageCount);

        // No more complete batches available
        if (freshIds.length < messageCount) {
            log('Backfill: No more complete batches available');
            break;
        }

        // Take first batch from fresh list (oldest unextracted messages)
        const batch = freshIds.slice(0, messageCount);
        batchesProcessed++;

        // Update progress toast (use initial estimate for display consistency)
        const progress = Math.round((batchesProcessed / initialBatchCount) * 100);
        $('.openvault-backfill-toast .toast-message').text(
            `Backfill: ${batchesProcessed}/${initialBatchCount} batches (${Math.min(progress, 100)}%) - Processing...`
        );

        try {
            log(`Processing batch ${batchesProcessed}/${initialBatchCount}...`);
            const result = await extractMemories(batch, targetChatId);
            totalEvents += result?.events_created || 0;

            // Delay between batches based on rate limit setting
            const rpm = settings.backfillMaxRPM || 30;
            const delayMs = Math.ceil(60000 / rpm);
            log(`Rate limiting: waiting ${delayMs}ms (${rpm} RPM)`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        } catch (error) {
            // If chat changed, stop backfill entirely
            if (error.message === 'Chat changed during extraction') {
                log('Chat changed during backfill, aborting');
                $('.openvault-backfill-toast').remove();
                showToast('warning', 'Backfill aborted: chat changed', 'OpenVault');
                clearAllLocks();
                setStatus('ready');
                return;
            }
            console.error('[OpenVault] Batch extraction error:', error);
            $('.openvault-backfill-toast .toast-message').text(
                `Backfill: Batch ${batchesProcessed} failed, continuing...`
            );
        }
    }

    // Clear progress toast
    $('.openvault-backfill-toast').remove();

    // Reset operation state
    clearAllLocks();

    // Clear injection and save
    safeSetExtensionPrompt('');
    await getDeps().saveChatConditional();

    // Re-register event listeners
    if (updateEventListenersFn) {
        updateEventListenersFn(true);
    }

    showToast('success', `Extracted ${totalEvents} events from ${batchesProcessed * messageCount} messages`);
    refreshAllUI();
    setStatus('ready');
    log('Backfill complete');
}
