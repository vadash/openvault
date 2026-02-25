/**
 * OpenVault Settings Panel UI
 *
 * Handles loading settings, binding UI elements, and updating the interface.
 * Refactored to use raw jQuery instead of bindings.js abstraction.
 * Action handlers inlined from actions.js.
 */

import {
    defaultSettings,
    embeddingModelPrefixes,
    extensionFolderPath,
    extensionName,
    MEMORIES_KEY,
    QUERY_CONTEXT_DEFAULTS,
    UI_DEFAULT_HINTS,
} from '../constants.js';
import { getDeps } from '../deps.js';
import {
    generateEmbeddingsForMemories,
    getEmbeddingStatus,
    isEmbeddingsEnabled,
    setEmbeddingStatusCallback,
} from '../embeddings.js';
import { updateEventListeners } from '../events.js';
import { validateRPM } from './helpers.js';
import { initBrowser, nextPage, prevPage, refreshAllUI, resetAndRender } from './render.js';
import { setStatus, updateEmbeddingStatusDisplay } from './status.js';

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
            headers: { 'Content-Type': 'application/json' },
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

import { extractAllMessages } from '../extraction/extract.js';
import { deleteCurrentChatData, deleteCurrentChatEmbeddings, getOpenVaultData, showToast } from '../utils.js';

// =============================================================================
// Helper Functions (inlined from bindings.js)
// =============================================================================

function tokensToWords(tokens) {
    return Math.round(tokens * 0.75);
}

function updateWordsDisplay(tokens, wordsElementId) {
    $(`#${wordsElementId}`).text(tokensToWords(tokens));
}

function getSettings() {
    return getDeps().getExtensionSettings()[extensionName];
}

function saveSetting(key, value) {
    getSettings()[key] = value;
    getDeps().saveSettingsDebounced();
}

// =============================================================================
// Action Handlers (inlined from actions.js)
// =============================================================================

async function handleExtractAll() {
    await extractAllMessages(updateEventListeners);
}

async function handleDeleteChatData() {
    if (!confirm('Are you sure you want to delete all OpenVault data for this chat?')) {
        return;
    }

    const deleted = await deleteCurrentChatData();
    if (deleted) {
        showToast('success', 'Chat memories deleted');
        refreshAllUI();
    }
}

async function handleDeleteEmbeddings() {
    if (!confirm('Are you sure you want to delete all embeddings for this chat?')) {
        return;
    }

    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat data available');
        return;
    }

    const count = await deleteCurrentChatEmbeddings();
    if (count > 0) {
        showToast('success', `Deleted ${count} embeddings`);
        refreshAllUI();
    } else {
        showToast('info', 'No embeddings to delete');
    }
}

async function backfillEmbeddings() {
    if (!isEmbeddingsEnabled()) {
        showToast('warning', 'Configure Ollama URL and embedding model first');
        return;
    }

    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat data available');
        return;
    }

    const memories = data[MEMORIES_KEY] || [];
    const needsEmbedding = memories.filter((m) => !m.embedding);

    if (needsEmbedding.length === 0) {
        showToast('info', 'All memories already have embeddings');
        return;
    }

    showToast('info', `Generating embeddings for ${needsEmbedding.length} memories...`);
    setStatus('extracting');

    try {
        const count = await generateEmbeddingsForMemories(needsEmbedding);

        if (count > 0) {
            await getDeps().saveChatConditional();
            showToast('success', `Generated ${count} embeddings`);
            console.log(`[OpenVault] Backfill complete: generated ${count} embeddings for existing memories`);
        } else {
            showToast('warning', 'No embeddings generated - check Ollama connection');
        }
    } catch (error) {
        console.error('[OpenVault] Backfill embeddings error:', error);
        showToast('error', `Embedding generation failed: ${error.message}`);
    }

    setStatus('ready');
    refreshAllUI();
}

// =============================================================================
// Populate default hint text
// =============================================================================

