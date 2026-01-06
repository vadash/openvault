/**
 * OpenVault Settings Panel UI
 *
 * Handles loading settings, binding UI elements, and updating the interface.
 */

import { saveSettingsDebounced } from '../../../../../../script.js';
import { extension_settings } from '../../../../../extensions.js';
import { extensionName, extensionFolderPath, defaultSettings } from '../constants.js';
import { refreshAllUI, prevPage, nextPage, resetAndRender } from './browser.js';
import { validateRPM } from './calculations.js';
import { setEmbeddingStatusCallback, getEmbeddingStatus } from '../embeddings.js';

// References to external functions (set during init)
let updateEventListenersFn = null;
let extractAllMessagesFn = null;
let deleteCurrentChatDataFn = null;
let deleteAllDataFn = null;
let backfillEmbeddingsFn = null;

/**
 * Set external function references
 * @param {Object} fns - Object containing function references
 */
export function setExternalFunctions(fns) {
    updateEventListenersFn = fns.updateEventListeners;
    extractAllMessagesFn = fns.extractAllMessages;
    deleteCurrentChatDataFn = fns.deleteCurrentChatData;
    deleteAllDataFn = fns.deleteAllData;
    backfillEmbeddingsFn = fns.backfillEmbeddings;
}

/**
 * Convert tokens to approximate word count
 * @param {number} tokens - Token count
 * @returns {number} Approximate word count
 */
function tokensToWords(tokens) {
    return Math.round(tokens * 0.75);
}

/**
 * Update word count display for a token slider
 * @param {number} tokens - Token value
 * @param {string} wordsElementId - ID of the words span element
 */
function updateWordsDisplay(tokens, wordsElementId) {
    $(`#${wordsElementId}`).text(tokensToWords(tokens));
}

/**
 * Load extension settings
 */
export async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};

    // Apply defaults for any missing settings
    Object.assign(extension_settings[extensionName], {
        ...defaultSettings,
        ...extension_settings[extensionName],
    });

    // Load HTML template
    const settingsHtml = await $.get(`${extensionFolderPath}/templates/settings_panel.html`);
    $('#extensions_settings2').append(settingsHtml);

    // Inject version from manifest.json
    try {
        const manifest = await $.getJSON(`${extensionFolderPath}/manifest.json`);
        $('#openvault_version').text(manifest.version);
    } catch {
        $('#openvault_version').text('?');
    }

    // Bind UI elements
    bindUIElements();

    // Update UI to match current settings
    updateUI();

    console.log('[OpenVault] Settings loaded');
}

/**
 * Bind UI elements to settings
 */
function bindUIElements() {
    const settings = extension_settings[extensionName];

    // Enabled toggle
    $('#openvault_enabled').on('change', function() {
        settings.enabled = $(this).is(':checked');
        saveSettingsDebounced();
        if (updateEventListenersFn) updateEventListenersFn();
    });

    // Debug mode toggle
    $('#openvault_debug').on('change', function() {
        settings.debugMode = $(this).is(':checked');
        saveSettingsDebounced();
    });

    // Messages per extraction slider
    $('#openvault_messages_per_extraction').on('input', function() {
        settings.messagesPerExtraction = parseInt($(this).val());
        $('#openvault_messages_per_extraction_value').text(settings.messagesPerExtraction);
        saveSettingsDebounced();
    });

    // Extraction rearview tokens slider
    $('#openvault_extraction_rearview').on('input', function() {
        settings.extractionRearviewTokens = parseInt($(this).val());
        $('#openvault_extraction_rearview_value').text(settings.extractionRearviewTokens);
        updateWordsDisplay(settings.extractionRearviewTokens, 'openvault_extraction_rearview_words');
        saveSettingsDebounced();
    });

    // Pre-filter budget slider
    $('#openvault_prefilter_budget').on('input', function() {
        settings.retrievalPreFilterTokens = parseInt($(this).val());
        $('#openvault_prefilter_budget_value').text(settings.retrievalPreFilterTokens);
        updateWordsDisplay(settings.retrievalPreFilterTokens, 'openvault_prefilter_budget_words');
        saveSettingsDebounced();
    });

    // Smart retrieval toggle
    $('#openvault_smart_retrieval').on('change', function() {
        settings.smartRetrievalEnabled = $(this).is(':checked');
        // Toggle retrieval profile visibility
        $('#openvault_retrieval_profile_group').toggle(settings.smartRetrievalEnabled);
        saveSettingsDebounced();
    });

    // Final budget slider
    $('#openvault_final_budget').on('input', function() {
        settings.retrievalFinalTokens = parseInt($(this).val());
        $('#openvault_final_budget_value').text(settings.retrievalFinalTokens);
        updateWordsDisplay(settings.retrievalFinalTokens, 'openvault_final_budget_words');
        saveSettingsDebounced();
    });

    // Auto-hide toggle
    $('#openvault_auto_hide').on('change', function() {
        settings.autoHideEnabled = $(this).is(':checked');
        saveSettingsDebounced();
    });

    // Auto-hide threshold slider
    $('#openvault_auto_hide_threshold').on('input', function() {
        settings.autoHideThreshold = parseInt($(this).val());
        $('#openvault_auto_hide_threshold_value').text(settings.autoHideThreshold);
        saveSettingsDebounced();
    });

    // Backfill rate limit input
    $('#openvault_backfill_rpm').on('change', function() {
        settings.backfillMaxRPM = validateRPM($(this).val(), 30);
        $(this).val(settings.backfillMaxRPM);
        saveSettingsDebounced();
    });

    // Ollama URL input
    $('#openvault_ollama_url').on('change', function() {
        settings.ollamaUrl = $(this).val().trim();
        saveSettingsDebounced();
    });

    // Embedding model input
    $('#openvault_embedding_model').on('change', function() {
        settings.embeddingModel = $(this).val().trim();
        saveSettingsDebounced();
    });

    // Embedding source dropdown
    $('#openvault_embedding_source').on('change', function() {
        settings.embeddingSource = $(this).val();
        $('#openvault_ollama_settings').toggle(settings.embeddingSource === 'ollama');
        $('#openvault_embedding_status').text(getEmbeddingStatus());
        saveSettingsDebounced();
    });

    // Backfill embeddings button
    $('#openvault_backfill_embeddings_btn').on('click', () => {
        if (backfillEmbeddingsFn) backfillEmbeddingsFn();
    });

    // Backfill history button
    $('#openvault_extract_all_btn').on('click', () => {
        if (extractAllMessagesFn) extractAllMessagesFn();
    });

    // Refresh stats button
    $('#openvault_refresh_stats_btn').on('click', () => refreshAllUI());

    // Danger zone buttons
    $('#openvault_delete_chat_btn').on('click', () => {
        if (deleteCurrentChatDataFn) deleteCurrentChatDataFn();
    });
    $('#openvault_delete_all_btn').on('click', () => {
        if (deleteAllDataFn) deleteAllDataFn();
    });

    // Profile selectors
    $('#openvault_extraction_profile').on('change', function() {
        settings.extractionProfile = $(this).val();
        saveSettingsDebounced();
    });

    $('#openvault_retrieval_profile').on('change', function() {
        settings.retrievalProfile = $(this).val();
        saveSettingsDebounced();
    });

    // Memory browser pagination
    $('#openvault_prev_page').on('click', () => prevPage());
    $('#openvault_next_page').on('click', () => nextPage());

    // Memory browser filters
    $('#openvault_filter_type').on('change', () => resetAndRender());
    $('#openvault_filter_character').on('change', () => resetAndRender());

    // Embedding status callback
    setEmbeddingStatusCallback((status) => {
        $('#openvault_embedding_status').text(status);
    });
}

