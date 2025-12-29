/**
 * OpenVault Batch Extraction
 *
 * Handles backfill extraction of all messages in batches.
 */

import { getContext, extension_settings } from '../../../../../extensions.js';
import { saveChatConditional } from '../../../../../../script.js';
import { getOpenVaultData, showToast, log, getExtractedMessageIds, safeSetExtensionPrompt } from '../utils.js';
import { extensionName, EXTRACTED_BATCHES_KEY } from '../constants.js';
import { setStatus } from '../ui/status.js';
import { refreshAllUI } from '../ui/browser.js';
import { clearAllLocks } from '../state.js';
import { extractMemories } from './extract.js';

/**
 * Extract memories from all messages EXCEPT the last N in current chat
 * N is determined by the messagesPerExtraction setting
 * This backfills chat history, leaving recent messages for automatic extraction
 * @param {function} updateEventListenersFn - Function to update event listeners after backfill
 */
export async function extractAllMessages(updateEventListenersFn) {
    const context = getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) {
        showToast('warning', 'No chat messages to extract');
        return;
    }

    const settings = extension_settings[extensionName];
    const messageCount = settings.messagesPerExtraction || 5;
    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat context available');
        return;
    }

    // Get all message IDs that already have memories extracted from them
    const alreadyExtractedIds = getExtractedMessageIds(data);

    // Get all message indices (including hidden ones for import/backfill scenarios)
    const allMessageIds = chat
        .map((m, idx) => idx)
        .filter(idx => !alreadyExtractedIds.has(idx));

    if (alreadyExtractedIds.size > 0) {
        log(`Backfill: Skipping ${alreadyExtractedIds.size} already-extracted messages`);
    }

    // Exclude the last N messages (they'll be handled by regular/automatic extraction)
    let messagesToExtract = allMessageIds.slice(0, -messageCount);

    // Only extract complete batches - truncate to nearest multiple of batch size
    const completeBatches = Math.floor(messagesToExtract.length / messageCount);
    const completeMessageCount = completeBatches * messageCount;
    const remainder = messagesToExtract.length - completeMessageCount;

    if (remainder > 0) {
        log(`Truncating to ${completeBatches} complete batches (${completeMessageCount} messages), leaving ${remainder} for next batch`);
        messagesToExtract = messagesToExtract.slice(0, completeMessageCount);
    }

    if (messagesToExtract.length === 0) {
        if (alreadyExtractedIds.size > 0) {
            showToast('info', `All eligible messages already extracted (${alreadyExtractedIds.size} messages have memories)`);
        } else {
            showToast('warning', `No complete batches to extract (need ${messageCount} messages)`);
        }
        return;
    }

    // Show persistent progress toast
    setStatus('extracting');
    $(toastr?.info(
        `Backfill: 0/${completeBatches} batches (0%)`,
        'OpenVault - Extracting',
        {
            timeOut: 0,
            extendedTimeOut: 0,
            tapToDismiss: false,
            toastClass: 'toast openvault-backfill-toast'
        }
    ));

    // Process in batches
    let totalEvents = 0;

    for (let i = 0; i < completeBatches; i++) {
        const startIdx = i * messageCount;
        const batch = messagesToExtract.slice(startIdx, startIdx + messageCount);
        const batchNum = i + 1;

        // Update progress toast
        const progress = Math.round((i / completeBatches) * 100);
        $('.openvault-backfill-toast .toast-message').text(
            `Backfill: ${i}/${completeBatches} batches (${progress}%) - Processing batch ${batchNum}...`
        );

        try {
            log(`Processing batch ${batchNum}/${completeBatches} (batch index ${i})...`);
            const result = await extractMemories(batch);
            totalEvents += result?.events_created || 0;

            // Mark this batch as extracted
            if (!data[EXTRACTED_BATCHES_KEY].includes(i)) {
                data[EXTRACTED_BATCHES_KEY].push(i);
            }

            // Delay between batches based on rate limit setting
            if (batchNum < completeBatches) {
                const rpm = settings.backfillMaxRPM || 30;
                const delayMs = Math.ceil(60000 / rpm);
                log(`Rate limiting: waiting ${delayMs}ms (${rpm} RPM)`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        } catch (error) {
            console.error('[OpenVault] Batch extraction error:', error);
            $('.openvault-backfill-toast .toast-message').text(
                `Backfill: ${i}/${completeBatches} - Batch ${batchNum} failed, continuing...`
            );
        }
    }

    // Clear progress toast
    $('.openvault-backfill-toast').remove();

    // Reset operation state
    clearAllLocks();

    // Clear injection and save
    safeSetExtensionPrompt('');
    await saveChatConditional();

    // Re-register event listeners
    if (updateEventListenersFn) {
        updateEventListenersFn(true);
    }

    showToast('success', `Extracted ${totalEvents} events from ${messagesToExtract.length} messages`);
    refreshAllUI();
    setStatus('ready');
    log('Backfill complete');
}
