/**
 * OpenVault Settings Panel UI
 *
 * Handles loading settings, binding UI elements, and updating the interface.
 */

import { getDeps } from '../deps.js';
import { extensionName, extensionFolderPath, defaultSettings } from '../constants.js';
import { refreshAllUI, prevPage, nextPage, resetAndRender } from './browser.js';
import { validateRPM } from './calculations.js';
import { setEmbeddingStatusCallback, getEmbeddingStatus } from '../embeddings.js';

// References to external functions (set during init)
let updateEventListenersFn = null;
let extractAllMessagesFn = null;
let deleteCurrentChatDataFn = null;
let deleteCurrentChatEmbeddingsFn = null;
let backfillEmbeddingsFn = null;

/**
 * Set external function references
 * @param {Object} fns - Object containing function references
 */
export function setExternalFunctions(fns) {
    updateEventListenersFn = fns.updateEventListeners;
    extractAllMessagesFn = fns.extractAllMessages;
    deleteCurrentChatDataFn = fns.deleteCurrentChatData;
    deleteCurrentChatEmbeddingsFn = fns.deleteCurrentChatEmbeddings;
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

// =============================================================================
// UI Binding Helpers
// =============================================================================

/**
 * Bind a checkbox to a boolean setting
 * @param {string} elementId - jQuery selector for the checkbox
 * @param {string} settingKey - Key in settings object
 * @param {Function} onChange - Optional callback after value change
 */
function bindCheckbox(elementId, settingKey, onChange) {
    $(`#${elementId}`).on('change', function() {
        getDeps().getExtensionSettings()[extensionName][settingKey] = $(this).is(':checked');
        getDeps().saveSettingsDebounced();
        if (onChange) onChange();
    });
}

/**
 * Bind a slider (range input) to a numeric setting
 * @param {string} elementId - jQuery selector for the slider
 * @param {string} settingKey - Key in settings object
 * @param {string} displayId - Element ID to show the value (optional)
 * @param {Function} onChange - Optional callback after value change
 * @param {string} wordsId - Element ID to show word count (optional)
 */
function bindSlider(elementId, settingKey, displayId, onChange, wordsId) {
    $(`#${elementId}`).on('input', function() {
        const value = parseInt($(this).val());
        getDeps().getExtensionSettings()[extensionName][settingKey] = value;
        if (displayId) {
            $(`#${displayId}`).text(value);
        }
        if (wordsId) {
            updateWordsDisplay(value, wordsId);
        }
        getDeps().saveSettingsDebounced();
        if (onChange) onChange(value);
    });
}

/**
 * Bind a text input to a string setting
 * @param {string} elementId - jQuery selector for the input
 * @param {string} settingKey - Key in settings object
 * @param {Function} transform - Optional transform function (e.g., trim)
 */
function bindTextInput(elementId, settingKey, transform = (v) => v) {
    $(`#${elementId}`).on('change', function() {
        getDeps().getExtensionSettings()[extensionName][settingKey] = transform($(this).val());
        getDeps().saveSettingsDebounced();
    });
}

/**
 * Bind a number input to a numeric setting
 * @param {string} elementId - jQuery selector for the input
 * @param {string} settingKey - Key in settings object
 * @param {Function} validator - Optional validator function that returns the validated value
 */
function bindNumberInput(elementId, settingKey, validator) {
    $(`#${elementId}`).on('change', function() {
        let value = $(this).val();
        if (validator) value = validator(value);
        getDeps().getExtensionSettings()[extensionName][settingKey] = value;
        $(this).val(value); // Update UI in case validator changed it
        getDeps().saveSettingsDebounced();
    });
}

/**
 * Bind a select dropdown to a setting
 * @param {string} elementId - jQuery selector for the select
 * @param {string} settingKey - Key in settings object
 * @param {Function} onChange - Optional callback after value change
 */
function bindSelect(elementId, settingKey, onChange) {
    $(`#${elementId}`).on('change', function() {
        getDeps().getExtensionSettings()[extensionName][settingKey] = $(this).val();
        getDeps().saveSettingsDebounced();
        if (onChange) onChange($(this).val());
    });
}

/**
 * Bind a button click handler
 * @param {string} elementId - jQuery selector for the button
 * @param {Function} handler - Click handler function
 */
function bindButton(elementId, handler) {
    $(`#${elementId}`).on('click', handler);
}

// =============================================================================
// Settings Loading
// =============================================================================

/**
 * Load extension settings
 */
export async function loadSettings() {
    const extension_settings = getDeps().getExtensionSettings();
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
    // Basic toggles
    bindCheckbox('openvault_enabled', 'enabled', () => {
        if (updateEventListenersFn) updateEventListenersFn();
    });
    bindCheckbox('openvault_debug', 'debugMode');

    // Extraction settings
    bindSlider('openvault_messages_per_extraction', 'messagesPerExtraction', 'openvault_messages_per_extraction_value');
    bindSlider('openvault_extraction_rearview', 'extractionRearviewTokens', 'openvault_extraction_rearview_value', null, 'openvault_extraction_rearview_words');

    // Retrieval pipeline settings
    bindSlider('openvault_prefilter_budget', 'retrievalPreFilterTokens', 'openvault_prefilter_budget_value', null, 'openvault_prefilter_budget_words');

    bindCheckbox('openvault_smart_retrieval', 'smartRetrievalEnabled', () => {
        const settings = getDeps().getExtensionSettings()[extensionName];
        $('#openvault_retrieval_profile_group').toggle(settings.smartRetrievalEnabled);
    });

    bindSlider('openvault_final_budget', 'retrievalFinalTokens', 'openvault_final_budget_value', null, 'openvault_final_budget_words');

    // Auto-hide settings
    bindCheckbox('openvault_auto_hide', 'autoHideEnabled');
    bindSlider('openvault_auto_hide_threshold', 'autoHideThreshold', 'openvault_auto_hide_threshold_value');

    // Backfill settings
    bindNumberInput('openvault_backfill_rpm', 'backfillMaxRPM', (v) => validateRPM(v, 30));

    // Embedding settings
    bindTextInput('openvault_ollama_url', 'ollamaUrl', (v) => v.trim());
    bindTextInput('openvault_embedding_model', 'embeddingModel', (v) => v.trim());

    bindSelect('openvault_embedding_source', 'embeddingSource', (value) => {
        $('#openvault_ollama_settings').toggle(value === 'ollama');
        $('#openvault_embedding_status').text(getEmbeddingStatus());
    });

    // Action buttons
    bindButton('openvault_backfill_embeddings_btn', () => {
        if (backfillEmbeddingsFn) backfillEmbeddingsFn();
    });
    bindButton('openvault_extract_all_btn', () => {
        if (extractAllMessagesFn) extractAllMessagesFn();
    });
    bindButton('openvault_refresh_stats_btn', () => refreshAllUI());

    // Danger zone buttons
    bindButton('openvault_delete_chat_btn', () => {
        if (deleteCurrentChatDataFn) deleteCurrentChatDataFn();
    });
    bindButton('openvault_delete_embeddings_btn', () => {
        if (deleteCurrentChatEmbeddingsFn) deleteCurrentChatEmbeddingsFn();
    });

    // Profile selectors
    bindSelect('openvault_extraction_profile', 'extractionProfile');
    bindSelect('openvault_retrieval_profile', 'retrievalProfile');

    // Memory browser pagination
    bindButton('openvault_prev_page', () => prevPage());
    bindButton('openvault_next_page', () => nextPage());

    // Memory browser filters
    bindSelect('openvault_filter_type', 'filter_type', () => resetAndRender());
    bindSelect('openvault_filter_character', 'filter_character', () => resetAndRender());

    // Embedding status callback
    setEmbeddingStatusCallback((status) => {
        $('#openvault_embedding_status').text(status);
    });
}

/**
 * Update UI to match current settings
 */
export function updateUI() {
    const settings = getDeps().getExtensionSettings()[extensionName];

    // Basic toggles
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
    const extension_settings = getDeps().getExtensionSettings();
    const settings = extension_settings[extensionName];
    const profiles = extension_settings.connectionManager?.profiles || [];

    populateProfileDropdown($('#openvault_extraction_profile'), profiles, settings.extractionProfile);
    populateProfileDropdown($('#openvault_retrieval_profile'), profiles, settings.retrievalProfile);
}
