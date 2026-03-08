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
    PAYLOAD_CALC,
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

import { PREFILL_PRESETS } from '../prompts/preambles.js';
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

/**
 * Update the payload calculator readout.
 * Reads current slider values, adds PAYLOAD_CALC.OVERHEAD, sets emoji + color class.
 */
function updatePayloadCalculator() {
    const budget = Number($('#openvault_extraction_token_budget').val()) || defaultSettings.extractionTokenBudget;
    const rearview = Number($('#openvault_extraction_rearview').val()) || defaultSettings.extractionRearviewTokens;
    const total = budget + rearview + PAYLOAD_CALC.OVERHEAD;

    $('#openvault_payload_total').text(total.toLocaleString());

    // Breakdown: show each component so user understands
    const bStr = Math.round(budget / 1000) + 'k';
    const rStr = Math.round(rearview / 1000) + 'k';
    const outStr = Math.round(PAYLOAD_CALC.LLM_OUTPUT_TOKENS / 1000) + 'k';
    const bufStr = Math.round((PAYLOAD_CALC.PROMPT_ESTIMATE + PAYLOAD_CALC.SAFETY_BUFFER) / 1000) + 'k';
    $('#openvault_payload_breakdown').text(`(${bStr} batch + ${rStr} rearview + ${outStr} output + ${bufStr} buffer)`);

    // Color thresholds — all from PAYLOAD_CALC, no magic numbers here
    const $calc = $('#openvault_payload_calculator');
    $calc.removeClass('payload-safe payload-caution payload-warning payload-danger');
    let emoji;
    if (total <= PAYLOAD_CALC.THRESHOLD_GREEN) {
        $calc.addClass('payload-safe');
        emoji = '✅';
    } else if (total <= PAYLOAD_CALC.THRESHOLD_YELLOW) {
        $calc.addClass('payload-caution');
        emoji = '⚠️';
    } else if (total <= PAYLOAD_CALC.THRESHOLD_ORANGE) {
        $calc.addClass('payload-warning');
        emoji = '🟠';
    } else {
        $calc.addClass('payload-danger');
        emoji = '🔴';
    }
    $('#openvault_payload_emoji').text(emoji);
}

function getSettings() {
    return getDeps().getExtensionSettings()[extensionName];
}

function saveSetting(key, value) {
    getSettings()[key] = value;
    getDeps().saveSettingsDebounced();
}

// =============================================================================
// Prefill Selector (custom dropdown with hover preview)
// =============================================================================

function initPrefillSelector() {
    const $container = $('#openvault_prefill_selector');
    if (!$container.length) return;

    const settings = getSettings();
    const currentKey = settings.extractionPrefill || 'think_tag';
    const currentPreset = PREFILL_PRESETS[currentKey] || PREFILL_PRESETS.think_tag;

    // Trigger button
    const $trigger = $('<div class="openvault-prefill-trigger" tabindex="0"></div>').text(currentPreset.label);

    // Dropdown panel
    const $dropdown = $('<div class="openvault-prefill-dropdown"></div>');
    const $options = $('<div class="openvault-prefill-options"></div>');
    const $preview = $('<div class="openvault-prefill-preview"></div>');
    const $previewLabel = $('<div class="openvault-prefill-preview-label">Preview</div>');
    const $previewCode = $('<pre></pre>');
    $preview.append($previewLabel, $previewCode);

    renderPrefillPreview($previewCode, currentPreset.value);

    for (const [key, preset] of Object.entries(PREFILL_PRESETS)) {
        const $opt = $('<div class="openvault-prefill-option"></div>').attr('data-value', key).text(preset.label);

        if (key === currentKey) $opt.addClass('selected');

        $opt.on('mouseenter', () => renderPrefillPreview($previewCode, preset.value));

        $opt.on('click', () => {
            saveSetting('extractionPrefill', key);
            $trigger.text(preset.label);
            $options.find('.selected').removeClass('selected');
            $opt.addClass('selected');
            $container.removeClass('open');
            renderPrefillPreview($previewCode, preset.value);
        });

        $options.append($opt);
    }

    // Revert preview when mouse leaves options area
    $options.on('mouseleave', () => {
        const selKey = $options.find('.selected').data('value');
        renderPrefillPreview($previewCode, PREFILL_PRESETS[selKey]?.value);
    });

    $dropdown.append($options, $preview);
    $container.append($trigger, $dropdown);

    // Toggle dropdown
    $trigger.on('click', (e) => {
        e.stopPropagation();
        $container.toggleClass('open');
    });

    // Close on outside click
    $(document).on('click.prefillSelector', (e) => {
        if (!$container[0].contains(e.target)) {
            $container.removeClass('open');
        }
    });

    // Close on Escape
    $(document).on('keydown.prefillSelector', (e) => {
        if (e.key === 'Escape' && $container.hasClass('open')) {
            $container.removeClass('open');
            $trigger.trigger('focus');
        }
    });
}