function populateDefaultHints() {
    $('.openvault-default-hint').each(function () {
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
// Settings Migration
// =============================================================================

function migrateSettings(settings) {
    // If alpha not set but legacy vector/keyword weights exist, compute alpha
    if (
        settings.alpha === undefined &&
        (settings.vectorSimilarityWeight !== undefined || settings.keywordMatchWeight !== undefined)
    ) {
        const vw = settings.vectorSimilarityWeight ?? 15;
        const kw = settings.keywordMatchWeight ?? 3.0;
        settings.alpha = vw / (vw + kw);
        settings.combinedBoostWeight = vw;
    }
}

// =============================================================================
// Settings Loading
// =============================================================================

export async function loadSettings() {
    const extension_settings = getDeps().getExtensionSettings();
    extension_settings[extensionName] = extension_settings[extensionName] || {};

    // Apply defaults for any missing settings
    Object.assign(extension_settings[extensionName], {
        ...defaultSettings,
        ...extension_settings[extensionName],
    });

    // Migrate legacy settings to new format
    migrateSettings(extension_settings[extensionName]);

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

// =============================================================================
// Tab Navigation
// =============================================================================

function initTabs() {
    $('.openvault-tab-btn').on('click', function () {
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

// =============================================================================
// UI Element Binding (raw jQuery)
// =============================================================================

function bindUIElements() {
    // Basic toggles
    $('#openvault_enabled').on('change', function () {
        saveSetting('enabled', $(this).is(':checked'));
        updateEventListeners();
    });

    $('#openvault_debug').on('change', function () {
        saveSetting('debugMode', $(this).is(':checked'));
    });

    // Extraction settings
    $('#openvault_messages_per_extraction').on('input', function () {
        const value = parseInt($(this).val(), 10);
        saveSetting('messagesPerExtraction', value);
        $('#openvault_messages_per_extraction_value').text(value);
    });

    $('#openvault_extraction_rearview').on('input', function () {
        const value = parseInt($(this).val(), 10);
        saveSetting('extractionRearviewTokens', value);
        $('#openvault_extraction_rearview_value').text(value);
        updateWordsDisplay(value, 'openvault_extraction_rearview_words');
    });

    // Retrieval pipeline settings
    $('#openvault_prefilter_budget').on('input', function () {
        const value = parseInt($(this).val(), 10);
        saveSetting('retrievalPreFilterTokens', value);
        $('#openvault_prefilter_budget_value').text(value);
        updateWordsDisplay(value, 'openvault_prefilter_budget_words');
    });

    $('#openvault_smart_retrieval').on('change', function () {
        saveSetting('smartRetrievalEnabled', $(this).is(':checked'));
        const settings = getSettings();
        $('#openvault_retrieval_profile_group').toggle(settings.smartRetrievalEnabled);
    });

    $('#openvault_final_budget').on('input', function () {
        const value = parseInt($(this).val(), 10);
        saveSetting('retrievalFinalTokens', value);
        $('#openvault_final_budget_value').text(value);
        updateWordsDisplay(value, 'openvault_final_budget_words');
    });

    // Auto-hide settings
    $('#openvault_auto_hide').on('change', function () {
        saveSetting('autoHideEnabled', $(this).is(':checked'));
    });

    $('#openvault_auto_hide_threshold').on('input', function () {
        const value = parseInt($(this).val(), 10);
        saveSetting('autoHideThreshold', value);
        $('#openvault_auto_hide_threshold_value').text(value);
    });

    // Scoring weights (alpha-blend)
    $('#openvault_alpha').on('input', function () {
        const value = parseFloat($(this).val());
        saveSetting('alpha', value);
        $('#openvault_alpha_value').text(value);
    });

    $('#openvault_combined_weight').on('input', function () {
        const value = parseFloat($(this).val());
        saveSetting('combinedBoostWeight', value);
        $('#openvault_combined_weight_value').text(value);
    });

    $('#openvault_vector_threshold').on('input', function () {
        const value = parseFloat($(this).val());
        saveSetting('vectorSimilarityThreshold', value);
        $('#openvault_vector_threshold_value').text(value);
    });

    $('#openvault_dedup_threshold').on('input', function () {
        const value = parseFloat($(this).val());
        saveSetting('dedupSimilarityThreshold', value);
        $('#openvault_dedup_threshold_value').text(value);
    });

    // Query context enhancement settings
    $('#openvault_entity_window').on('input', function () {
        const value = parseInt($(this).val(), 10);
        saveSetting('entityWindowSize', value);
        $('#openvault_entity_window_value').text(value);
    });

    $('#openvault_embedding_window').on('input', function () {
        const value = parseInt($(this).val(), 10);
        saveSetting('embeddingWindowSize', value);
        $('#openvault_embedding_window_value').text(value);
    });

    $('#openvault_top_entities').on('input', function () {
        const value = parseInt($(this).val(), 10);
        saveSetting('topEntitiesCount', value);
        $('#openvault_top_entities_value').text(value);
    });

    $('#openvault_entity_boost').on('input', function () {
        const value = parseFloat($(this).val());
        saveSetting('entityBoostWeight', value);
        $('#openvault_entity_boost_value').text(value);
    });

    // Backfill settings
    $('#openvault_backfill_rpm').on('change', function () {
        let value = $(this).val();
        value = validateRPM(value, 30);
        saveSetting('backfillMaxRPM', value);
        $(this).val(value);
    });

    // Embedding settings
    $('#openvault_ollama_url').on('change', function () {
        saveSetting('ollamaUrl', $(this).val().trim());
    });

    $('#openvault_embedding_model').on('change', function () {
        saveSetting('embeddingModel', $(this).val().trim());
    });

    $('#openvault_embedding_query_prefix').on('change', function () {
        saveSetting('embeddingQueryPrefix', $(this).val());
    });

    $('#openvault_embedding_doc_prefix').on('change', function () {
        saveSetting('embeddingDocPrefix', $(this).val());
    });

    $('#openvault_embedding_source').on('change', async function () {
        const value = $(this).val();

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

        // Auto-populate prefix fields from model defaults
        const prefixes = embeddingModelPrefixes[value] || embeddingModelPrefixes._default;
        const settings = getSettings();
        settings.embeddingQueryPrefix = prefixes.queryPrefix;
        settings.embeddingDocPrefix = prefixes.docPrefix;
        $('#openvault_embedding_query_prefix').val(prefixes.queryPrefix);
        $('#openvault_embedding_doc_prefix').val(prefixes.docPrefix);

        $('#openvault_ollama_settings').toggle(value === 'ollama');
        updateEmbeddingStatusDisplay(getEmbeddingStatus());
    });

    // Profile selectors
    $('#openvault_extraction_profile').on('change', function () {
        saveSetting('extractionProfile', $(this).val());
    });

    $('#openvault_retrieval_profile').on('change', function () {
        saveSetting('retrievalProfile', $(this).val());
    });

    // Action buttons
    $('#openvault_backfill_embeddings_btn').on('click', backfillEmbeddings);
    $('#openvault_extract_all_btn').on('click', handleExtractAll);

    // Danger zone buttons
    $('#openvault_delete_chat_btn').on('click', handleDeleteChatData);
    $('#openvault_delete_embeddings_btn').on('click', handleDeleteEmbeddings);

    // Memory browser pagination
    $('#openvault_prev_page').on('click', () => prevPage());
    $('#openvault_next_page').on('click', () => nextPage());

    // Memory browser filters
    $('#openvault_filter_type').on('change', function () {
        saveSetting('filter_type', $(this).val());
        resetAndRender();
    });

    $('#openvault_filter_character').on('change', function () {
        saveSetting('filter_character', $(this).val());
        resetAndRender();
    });

    // Embedding status callback
    setEmbeddingStatusCallback((status) => {
        updateEmbeddingStatusDisplay(status);
    });

    // Test Ollama connection button
    $('#openvault_test_ollama_btn').on('click', testOllamaConnection);
}

// =============================================================================
// Update UI to match current settings
// =============================================================================

export function updateUI() {
    const settings = getSettings();

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

    // Scoring weights (alpha-blend)
    $('#openvault_alpha').val(settings.alpha ?? defaultSettings.alpha);
    $('#openvault_alpha_value').text(settings.alpha ?? defaultSettings.alpha);

    $('#openvault_combined_weight').val(settings.combinedBoostWeight ?? defaultSettings.combinedBoostWeight);
    $('#openvault_combined_weight_value').text(settings.combinedBoostWeight ?? defaultSettings.combinedBoostWeight);

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
    $('#openvault_embedding_query_prefix').val(settings.embeddingQueryPrefix ?? defaultSettings.embeddingQueryPrefix);
    $('#openvault_embedding_doc_prefix').val(settings.embeddingDocPrefix ?? defaultSettings.embeddingDocPrefix);
    updateEmbeddingStatusDisplay(getEmbeddingStatus());

    // Populate profile selector
    populateProfileSelector();

    // Refresh all UI components
    refreshAllUI();
}

// =============================================================================
// Profile Dropdown
// =============================================================================

function populateProfileDropdown($selector, profiles, currentValue) {
    $selector.empty();
    $selector.append('<option value="">Use current connection</option>');
    for (const profile of profiles) {
        const selected = profile.id === currentValue ? 'selected' : '';
        $selector.append(`<option value="${profile.id}" ${selected}>${profile.name}</option>`);
    }
}

export function populateProfileSelector() {
    const extension_settings = getDeps().getExtensionSettings();
    const settings = extension_settings[extensionName];
    const profiles = extension_settings.connectionManager?.profiles || [];

    populateProfileDropdown($('#openvault_extraction_profile'), profiles, settings.extractionProfile);
    populateProfileDropdown($('#openvault_retrieval_profile'), profiles, settings.retrievalProfile);
}
