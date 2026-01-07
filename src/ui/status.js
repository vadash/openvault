/**
 * OpenVault Status & Stats UI
 *
 * Handles status indicator and statistics display.
 */

import { getDeps } from '../deps.js';
import { getOpenVaultData, log } from '../utils.js';
import { getExtractedMessageIds } from '../extraction/scheduler.js';
import { MEMORIES_KEY, CHARACTERS_KEY, extensionName } from '../constants.js';
import { getStatusText } from './formatting.js';
import { calculateExtractionStats, getBatchProgressInfo } from './calculations.js';

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
        $('#openvault_stat_events_badge').text('0 events');
        $('#openvault_stat_embeddings_badge').text('0 embeddings');
        $('#openvault_stat_characters_badge').text('0 chars');
        $('#openvault_batch_progress_fill').css('width', '0%');
        $('#openvault_batch_progress_label').text('No chat');
        return;
    }

    const memories = data[MEMORIES_KEY] || [];
    const eventCount = memories.length;
    const embeddingCount = memories.filter(m => m.embedding?.length > 0).length;
    const charCount = Object.keys(data[CHARACTERS_KEY] || {}).length;

    $('#openvault_stat_events_badge').text(`${eventCount} events`);
    $('#openvault_stat_embeddings_badge').text(`${embeddingCount} embeddings`);
    $('#openvault_stat_characters_badge').text(`${charCount} chars`);

    // Calculate batch progress
    const settings = getDeps().getExtensionSettings()[extensionName];
    const messageCount = settings?.messagesPerExtraction || 10;

    const context = getDeps().getContext();
    const chat = context.chat || [];
    const extractedMessageIds = getExtractedMessageIds(data);

    const stats = calculateExtractionStats(chat, extractedMessageIds, messageCount);
    const progressInfo = getBatchProgressInfo(stats);

    // Update batch progress bar
    $('#openvault_batch_progress_fill').css('width', `${progressInfo.percentage}%`);
    $('#openvault_batch_progress_label').text(progressInfo.label);

    log(`Stats: ${eventCount} memories, ${embeddingCount} embeddings, ${charCount} characters`);
}
