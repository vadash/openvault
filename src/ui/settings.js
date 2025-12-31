/**
 * OpenVault Settings Panel UI
 *
 * Handles loading settings, binding UI elements, and updating the interface.
 */

import { saveSettingsDebounced } from '../../../../../../script.js';
import { extension_settings } from '../../../../../extensions.js';
import { extensionName, extensionFolderPath, defaultSettings } from '../constants.js';
import { refreshAllUI, prevPage, nextPage, resetAndRender } from './browser.js';
import { formatMemoryContextCount } from './formatting.js';
import { validateRPM } from './calculations.js';

// References to external functions (set during init)
let updateEventListenersFn = null;
let extractMemoriesFn = null;
let retrieveAndInjectContextFn = null;
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
    extractMemoriesFn = fns.extractMemories;
    retrieveAndInjectContextFn = fns.retrieveAndInjectContext;
    extractAllMessagesFn = fns.extractAllMessages;
    deleteCurrentChatDataFn = fns.deleteCurrentChatData;
    deleteAllDataFn = fns.deleteAllData;
    backfillEmbeddingsFn = fns.backfillEmbeddings;
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

    // Automatic mode toggle
    $('#openvault_automatic').on('change', function() {
        settings.automaticMode = $(this).is(':checked');
        saveSettingsDebounced();
        if (updateEventListenersFn) updateEventListenersFn();
    });

    // Token budget slider
    $('#openvault_token_budget').on('input', function() {
        settings.tokenBudget = parseInt($(this).val());
        $('#openvault_token_budget_value').text(settings.tokenBudget);
        saveSettingsDebounced();
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

    // Memory context count slider
    $('#openvault_memory_context_count').on('input', function() {
        settings.memoryContextCount = parseInt($(this).val());
        $('#openvault_memory_context_count_value').text(formatMemoryContextCount(settings.memoryContextCount));
        saveSettingsDebounced();
    });

    // Smart retrieval toggle
    $('#openvault_smart_retrieval').on('change', function() {
        settings.smartRetrievalEnabled = $(this).is(':checked');
        saveSettingsDebounced();
    });

    // Max memories per retrieval slider
    $('#openvault_max_memories').on('input', function() {
        settings.maxMemoriesPerRetrieval = parseInt($(this).val());
        $('#openvault_max_memories_value').text(settings.maxMemoriesPerRetrieval);
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

    // Backfill embeddings button
    $('#openvault_backfill_embeddings_btn').on('click', () => {
        if (backfillEmbeddingsFn) backfillEmbeddingsFn();
    });

    // Manual action buttons
    $('#openvault_extract_btn').on('click', () => {
        if (extractMemoriesFn) extractMemoriesFn();
    });
    $('#openvault_retrieve_btn').on('click', () => {
        if (retrieveAndInjectContextFn) retrieveAndInjectContextFn();
    });
    $('#openvault_extract_all_btn').on('click', () => {
        if (extractAllMessagesFn) extractAllMessagesFn();
    });
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
}

/**
 * Update UI to match current settings
 */
export function updateUI() {
    const settings = extension_settings[extensionName];

    $('#openvault_enabled').prop('checked', settings.enabled);
    $('#openvault_automatic').prop('checked', settings.automaticMode);
    $('#openvault_token_budget').val(settings.tokenBudget);
    $('#openvault_token_budget_value').text(settings.tokenBudget);
    $('#openvault_debug').prop('checked', settings.debugMode);

    // Extraction settings
    $('#openvault_messages_per_extraction').val(settings.messagesPerExtraction);
    $('#openvault_messages_per_extraction_value').text(settings.messagesPerExtraction);
    $('#openvault_memory_context_count').val(settings.memoryContextCount);
    $('#openvault_memory_context_count_value').text(formatMemoryContextCount(settings.memoryContextCount));
    $('#openvault_smart_retrieval').prop('checked', settings.smartRetrievalEnabled);
    $('#openvault_max_memories').val(settings.maxMemoriesPerRetrieval);
    $('#openvault_max_memories_value').text(settings.maxMemoriesPerRetrieval);

    // Auto-hide settings
    $('#openvault_auto_hide').prop('checked', settings.autoHideEnabled);
    $('#openvault_auto_hide_threshold').val(settings.autoHideThreshold);
    $('#openvault_auto_hide_threshold_value').text(settings.autoHideThreshold);

    // Backfill settings
    $('#openvault_backfill_rpm').val(settings.backfillMaxRPM);

    // Embedding settings
    $('#openvault_ollama_url').val(settings.ollamaUrl || '');
    $('#openvault_embedding_model').val(settings.embeddingModel || '');

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
