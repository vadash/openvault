/**
 * OpenVault Settings Panel UI
 *
 * Handles loading settings, binding UI elements, and updating the interface.
 */

import { getDeps } from '../deps.js';
import { extensionName, extensionFolderPath, defaultSettings, MEMORIES_KEY } from '../constants.js';
import { refreshAllUI, prevPage, nextPage, resetAndRender, initBrowser } from './browser.js';
import { validateRPM } from './calculations.js';
import { setEmbeddingStatusCallback, getEmbeddingStatus, getEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
import { updateEmbeddingStatusDisplay } from './status.js';
import { getOpenVaultData, showToast } from '../utils.js';
import { scoreMemories } from '../retrieval/math.js';

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

    // Initialize tab navigation
    initTabs();

    // Initialize browser event delegation (must be after HTML is loaded)
    initBrowser();

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
 * Initialize tab navigation
 */
function initTabs() {
    $('.openvault-tab-btn').on('click', function() {
        const tabId = $(this).data('tab');

        // Update tab buttons
        $('.openvault-tab-btn').removeClass('active');
        $(this).addClass('active');

        // Update tab content
        $('.openvault-tab-content').removeClass('active');
        $(`.openvault-tab-content[data-tab="${tabId}"]`).addClass('active');
    });
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
        updateEmbeddingStatusDisplay(getEmbeddingStatus());
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
        updateEmbeddingStatusDisplay(status);
    });

    // Test Ollama connection button
    bindButton('openvault_test_ollama_btn', testOllamaConnection);

    // Debug: copy memory weights button
    bindButton('openvault_copy_weights_btn', copyMemoryWeights);
}

/**
 * Test Ollama connection
 */
async function testOllamaConnection() {
    const $btn = $('#openvault_test_ollama_btn');
    const url = $('#openvault_ollama_url').val().trim();

    if (!url) {
        $btn.removeClass('success').addClass('error');
        $btn.html('<i class="fa-solid fa-xmark"></i> No URL');
        return;
    }

    $btn.removeClass('success error');
    $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Testing...');

    try {
        const response = await fetch(`${url}/api/tags`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            $btn.removeClass('error').addClass('success');
            $btn.html('<i class="fa-solid fa-check"></i> Connected');
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (err) {
        $btn.removeClass('success').addClass('error');
        $btn.html('<i class="fa-solid fa-xmark"></i> Failed');
        console.error('[OpenVault] Ollama test failed:', err);
    }

    // Reset button after 3 seconds
    setTimeout(() => {
        $btn.removeClass('success error');
        $btn.html('<i class="fa-solid fa-plug"></i> Test');
    }, 3000);
}

/**
 * Calculate and copy all memory weights to clipboard
 */
async function copyMemoryWeights() {
    const $btn = $('#openvault_copy_weights_btn');
    $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Calculating...');

    try {
        const data = getOpenVaultData();
        if (!data || !data[MEMORIES_KEY] || data[MEMORIES_KEY].length === 0) {
            showToast('warning', 'No memories to score');
            $btn.html('<i class="fa-solid fa-copy"></i> Copy Memory Weights');
            return;
        }

        const settings = getDeps().getExtensionSettings()[extensionName];
        const context = getDeps().getContext();
        const chat = context.chat || [];
        const chatLength = chat.length;
        const memories = data[MEMORIES_KEY];

        // Get embedding for user messages if enabled
        let contextEmbedding = null;
        if (isEmbeddingsEnabled()) {
            const userMessages = chat.filter(m => !m.is_system && m.is_user).slice(-3).map(m => m.mes).join('\n').slice(-1000);
            if (userMessages) {
                contextEmbedding = await getEmbedding(userMessages);
            }
        }

        // Score all memories
        const constants = {
            BASE_LAMBDA: settings.forgetfulnessBaseLambda ?? 0.05,
            IMPORTANCE_5_FLOOR: settings.forgetfulnessImportance5Floor ?? 5,
        };
        const scoringSettings = {
            vectorSimilarityThreshold: settings.vectorSimilarityThreshold,
            vectorSimilarityWeight: settings.vectorSimilarityWeight
        };

        const scored = scoreMemories(memories, contextEmbedding, chatLength, constants, scoringSettings);

        // Build score lookup map
        const scoreMap = new Map(scored.map(({ memory, score }) => [memory.id, score]));

        // Format output in chronological order (original array order)
        const output = memories.map(memory => {
            const score = scoreMap.get(memory.id) ?? 0;
            const stars = '*'.repeat(memory.importance || 3);
            return `[${score.toFixed(1)}] [${stars}] ${memory.summary}`;
        }).join('\n');

        await navigator.clipboard.writeText(output);
        showToast('success', `Copied ${scored.length} memories with weights`);
        $btn.html('<i class="fa-solid fa-check"></i> Copied!');
    } catch (err) {
        console.error('[OpenVault] Copy weights failed:', err);
        showToast('error', 'Failed to copy weights');
        $btn.html('<i class="fa-solid fa-xmark"></i> Failed');
    }

    setTimeout(() => {
        $btn.html('<i class="fa-solid fa-copy"></i> Copy Memory Weights');
    }, 2000);
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
    updateEmbeddingStatusDisplay(getEmbeddingStatus());

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
