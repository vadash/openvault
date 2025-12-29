/**
 * OpenVault Status & Stats UI
 *
 * Handles status indicator and statistics display.
 */

import { getContext, extension_settings } from '../../../../../extensions.js';
import { getOpenVaultData, log, getExtractedMessageIds } from '../utils.js';
import { MEMORIES_KEY, CHARACTERS_KEY, RELATIONSHIPS_KEY, extensionName } from '../constants.js';

/**
 * Set the status indicator
 * @param {string} status - 'ready', 'extracting', 'retrieving', 'error'
 */
export function setStatus(status) {
    const $indicator = $('#openvault_status');
    $indicator.removeClass('ready extracting retrieving error');
    $indicator.addClass(status);

    const statusText = {
        ready: 'Ready',
        extracting: 'Extracting...',
        retrieving: 'Retrieving...',
        error: 'Error',
    };

    $indicator.text(statusText[status] || status);
}

/**
 * Refresh statistics display
 */
export function refreshStats() {
    const data = getOpenVaultData();
    if (!data) {
        $('#openvault_stat_events').text(0);
        $('#openvault_stat_characters').text(0);
        $('#openvault_stat_relationships').text(0);
        $('#openvault_batch_messages').text('--');
        $('#openvault_batch_processed').text('--');
        $('#openvault_batch_status').text('No chat');
        $('#openvault_batch_next').text('--');
        return;
    }

    $('#openvault_stat_events').text(data[MEMORIES_KEY]?.length || 0);
    $('#openvault_stat_characters').text(Object.keys(data[CHARACTERS_KEY] || {}).length);
    $('#openvault_stat_relationships').text(Object.keys(data[RELATIONSHIPS_KEY] || {}).length);

    // Calculate extraction progress based on actual message coverage
    const settings = extension_settings[extensionName];
    const messageCount = settings?.messagesPerExtraction || 10;

    const context = getContext();
    const chat = context.chat || [];
    // Count ALL messages, not just visible ones
    const totalMessages = chat.length;
    const hiddenMessages = chat.filter(m => m.is_system).length;

    // Count messages that have been extracted (by checking memory message_ids)
    const extractedMessageIds = getExtractedMessageIds(data);
    const extractedCount = extractedMessageIds.size;

    // Buffer zone: last N messages reserved for automatic extraction
    const bufferSize = messageCount * 2;
    const bufferStart = Math.max(0, totalMessages - bufferSize);

    // Unprocessed: messages before buffer that haven't been extracted
    let unprocessedCount = 0;
    for (let i = 0; i < bufferStart; i++) {
        if (!extractedMessageIds.has(i)) {
            unprocessedCount++;
        }
    }

    // Update UI
    const hiddenText = hiddenMessages > 0 ? ` (${hiddenMessages} hidden)` : '';
    $('#openvault_batch_messages').text(`${totalMessages} total${hiddenText}`);
    $('#openvault_batch_processed').text(`${extractedCount} of ${totalMessages}`);

    // Backfill status
    let backfillText;
    if (totalMessages < bufferSize) {
        backfillText = 'Waiting for more messages';
    } else if (unprocessedCount > 0) {
        backfillText = `${unprocessedCount} msgs ready`;
    } else {
        backfillText = 'Up to date';
    }
    $('#openvault_batch_status').text(backfillText);

    // Next automatic extraction info
    // Auto-extraction triggers when we have enough messages beyond the buffer
    const messagesInBuffer = Math.min(totalMessages, bufferSize);
    const messagesBeforeBuffer = totalMessages - messagesInBuffer;
    const extractedInBuffer = [...extractedMessageIds].filter(id => id >= bufferStart).length;

    let nextAutoText;
    if (totalMessages < bufferSize) {
        // Not enough messages yet
        const needed = bufferSize - totalMessages;
        nextAutoText = `Need ${needed} more msgs`;
    } else if (messagesBeforeBuffer > extractedCount) {
        // Has unextracted messages before buffer - backfill should run
        nextAutoText = 'Backfill pending';
    } else {
        // All caught up - show when next batch will extract
        const messagesUntilNextBatch = messageCount - (extractedInBuffer % messageCount || messageCount);
        if (messagesUntilNextBatch === messageCount) {
            nextAutoText = 'Ready on next AI msg';
        } else {
            nextAutoText = `In ${messagesUntilNextBatch} msgs`;
        }
    }
    $('#openvault_batch_next').text(nextAutoText);

    log(`Stats: ${data[MEMORIES_KEY]?.length || 0} memories, ${Object.keys(data[CHARACTERS_KEY] || {}).length} characters`);
}
