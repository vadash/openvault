/**
 * OpenVault Status & Stats UI
 *
 * Handles status indicator and statistics display.
 */

import { getContext, extension_settings } from '../../../../../extensions.js';
import { getOpenVaultData, log } from '../utils.js';
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
    const nonSystemMessages = chat.filter(m => !m.is_system);
    const totalMessages = nonSystemMessages.length;

    // Count messages that have been extracted (by checking memory message_ids)
    const memories = data[MEMORIES_KEY] || [];
    const extractedMessageIds = new Set();
    for (const memory of memories) {
        for (const msgId of (memory.message_ids || [])) {
            extractedMessageIds.add(msgId);
        }
    }
    const extractedCount = extractedMessageIds.size;

    // Buffer zone: last N messages reserved for automatic extraction
    const bufferSize = messageCount * 2;
    const bufferStart = Math.max(0, totalMessages - bufferSize);
    const inBuffer = totalMessages - bufferStart;

    // Unprocessed: messages before buffer that haven't been extracted
    let unprocessedCount = 0;
    for (let i = 0; i < bufferStart; i++) {
        if (!extractedMessageIds.has(i)) {
            unprocessedCount++;
        }
    }

    // Update UI
    $('#openvault_batch_messages').text(`${totalMessages} total`);
    $('#openvault_batch_processed').text(`${extractedCount} extracted, ${inBuffer} in buffer`);

    // Status message
    let statusText;
    if (totalMessages < bufferSize) {
        statusText = `Need ${bufferSize - totalMessages} more msgs`;
    } else if (unprocessedCount > 0) {
        statusText = `${unprocessedCount} msgs to backfill`;
    } else {
        statusText = 'Up to date';
    }
    $('#openvault_batch_status').text(statusText);

    log(`Stats: ${data[MEMORIES_KEY]?.length || 0} memories, ${Object.keys(data[CHARACTERS_KEY] || {}).length} characters`);
}