function renderPrefillPreview($pre, value) {
    if (value === '' || value === undefined) {
        $pre.html('<span class="openvault-prefill-preview-empty">(empty — no prefill)</span>');
    } else {
        $pre.text(value);
    }
}

function syncPrefillSelector() {
    const settings = getSettings();
    const key = settings.extractionPrefill || 'think_tag';
    const preset = PREFILL_PRESETS[key];
    if (!preset) return;

    const $container = $('#openvault_prefill_selector');
    $container.find('.openvault-prefill-trigger').text(preset.label);
    $container.find('.openvault-prefill-option').removeClass('selected');
    $container.find(`.openvault-prefill-option[data-value="${key}"]`).addClass('selected');
    renderPrefillPreview($container.find('.openvault-prefill-preview pre'), preset.value);
}

// =============================================================================
// Action Handlers (inlined from actions.js)
// =============================================================================

async function handleExtractAll() {
    const { extractAllMessages } = await import('../extraction/extract.js');
    const { isWorkerRunning } = await import('../extraction/worker.js');
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

    // Initialize custom prefill selector with hover preview
    initPrefillSelector();

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

        // Collapse all <details> elements in the new tab
        $(`.openvault-tab-content[data-tab="${tabId}"] details`).removeAttr('open');

        // Collapse all inline-drawers in the new tab
        $(`.openvault-tab-content[data-tab="${tabId}"] .inline-drawer-content`).slideUp(200);
        $(`.openvault-tab-content[data-tab="${tabId}"] .inline-drawer-icon`).removeClass('up').addClass('down');

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
    bindSetting('extraction_token_budget', 'extractionTokenBudget', 'int', () => updatePayloadCalculator());
    bindSetting('extraction_rearview', 'extractionRearviewTokens', 'int', (v) => {
        updateWordsDisplay(v, 'openvault_extraction_rearview_words');
        updatePayloadCalculator();
    });

    // Token budget settings
    bindSetting('visible_chat_budget', 'visibleChatBudget');

    // Retrieval pipeline settings
    bindSetting('final_budget', 'retrievalFinalTokens', 'int', (v) =>
        updateWordsDisplay(v, 'openvault_final_budget_words')
    );

    // Auto-hide settings
    bindSetting('auto_hide', 'autoHideEnabled', 'bool');

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
            const { getStrategy } = await import('../embeddings.js');
            const oldStrategy = getStrategy(oldSource);
            if (oldStrategy && typeof oldStrategy.reset === 'function') {
                await oldStrategy.reset();
            }
        }

        // Persist the model selection
        saveSetting('embeddingSource', value);

        // Auto-populate prefix fields from model defaults
        const prefixes = embeddingModelPrefixes[value] || embeddingModelPrefixes._default;
        saveSetting('embeddingQueryPrefix', prefixes.queryPrefix);
        saveSetting('embeddingDocPrefix', prefixes.docPrefix);
        $('#openvault_embedding_query_prefix').val(prefixes.queryPrefix);
        $('#openvault_embedding_doc_prefix').val(prefixes.docPrefix);

        $('#openvault_ollama_settings').toggle(value === 'ollama');
        updateEmbeddingStatusDisplay(getEmbeddingStatus());
    });

    // Profile selectors
    $('#openvault_extraction_profile').on('change', function () {
        saveSetting('extractionProfile', $(this).val());
    });

    // Preamble language
    $('#openvault_preamble_language').on('change', function () {
        saveSetting('preambleLanguage', $(this).val());
    });

    // Output language
    $('#openvault_output_language').on('change', function () {
        saveSetting('outputLanguage', $(this).val());
    });

    // Prefill preset — handled by initPrefillSelector()

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
    $('#openvault_extraction_token_budget').val(settings.extractionTokenBudget);
    $('#openvault_extraction_token_budget_value').text(settings.extractionTokenBudget);

    $('#openvault_extraction_rearview').val(settings.extractionRearviewTokens);
    $('#openvault_extraction_rearview_value').text(settings.extractionRearviewTokens);
    updateWordsDisplay(settings.extractionRearviewTokens, 'openvault_extraction_rearview_words');

    // Token budget settings
    $('#openvault_visible_chat_budget').val(settings.visibleChatBudget);
    $('#openvault_visible_chat_budget_value').text(settings.visibleChatBudget);

    // Retrieval pipeline settings
    $('#openvault_final_budget').val(settings.retrievalFinalTokens);
    $('#openvault_final_budget_value').text(settings.retrievalFinalTokens);
    updateWordsDisplay(settings.retrievalFinalTokens, 'openvault_final_budget_words');

    // Auto-hide settings
    $('#openvault_auto_hide').prop('checked', settings.autoHideEnabled);

    // Scoring weights (alpha-blend)
    $('#openvault_alpha').val(settings.alpha);
    $('#openvault_alpha_value').text(settings.alpha);

    $('#openvault_combined_weight').val(settings.combinedBoostWeight);
    $('#openvault_combined_weight_value').text(settings.combinedBoostWeight);

    $('#openvault_vector_threshold').val(settings.vectorSimilarityThreshold);
    $('#openvault_vector_threshold_value').text(settings.vectorSimilarityThreshold);

    $('#openvault_dedup_threshold').val(settings.dedupSimilarityThreshold);
    $('#openvault_dedup_threshold_value').text(settings.dedupSimilarityThreshold);

    $('#openvault_entity_merge_threshold').val(settings.entityMergeSimilarityThreshold);
    $('#openvault_entity_merge_threshold_value').text(settings.entityMergeSimilarityThreshold);

    $('#openvault_edge_description_cap').val(settings.edgeDescriptionCap);
    $('#openvault_edge_description_cap_value').text(settings.edgeDescriptionCap);

    // Query context enhancement settings
    $('#openvault_entity_window').val(settings.entityWindowSize);
    $('#openvault_entity_window_value').text(settings.entityWindowSize);

    $('#openvault_embedding_window').val(settings.embeddingWindowSize);
    $('#openvault_embedding_window_value').text(settings.embeddingWindowSize);

    $('#openvault_top_entities').val(settings.topEntitiesCount);
    $('#openvault_top_entities_value').text(settings.topEntitiesCount);

    $('#openvault_entity_boost').val(settings.entityBoostWeight);
    $('#openvault_entity_boost_value').text(settings.entityBoostWeight);

    // Backfill settings
    $('#openvault_backfill_rpm').val(settings.backfillMaxRPM);

    // Embedding settings
    $('#openvault_embedding_source').val(settings.embeddingSource);
    $('#openvault_ollama_settings').toggle(settings.embeddingSource === 'ollama');
    $('#openvault_ollama_url').val(settings.ollamaUrl);
    $('#openvault_embedding_model').val(settings.embeddingModel);
    $('#openvault_embedding_query_prefix').val(settings.embeddingQueryPrefix);
    $('#openvault_embedding_doc_prefix').val(settings.embeddingDocPrefix);
    updateEmbeddingStatusDisplay(getEmbeddingStatus());

    // Populate profile selector
    populateProfileSelector();

    // Preamble language and prefill preset
    $('#openvault_preamble_language').val(settings.preambleLanguage || 'cn');
    $('#openvault_output_language').val(settings.outputLanguage || 'auto');
    syncPrefillSelector();

    // Feature settings
    $('#openvault_reflection_threshold').val(settings.reflectionThreshold);
    $('#openvault_reflection_threshold_value').text(settings.reflectionThreshold);

    $('#openvault_max_insights').val(settings.maxInsightsPerReflection);
    $('#openvault_max_insights_value').text(settings.maxInsightsPerReflection);

    $('#openvault_reflection_dedup_threshold').val(settings.reflectionDedupThreshold);
    $('#openvault_reflection_dedup_threshold_value').text(settings.reflectionDedupThreshold);
    updateReflectionDedupDisplay(settings.reflectionDedupThreshold);

    $('#openvault_world_context_budget').val(settings.worldContextBudget);
    $('#openvault_world_context_budget_value').text(settings.worldContextBudget);
    updateWordsDisplay(settings.worldContextBudget, 'openvault_world_context_budget_words');

    $('#openvault_community_interval').val(settings.communityDetectionInterval);
    $('#openvault_community_interval_value').text(settings.communityDetectionInterval);

    // =========================================================================
    // NEW: Sync 7 previously-unbound settings to their HTML elements.
    // Each block reads the current value (with fallback default) and sets
    // both the <input> value and the adjacent <span> display text.
    // =========================================================================

    // Forgetfulness base lambda — exponential decay rate
    $('#openvault_forgetfulness_lambda').val(settings.forgetfulnessBaseLambda);
    $('#openvault_forgetfulness_lambda_value').text(settings.forgetfulnessBaseLambda);

    // Importance-5 floor — minimum score for max-importance memories
    $('#openvault_importance5_floor').val(settings.forgetfulnessImportance5Floor);
    $('#openvault_importance5_floor_value').text(settings.forgetfulnessImportance5Floor);

    // Reflection decay threshold — messages before reflections start decaying
    $('#openvault_reflection_decay_threshold').val(settings.reflectionDecayThreshold);
    $('#openvault_reflection_decay_threshold_value').text(settings.reflectionDecayThreshold);

    // Entity description cap — max description segments per entity
    $('#openvault_entity_description_cap').val(settings.entityDescriptionCap);
    $('#openvault_entity_description_cap_value').text(settings.entityDescriptionCap);

    // Max reflections per character — prevents reflection memory bloat
    $('#openvault_max_reflections').val(settings.maxReflectionsPerCharacter);
    $('#openvault_max_reflections_value').text(settings.maxReflectionsPerCharacter);

    // Community staleness threshold — messages before re-summarization
    $('#openvault_community_staleness').val(settings.communityStalenessThreshold);
    $('#openvault_community_staleness_value').text(settings.communityStalenessThreshold);

    // Jaccard dedup threshold — token-overlap filter for near-duplicates
    $('#openvault_dedup_jaccard').val(settings.dedupJaccardThreshold);
    $('#openvault_dedup_jaccard_value').text(settings.dedupJaccardThreshold);

    // Payload calculator — must run after sliders are synced
    updatePayloadCalculator();

    // Refresh all UI components
    refreshAllUI();
}

