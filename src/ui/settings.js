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
import { exportToClipboard } from './export-debug.js';
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
import { isWorkerRunning } from '../extraction/worker.js';
import { deleteCurrentChatData, deleteCurrentChatEmbeddings, getOpenVaultData } from '../utils/data.js';
import { showToast } from '../utils/dom.js';

// =============================================================================
// Helper Functions (inlined from bindings.js)
// =============================================================================

function tokensToWords(tokens) {
    return Math.round(tokens * 0.75);
}

function updateWordsDisplay(tokens, wordsElementId) {
    $(`#${wordsElementId}`).text(tokensToWords(tokens));
}

function updateReflectionDedupDisplay(rejectThreshold) {
    const replaceThreshold = (rejectThreshold - 0.1).toFixed(2);
    const rejectDisplay = rejectThreshold.toFixed(2);
    const replaceHigh = (rejectThreshold - 0.01).toFixed(2);
    const addDisplay = replaceThreshold;

    $('#openvault_reflection_reject_display').text(rejectDisplay);
    $('#openvault_reflection_replace_low').text(replaceThreshold);
    $('#openvault_reflection_replace_high').text(replaceHigh);
    $('#openvault_reflection_add_display').text(addDisplay);
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
    if (isWorkerRunning()) {
        showToast('warning', 'Background extraction in progress. Please wait.', 'OpenVault');
        return;
    }
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

async function handleResetSettings() {
    if (!confirm('Are you sure you want to reset all settings to their default values? This cannot be undone.')) {
        return;
    }

    const extension_settings = getDeps().getExtensionSettings();
    const currentSettings = extension_settings[extensionName] || {};

    // Preserve extraction profile as it's connection-specific
    const preservedProfile = currentSettings.extractionProfile || '';

    // Reset to defaults
    Object.assign(extension_settings[extensionName], defaultSettings);

    // Restore extraction profile
    extension_settings[extensionName].extractionProfile = preservedProfile;

    // Force debug mode ON after reset
    extension_settings[extensionName].debugMode = true;

    // Save
    getDeps().saveSettingsDebounced();

    // Update UI
    updateUI();

    showToast('success', 'Settings reset to default values (Debug Mode enabled)');
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
    // Helper for standard settings handlers
    function bindSetting(id, key, type = 'int', callback = null) {
        const event = type === 'bool' ? 'change' : 'input';
        $(`#openvault_${id}`).on(event, function () {
            let val;
            if (type === 'bool') val = $(this).is(':checked');
            else if (type === 'float') val = parseFloat($(this).val());
            else val = parseInt($(this).val(), 10);

            saveSetting(key, val);
            if (type !== 'bool') $(`#openvault_${id}_value`).text(val);
            if (callback) callback(val);
        });
    }

    // Basic toggles
    bindSetting('enabled', 'enabled', 'bool', () => updateEventListeners());
    bindSetting('debug', 'debugMode', 'bool');
    bindSetting('request_logging', 'requestLogging', 'bool');
    bindSetting('embedding_rounding', 'embeddingRounding', 'bool');

    // Extraction settings
    bindSetting('messages_per_extraction', 'messagesPerExtraction');
    bindSetting('extraction_rearview', 'extractionRearviewTokens', 'int', (v) =>
        updateWordsDisplay(v, 'openvault_extraction_rearview_words')
    );

    // Retrieval pipeline settings
    bindSetting('final_budget', 'retrievalFinalTokens', 'int', (v) =>
        updateWordsDisplay(v, 'openvault_final_budget_words')
    );

    // Auto-hide settings
    bindSetting('auto_hide', 'autoHideEnabled', 'bool');
    bindSetting('auto_hide_threshold', 'autoHideThreshold');

    // Scoring weights (alpha-blend)
    bindSetting('alpha', 'alpha', 'float');
    bindSetting('combined_weight', 'combinedBoostWeight', 'float');
    bindSetting('vector_threshold', 'vectorSimilarityThreshold', 'float');
    bindSetting('dedup_threshold', 'dedupSimilarityThreshold', 'float');
    bindSetting('entity_merge_threshold', 'entityMergeSimilarityThreshold', 'float');
    bindSetting('edge_description_cap', 'edgeDescriptionCap');

    // Query context enhancement settings
    bindSetting('entity_window', 'entityWindowSize');
    bindSetting('embedding_window', 'embeddingWindowSize');
    bindSetting('top_entities', 'topEntitiesCount');
    bindSetting('entity_boost', 'entityBoostWeight', 'float');

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

    // Feature settings
    bindSetting('reflection_threshold', 'reflectionThreshold');
    bindSetting('max_insights', 'maxInsightsPerReflection');
    bindSetting('reflection_dedup_threshold', 'reflectionDedupThreshold', 'float', (v) =>
        updateReflectionDedupDisplay(v)
    );
    bindSetting('world_context_budget', 'worldContextBudget', 'int', (v) =>
        updateWordsDisplay(v, 'openvault_world_context_budget_words')
    );
    bindSetting('community_interval', 'communityDetectionInterval');

    // Forgetfulness curve settings
    bindSetting('forgetfulness_lambda', 'forgetfulnessBaseLambda', 'float');
    bindSetting('importance5_floor', 'forgetfulnessImportance5Floor');

    // Reflection decay threshold
    bindSetting('reflection_decay_threshold', 'reflectionDecayThreshold');

    // Entity description cap
    bindSetting('entity_description_cap', 'entityDescriptionCap');

    // Max reflections per character
    bindSetting('max_reflections', 'maxReflectionsPerCharacter');

    // Community staleness threshold
    bindSetting('community_staleness', 'communityStalenessThreshold');

    // Jaccard dedup threshold
    bindSetting('dedup_jaccard', 'dedupJaccardThreshold', 'float');

    // Action buttons
    $('#openvault_backfill_embeddings_btn').on('click', backfillEmbeddings);
    $('#openvault_extract_all_btn').on('click', handleExtractAll);

    // Danger zone buttons
    $('#openvault_reset_settings_btn').on('click', handleResetSettings);
    $('#openvault_delete_chat_btn').on('click', handleDeleteChatData);
    $('#openvault_delete_embeddings_btn').on('click', handleDeleteEmbeddings);
    $('#openvault_export_debug_btn').on('click', exportToClipboard);

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
    $('#openvault_request_logging').prop('checked', settings.requestLogging);
    $('#openvault_embedding_rounding').prop('checked', settings.embeddingRounding);

    // Extraction settings
    $('#openvault_messages_per_extraction').val(settings.messagesPerExtraction);
    $('#openvault_messages_per_extraction_value').text(settings.messagesPerExtraction);

    $('#openvault_extraction_rearview').val(settings.extractionRearviewTokens);
    $('#openvault_extraction_rearview_value').text(settings.extractionRearviewTokens);
    updateWordsDisplay(settings.extractionRearviewTokens, 'openvault_extraction_rearview_words');

    // Retrieval pipeline settings
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

    $('#openvault_dedup_threshold').val(settings.dedupSimilarityThreshold ?? 0.92);
    $('#openvault_dedup_threshold_value').text(settings.dedupSimilarityThreshold ?? 0.92);

    $('#openvault_entity_merge_threshold').val(settings.entityMergeSimilarityThreshold ?? 0.94);
    $('#openvault_entity_merge_threshold_value').text(settings.entityMergeSimilarityThreshold ?? 0.94);

    $('#openvault_edge_description_cap').val(settings.edgeDescriptionCap ?? 5);
    $('#openvault_edge_description_cap_value').text(settings.edgeDescriptionCap ?? 5);

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

    // Feature settings
    $('#openvault_reflection_threshold').val(settings.reflectionThreshold ?? 30);
    $('#openvault_reflection_threshold_value').text(settings.reflectionThreshold ?? 30);

    $('#openvault_max_insights').val(settings.maxInsightsPerReflection ?? 3);
    $('#openvault_max_insights_value').text(settings.maxInsightsPerReflection ?? 3);

    $('#openvault_reflection_dedup_threshold').val(settings.reflectionDedupThreshold ?? 0.9);
    $('#openvault_reflection_dedup_threshold_value').text(settings.reflectionDedupThreshold ?? 0.9);
    updateReflectionDedupDisplay(settings.reflectionDedupThreshold ?? 0.9);

    $('#openvault_world_context_budget').val(settings.worldContextBudget ?? 2000);
    $('#openvault_world_context_budget_value').text(settings.worldContextBudget ?? 2000);
    updateWordsDisplay(settings.worldContextBudget ?? 2000, 'openvault_world_context_budget_words');

    $('#openvault_community_interval').val(settings.communityDetectionInterval ?? 50);
    $('#openvault_community_interval_value').text(settings.communityDetectionInterval ?? 50);

    // =========================================================================
    // NEW: Sync 7 previously-unbound settings to their HTML elements.
    // Each block reads the current value (with fallback default) and sets
    // both the <input> value and the adjacent <span> display text.
    // =========================================================================

    // Forgetfulness base lambda — exponential decay rate
    $('#openvault_forgetfulness_lambda').val(settings.forgetfulnessBaseLambda ?? 0.05);
    $('#openvault_forgetfulness_lambda_value').text(settings.forgetfulnessBaseLambda ?? 0.05);

    // Importance-5 floor — minimum score for max-importance memories
    $('#openvault_importance5_floor').val(settings.forgetfulnessImportance5Floor ?? 5);
    $('#openvault_importance5_floor_value').text(settings.forgetfulnessImportance5Floor ?? 5);

    // Reflection decay threshold — messages before reflections start decaying
    $('#openvault_reflection_decay_threshold').val(settings.reflectionDecayThreshold ?? 750);
    $('#openvault_reflection_decay_threshold_value').text(settings.reflectionDecayThreshold ?? 750);

    // Entity description cap — max description segments per entity
    $('#openvault_entity_description_cap').val(settings.entityDescriptionCap ?? 3);
    $('#openvault_entity_description_cap_value').text(settings.entityDescriptionCap ?? 3);

    // Max reflections per character — prevents reflection memory bloat
    $('#openvault_max_reflections').val(settings.maxReflectionsPerCharacter ?? 50);
    $('#openvault_max_reflections_value').text(settings.maxReflectionsPerCharacter ?? 50);

    // Community staleness threshold — messages before re-summarization
    $('#openvault_community_staleness').val(settings.communityStalenessThreshold ?? 100);
    $('#openvault_community_staleness_value').text(settings.communityStalenessThreshold ?? 100);

    // Jaccard dedup threshold — token-overlap filter for near-duplicates
    $('#openvault_dedup_jaccard').val(settings.dedupJaccardThreshold ?? 0.6);
    $('#openvault_dedup_jaccard_value').text(settings.dedupJaccardThreshold ?? 0.6);

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
}
