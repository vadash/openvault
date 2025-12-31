/**
 * OpenVault Status & Stats UI
 *
 * Handles status indicator and statistics display.
 */

import { getContext, extension_settings } from '../../../../../extensions.js';
import { getOpenVaultData, log, getExtractedMessageIds } from '../utils.js';
import { MEMORIES_KEY, CHARACTERS_KEY, RELATIONSHIPS_KEY, extensionName } from '../constants.js';
import { getStatusText, formatHiddenMessagesText } from './formatting.js';
import { calculateExtractionStats, getBackfillStatusText, getNextAutoExtractionText } from './calculations.js';

/**
 * Set the status indicator
 * @param {string} status - 'ready', 'extracting', 'retrieving', 'error'
 */
export function setStatus(status) {
    const $indicator = $('#openvault_status');
    $indicator.removeClass('ready extracting retrieving error');
    $indicator.addClass(status);
    $indicator.text(getStatusText(status));
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

    // Calculate extraction progress using pure functions
    const settings = extension_settings[extensionName];
    const messageCount = settings?.messagesPerExtraction || 10;

    const context = getContext();
    const chat = context.chat || [];
    const extractedMessageIds = getExtractedMessageIds(data);

    const stats = calculateExtractionStats(chat, extractedMessageIds, messageCount);

    // Update UI with calculated stats
    const hiddenText = formatHiddenMessagesText(stats.hiddenMessages);
    $('#openvault_batch_messages').text(`${stats.totalMessages} total${hiddenText}`);
    $('#openvault_batch_processed').text(`${stats.extractedCount} of ${stats.totalMessages}`);

    // Backfill status using pure function
    const backfillText = getBackfillStatusText(stats.totalMessages, stats.bufferSize, stats.unprocessedCount);
    $('#openvault_batch_status').text(backfillText);

    // Next automatic extraction using pure function
    const nextAutoText = getNextAutoExtractionText({
        totalMessages: stats.totalMessages,
        bufferSize: stats.bufferSize,
        bufferStart: stats.bufferStart,
        extractedCount: stats.extractedCount,
        extractedMessageIds,
        messageCount,
    });
    $('#openvault_batch_next').text(nextAutoText);

    log(`Stats: ${data[MEMORIES_KEY]?.length || 0} memories, ${Object.keys(data[CHARACTERS_KEY] || {}).length} characters`);
}
