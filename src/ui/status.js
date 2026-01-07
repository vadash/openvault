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

// Status icon mapping
const STATUS_ICONS = {
    ready: 'fa-solid fa-check',
    extracting: 'fa-solid fa-cog fa-spin',
    retrieving: 'fa-solid fa-magnifying-glass',
    error: 'fa-solid fa-triangle-exclamation'
};

// Status subtext mapping
const STATUS_SUBTEXT = {
    ready: 'OpenVault is idle',
    extracting: 'Processing memories...',
    retrieving: 'Finding relevant memories...',
    error: 'An error occurred'
};

/**
 * Set the status indicator
 * @param {string} status - 'ready', 'extracting', 'retrieving', 'error'
 */
export function setStatus(status) {
    // Update legacy status badge
    const $indicator = $('#openvault_status');
    $indicator.removeClass('ready extracting retrieving error');
    $indicator.addClass(status);
    $indicator.text(getStatusText(status));

    // Update dashboard status card
    const $statusIndicator = $('#openvault_status_indicator');
    const $statusText = $('#openvault_status_text');
    const $statusSubtext = $('#openvault_status_subtext');

    $statusIndicator.removeClass('ready extracting retrieving error');
    $statusIndicator.addClass(status);
    $statusIndicator.html(`<i class="${STATUS_ICONS[status] || STATUS_ICONS.ready}"></i>`);

    $statusText.text(getStatusText(status));
    $statusSubtext.text(STATUS_SUBTEXT[status] || STATUS_SUBTEXT.ready);

    // Toggle working class on main container for animations
    const isWorking = status === 'extracting' || status === 'retrieving';
    $('#openvault_settings').toggleClass('working', isWorking);
}

/**
 * Update embedding status display
 * @param {string} statusText - Status text to display
 */
export function updateEmbeddingStatusDisplay(statusText) {
    const $containers = $('#openvault_embedding_status, #openvault_dashboard_embedding_status');
    const lowerStatus = statusText.toLowerCase();

    // Determine status type from text
    let statusClass = 'loading';
    let icon = 'fa-solid fa-circle-notch fa-spin';

    if (lowerStatus.includes('webgpu')) {
        statusClass = 'webgpu';
        icon = 'fa-solid fa-bolt';
    } else if (lowerStatus.includes('wasm') || lowerStatus.includes('cpu')) {
        statusClass = 'wasm';
        icon = 'fa-solid fa-microchip';
    } else if (lowerStatus.includes('ready') || lowerStatus.includes('loaded')) {
        statusClass = 'webgpu';
        icon = 'fa-solid fa-check';
    } else if (lowerStatus.includes('error') || lowerStatus.includes('failed')) {
        statusClass = 'wasm';
        icon = 'fa-solid fa-xmark';
    }

    $containers.removeClass('loading webgpu wasm');
    $containers.addClass(statusClass);
    $containers.html(`<i class="${icon}"></i> <span>${statusText}</span>`);
}

/**
 * Refresh statistics display
 */
export function refreshStats() {
    const data = getOpenVaultData();
    if (!data) {
        // Update new stat cards
        $('#openvault_stat_events').text('0');
        $('#openvault_stat_embeddings').text('0');
        $('#openvault_stat_characters').text('0');
        // Update legacy badges
        $('#openvault_stat_events_badge').text('0 events');
        $('#openvault_stat_embeddings_badge').text('0 embeddings');
        $('#openvault_stat_characters_badge').text('0 chars');
        // Update progress
        $('#openvault_batch_progress_fill').css('width', '0%');
        $('#openvault_batch_progress_label').text('No chat');
        return;
    }

    const memories = data[MEMORIES_KEY] || [];
    const eventCount = memories.length;
    const embeddingCount = memories.filter(m => m.embedding?.length > 0).length;
    const charCount = Object.keys(data[CHARACTERS_KEY] || {}).length;

    // Update new stat cards
    $('#openvault_stat_events').text(eventCount);
    $('#openvault_stat_embeddings').text(embeddingCount);
    $('#openvault_stat_characters').text(charCount);

    // Update legacy badges
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