/**
 * Update UI to match current settings
 */
export function updateUI() {
    const settings = extension_settings[extensionName];

    $('#openvault_enabled').prop('checked', settings.enabled);
    $('#openvault_debug').prop('checked', settings.debugMode);

    // Extraction settings
    $('#openvault_messages_per_extraction').val(settings.messagesPerExtraction);
    $('#openvault_messages_per_extraction_value').text(settings.messagesPerExtraction);

    $('#openvault_extraction_rearview').val(settings.extractionRearviewTokens);
    $('#openvault_extraction_rearview_value').text(settings.extractionRearviewTokens);
    updateWordsDisplay(settings.extractionRearviewTokens, 'openvault_extraction_rearview_words');

    // Retrieval pipeline settings
    $('#openvault_prefilter_budget').val(settings.retrievalPreFilterTokens);
    $('#openvault_prefilter_budget_value').text(settings.retrievalPreFilterTokens);
    updateWordsDisplay(settings.retrievalPreFilterTokens, 'openvault_prefilter_budget_words');

    $('#openvault_smart_retrieval').prop('checked', settings.smartRetrievalEnabled);
    $('#openvault_retrieval_profile_group').toggle(settings.smartRetrievalEnabled);

    $('#openvault_final_budget').val(settings.retrievalFinalTokens);
    $('#openvault_final_budget_value').text(settings.retrievalFinalTokens);
    updateWordsDisplay(settings.retrievalFinalTokens, 'openvault_final_budget_words');

    // Auto-hide settings
    $('#openvault_auto_hide').prop('checked', settings.autoHideEnabled);
    $('#openvault_auto_hide_threshold').val(settings.autoHideThreshold);
    $('#openvault_auto_hide_threshold_value').text(settings.autoHideThreshold);

    // Backfill settings
    $('#openvault_backfill_rpm').val(settings.backfillMaxRPM);

    // Embedding settings
    $('#openvault_embedding_source').val(settings.embeddingSource || 'multilingual-e5-small');
    $('#openvault_ollama_settings').toggle(settings.embeddingSource === 'ollama');
    $('#openvault_ollama_url').val(settings.ollamaUrl || '');
    $('#openvault_embedding_model').val(settings.embeddingModel || '');
    $('#openvault_embedding_status').text(getEmbeddingStatus());

    // Populate profile selector
    populateProfileSelector();

    // Refresh all UI components
    refreshAllUI();
}

/**
 * Populate a profile selector dropdown
 * @param {jQuery} $selector - jQuery selector element
 * @param {Object[]} profiles - Available profiles
 * @param {string} currentValue - Currently selected profile ID
 */
function populateProfileDropdown($selector, profiles, currentValue) {
    $selector.empty();
    $selector.append('<option value="">Use current connection</option>');
    for (const profile of profiles) {
        const selected = profile.id === currentValue ? 'selected' : '';
        $selector.append(`<option value="${profile.id}" ${selected}>${profile.name}</option>`);
    }
}

/**
 * Populate the connection profile selectors (extraction and retrieval)
 */
export function populateProfileSelector() {
    const settings = extension_settings[extensionName];
    const profiles = extension_settings.connectionManager?.profiles || [];

    populateProfileDropdown($('#openvault_extraction_profile'), profiles, settings.extractionProfile);
    populateProfileDropdown($('#openvault_retrieval_profile'), profiles, settings.retrievalProfile);
}