// =============================================================================
// Budget Indicators
// =============================================================================

/**
 * Update budget fill indicators with color coding.
 * Called from refreshAllUI.
 */
export async function updateBudgetIndicators() {
    const data = getOpenVaultData();
    const context = getDeps().getContext?.();
    const chat = context?.chat || [];
    const settings = getSettings();

    if (!data || chat.length === 0) {
        $('#openvault_extraction_budget_text').text('No chat');
        $('#openvault_visible_budget_text').text('No chat');
        return;
    }

    const { getTokenSum } = await import('../utils/tokens.js');
    const { getExtractedMessageIds, getUnextractedMessageIds } = await import('../extraction/scheduler.js');

    // Extraction indicator
    const extractionBudget = settings.extractionTokenBudget;
    const extractedIds = getExtractedMessageIds(data);
    const unextractedIds = getUnextractedMessageIds(chat, extractedIds, 0);
    const unextractedTokens = getTokenSum(chat, unextractedIds, data);
    const extractionPct = Math.min((unextractedTokens / extractionBudget) * 100, 100);

    $('#openvault_extraction_budget_fill').css('width', `${extractionPct}%`);
    $('#openvault_extraction_budget_text').text(
        `${(unextractedTokens / 1000).toFixed(1)}k / ${(extractionBudget / 1000).toFixed(0)}k`
    );
    updateBudgetColor('openvault_extraction_budget_fill', extractionPct);

    // Visible chat indicator
    const visibleBudget = settings.visibleChatBudget;
    const visibleIndices = [];
    for (let i = 0; i < chat.length; i++) {
        if (!chat[i].is_system) visibleIndices.push(i);
    }
    const visibleTokens = getTokenSum(chat, visibleIndices, data);
    const visiblePct = Math.min((visibleTokens / visibleBudget) * 100, 100);

    $('#openvault_visible_budget_fill').css('width', `${visiblePct}%`);
    $('#openvault_visible_budget_text').text(
        `${(visibleTokens / 1000).toFixed(1)}k / ${(visibleBudget / 1000).toFixed(0)}k`
    );
    updateBudgetColor('openvault_visible_budget_fill', visiblePct);
}

function updateBudgetColor(elementId, pct) {
    const el = $(`#${elementId}`);
    el.removeClass('budget-low budget-mid budget-high');
    if (pct < 50) el.addClass('budget-low');
    else if (pct < 80) el.addClass('budget-mid');
    else el.addClass('budget-high');
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
