/**
 * OpenVault Settings Panel UI
 *
 * Handles loading settings, binding UI elements, and updating the interface.
 */

import { saveSettingsDebounced } from '../../../../../../script.js';
import { extension_settings } from '../../../../../extensions.js';
import { extensionName, extensionFolderPath, defaultSettings } from '../constants.js';
import { refreshAllUI, renderMemoryBrowser, prevPage, nextPage, resetAndRender } from './browser.js';

// References to external functions (set during init)
let updateEventListenersFn = null;
let extractMemoriesFn = null;
let retrieveAndInjectContextFn = null;
let extractAllMessagesFn = null;
let deleteCurrentChatDataFn = null;
let deleteAllDataFn = null;

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
        $('#openvault_memory_context_count_value').text(settings.memoryContextCount < 0 ? 'All' : settings.memoryContextCount);
        saveSettingsDebounced();
    });

    // Smart retrieval toggle
    $('#openvault_smart_retrieval').on('change', function() {
        settings.smartRetrievalEnabled = $(this).is(':checked');
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
        const value = parseInt($(this).val()) || 30;
        settings.backfillMaxRPM = Math.max(1, Math.min(600, value));
        $(this).val(settings.backfillMaxRPM);
        saveSettingsDebounced();
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
    $('#openvault_memory_context_count_value').text(settings.memoryContextCount < 0 ? 'All' : settings.memoryContextCount);
    $('#openvault_smart_retrieval').prop('checked', settings.smartRetrievalEnabled);

    // Auto-hide settings
    $('#openvault_auto_hide').prop('checked', settings.autoHideEnabled);
    $('#openvault_auto_hide_threshold').val(settings.autoHideThreshold);
    $('#openvault_auto_hide_threshold_value').text(settings.autoHideThreshold);

    // Backfill settings
    $('#openvault_backfill_rpm').val(settings.backfillMaxRPM);

    // Populate profile selector
    populateProfileSelector();

    // Refresh all UI components
    refreshAllUI();
}

/**
 * Populate the connection profile selectors (extraction and retrieval)
 */
export function populateProfileSelector() {
    const settings = extension_settings[extensionName];
    const profiles = extension_settings.connectionManager?.profiles || [];

    // Populate extraction profile selector
    const $extractionSelector = $('#openvault_extraction_profile');
    $extractionSelector.empty();
    $extractionSelector.append('<option value="">Use current connection</option>');

    for (const profile of profiles) {
        const selected = profile.id === settings.extractionProfile ? 'selected' : '';
        $extractionSelector.append(`<option value="${profile.id}" ${selected}>${profile.name}</option>`);
    }

    // Populate retrieval profile selector
    const $retrievalSelector = $('#openvault_retrieval_profile');
    $retrievalSelector.empty();
    $retrievalSelector.append('<option value="">Use current connection</option>');

    for (const profile of profiles) {
        const selected = profile.id === settings.retrievalProfile ? 'selected' : '';
        $retrievalSelector.append(`<option value="${profile.id}" ${selected}>${profile.name}</option>`);
    }
}
