/**
 * OpenVault Settings Panel UI
 *
 * Handles loading settings, binding UI elements, and updating the interface.
 */

import { getDeps } from '../deps.js';
import { extensionName, extensionFolderPath, defaultSettings, QUERY_CONTEXT_DEFAULTS, UI_DEFAULT_HINTS } from '../constants.js';
import { refreshAllUI, prevPage, nextPage, resetAndRender, initBrowser } from './browser.js';
import { validateRPM } from './calculations.js';
import { setEmbeddingStatusCallback, getEmbeddingStatus } from '../embeddings.js';
import { updateEmbeddingStatusDisplay } from './status.js';
import { bindCheckbox, bindSlider, bindTextInput, bindNumberInput, bindSelect, bindButton, updateWordsDisplay } from './base/bindings.js';
import { testOllamaConnection, copyMemoryWeights } from './debug.js';
import { updateEventListeners } from '../listeners.js';
import { handleExtractAll, handleDeleteChatData, handleDeleteEmbeddings, backfillEmbeddings } from './actions.js';

/**
 * Populate default hint text from constants
 * Finds all elements with class 'openvault-default-hint' and data-default-key,
 * then sets their text content to "(default: X)" using values from UI_DEFAULT_HINTS.
 */
function populateDefaultHints() {
    $('.openvault-default-hint').each(function() {
        const key = $(this).data('default-key');
        const value = UI_DEFAULT_HINTS[key];

        if (value !== undefined) {
            $(this).text(` (default: ${value})`);
        } else {
            console.warn(`[OpenVault] Unknown default hint key: ${key}`);
        }
    });
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

    // Populate default hints from constants
    populateDefaultHints();

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

        // Refresh stats when switching tabs
        refreshAllUI();
    });
}

/**
 * Bind UI elements to settings
 */
function bindUIElements() {
    // Basic toggles
    bindCheckbox('openvault_enabled', 'enabled', () => {
        updateEventListeners();
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

    // Scoring weights
    bindSlider('openvault_vector_weight', 'vectorSimilarityWeight', 'openvault_vector_weight_value');
    bindSlider('openvault_keyword_weight', 'keywordMatchWeight', 'openvault_keyword_weight_value', null, null, true);
    bindSlider('openvault_vector_threshold', 'vectorSimilarityThreshold', 'openvault_vector_threshold_value', null, null, true);
    bindSlider('openvault_dedup_threshold', 'dedupSimilarityThreshold', 'openvault_dedup_threshold_value', null, null, true);

    // Query context enhancement settings
    bindSlider('openvault_entity_window', 'entityWindowSize', 'openvault_entity_window_value');
    bindSlider('openvault_embedding_window', 'embeddingWindowSize', 'openvault_embedding_window_value');
    bindSlider('openvault_top_entities', 'topEntitiesCount', 'openvault_top_entities_value');
    bindSlider('openvault_entity_boost', 'entityBoostWeight', 'openvault_entity_boost_value', null, null, true);

    // Backfill settings
    bindNumberInput('openvault_backfill_rpm', 'backfillMaxRPM', (v) => validateRPM(v, 30));

    // Embedding settings
    bindTextInput('openvault_ollama_url', 'ollamaUrl', (v) => v.trim());
    bindTextInput('openvault_embedding_model', 'embeddingModel', (v) => v.trim());

    bindSelect('openvault_embedding_source', 'embeddingSource', async (value) => {
        // Reset old strategy before switching to prevent VRAM leak
        const currentSettings = getDeps().getExtensionSettings();
        const oldSource = currentSettings?.[extensionName]?.embeddingSource;

        if (oldSource && oldSource !== value) {
            const { getStrategy } = await import('../embeddings/strategies.js');
            const oldStrategy = getStrategy(oldSource);
            if (oldStrategy && typeof oldStrategy.reset === 'function') {
                await oldStrategy.reset();
            }
        }

        $('#openvault_ollama_settings').toggle(value === 'ollama');
        updateEmbeddingStatusDisplay(getEmbeddingStatus());
    });

    // Action buttons
    bindButton('openvault_backfill_embeddings_btn', backfillEmbeddings);
    bindButton('openvault_extract_all_btn', handleExtractAll);

    // Danger zone buttons
    bindButton('openvault_delete_chat_btn', handleDeleteChatData);
    bindButton('openvault_delete_embeddings_btn', handleDeleteEmbeddings);

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

    // Scoring weights
    $('#openvault_vector_weight').val(settings.vectorSimilarityWeight ?? 15);
    $('#openvault_vector_weight_value').text(settings.vectorSimilarityWeight ?? 15);

    $('#openvault_keyword_weight').val(settings.keywordMatchWeight ?? defaultSettings.keywordMatchWeight);
    $('#openvault_keyword_weight_value').text(settings.keywordMatchWeight ?? defaultSettings.keywordMatchWeight);

    $('#openvault_vector_threshold').val(settings.vectorSimilarityThreshold ?? 0.5);
    $('#openvault_vector_threshold_value').text(settings.vectorSimilarityThreshold ?? 0.5);

    $('#openvault_dedup_threshold').val(settings.dedupSimilarityThreshold ?? 0.85);
    $('#openvault_dedup_threshold_value').text(settings.dedupSimilarityThreshold ?? 0.85);

    // Query context enhancement settings
    $('#openvault_entity_window').val(settings.entityWindowSize ?? 10);
    $('#openvault_entity_window_value').text(settings.entityWindowSize ?? 10);

    $('#openvault_embedding_window').val(settings.embeddingWindowSize ?? 5);
    $('#openvault_embedding_window_value').text(settings.embeddingWindowSize ?? 5);

    $('#openvault_top_entities').val(settings.topEntitiesCount ?? 5);
    $('#openvault_top_entities_value').text(settings.topEntitiesCount ?? 5);

    $('#openvault_entity_boost').val(settings.entityBoostWeight ?? QUERY_CONTEXT_DEFAULTS.entityBoostWeight);
    $('#openvault_entity_boost_value').text(settings.entityBoostWeight ?? QUERY_CONTEXT_DEFAULTS.entityBoostWeight);

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
