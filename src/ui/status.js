/**
 * OpenVault Status & Stats UI
 *
 * Handles status indicator and statistics display.
 */

import { getContext, extension_settings } from '../../../../../extensions.js';
import { getOpenVaultData, log } from '../utils.js';
import { MEMORIES_KEY, CHARACTERS_KEY, RELATIONSHIPS_KEY, EXTRACTED_BATCHES_KEY, extensionName } from '../constants.js';

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

    // Calculate batch processing info
    const settings = extension_settings[extensionName];
    const messageCount = settings?.messagesPerExtraction || 10;

    const context = getContext();
    const chat = context.chat || [];
    const nonSystemMessages = chat.filter(m => !m.is_system);
    const totalMessages = nonSystemMessages.length;

    // Calculate batches
    const totalCompleteBatches = Math.floor(totalMessages / messageCount);
    const extractedBatches = data[EXTRACTED_BATCHES_KEY] || [];
    const processedBatchCount = extractedBatches.length;

    // Buffer is 2 batches (kept for automatic mode)
    const bufferBatches = 2;
    const availableForBackfill = Math.max(0, totalCompleteBatches - bufferBatches);
    const unprocessedBatches = Math.max(0, availableForBackfill - processedBatchCount);

    // Update UI
    $('#openvault_batch_messages').text(`${totalMessages} (${messageCount}/batch)`);
    $('#openvault_batch_processed').text(`${processedBatchCount}/${availableForBackfill} extracted`);

    // Status message
    let statusText;
    if (totalCompleteBatches < bufferBatches) {
        statusText = `Need ${bufferBatches * messageCount - totalMessages} more msgs`;
    } else if (unprocessedBatches > 0) {
        statusText = `${unprocessedBatches} batch${unprocessedBatches > 1 ? 'es' : ''} pending`;
    } else {
        statusText = 'Up to date';
    }
    $('#openvault_batch_status').text(statusText);

    log(`Stats: ${data[MEMORIES_KEY]?.length || 0} memories, ${Object.keys(data[CHARACTERS_KEY] || {}).length} characters`);
}
