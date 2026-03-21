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
    PAYLOAD_CALC,
    PERF_METRICS,
    PERF_THRESHOLDS,
    UI_DEFAULT_HINTS,
} from '../constants.js';
import { getDeps } from '../deps.js';
import { getSettings, setSetting } from '../settings.js';
import { getEmbeddingStatus, getStrategy, isEmbeddingsEnabled, setEmbeddingStatusCallback } from '../embeddings.js';
import { updateEventListeners } from '../events.js';
import { formatForClipboard, getAll as getPerfData } from '../perf/store.js';
import { logError, logInfo, logWarn } from '../utils/logging.js';
import { exportToClipboard } from './export-debug.js';
import { validateRPM } from './helpers.js';
import { initBrowser, nextPage, prevPage, refreshAllUI, resetAndRender } from './render.js';
import { updateEmbeddingStatusDisplay } from './status.js';

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
        logError('Ollama test failed', err);
    }

    // Reset button after 3 seconds
    setTimeout(() => {
        $btn.removeClass('success error');
        $btn.html('<i class="fa-solid fa-plug"></i> Test');
    }, 3000);
}

import { PREFILL_PRESETS } from '../prompts/index.js';
import { deleteCurrentChatData, getOpenVaultData } from '../utils/data.js';
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

/**
 * Update the payload calculator readout.
 * Reads current slider values, adds PAYLOAD_CALC.OVERHEAD, sets emoji + color class.
 */
export function updatePayloadCalculator() {
    const budget = Number($('#openvault_extraction_token_budget').val()) || defaultSettings.extractionTokenBudget;
    const rearview = Number($('#openvault_extraction_rearview').val()) || defaultSettings.extractionRearviewTokens;
    const total = budget + rearview + PAYLOAD_CALC.OVERHEAD;

    $('#openvault_payload_total').text(total.toLocaleString());

    // Breakdown: show each component so user understands
    const bStr = Math.round(budget / 1000) + 'k';
    const rStr = Math.round(rearview / 1000) + 'k';
    const ovhStr = Math.round(PAYLOAD_CALC.OVERHEAD / 1000) + 'k';
    $('#openvault_payload_breakdown').text(`(${bStr} batch + ${rStr} rearview + ${ovhStr} overhead)`);

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

    // LLM compatibility warning
    const $warning = $calc.find('.openvault-payload-warning');
    if (!$warning.length) {
        $calc.append(`
            <div class="openvault-payload-warning">
                Ensure your Extraction Profile supports at least ${Math.ceil(total / 1000)}k context.
            </div>
        `);
    } else {
        $warning.text(`Ensure your Extraction Profile supports at least ${Math.ceil(total / 1000)}k context.`);
    }
}

// =============================================================================
// Prefill Selector (custom dropdown with hover preview)
// =============================================================================

function initPrefillSelector() {
    const $container = $('#openvault_prefill_selector');
    if (!$container.length) return;

    const settings = getSettings();
    const currentKey = settings.extractionPrefill || 'pure_think';
    const currentPreset = PREFILL_PRESETS[currentKey] || PREFILL_PRESETS.pure_think;

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
            setSetting('extractionPrefill', key);
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
    const key = settings.extractionPrefill || 'pure_think';
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

// Define keys that should be preserved during settings reset
const PRESERVED_KEYS = [
    'extractionProfile',
    'backupProfile',
    'preambleLanguage',
    'outputLanguage',
    'extractionPrefill',
    'embeddingSource',
    'ollamaUrl',
    'embeddingModel',
    'embeddingQueryPrefix',
    'embeddingDocPrefix',
    'maxConcurrency',
    'backfillMaxRPM',
    'debugMode',
    'requestLogging',
];

// Define fine-tune keys that should be reset to defaults
const RESETTABLE_KEYS = [
    'extractionTokenBudget',
    'extractionRearviewTokens',
    'retrievalFinalTokens',
    'visibleChatBudget',
    'worldContextBudget',
    'reflectionThreshold',
    'maxInsightsPerReflection',
    'maxReflectionsPerCharacter',
    'alpha',
    'forgetfulnessBaseLambda',
    'vectorSimilarityThreshold',
    'dedupSimilarityThreshold',
    'dedupJaccardThreshold',
    'autoHideEnabled',
    'entityWindowSize',
    'embeddingWindowSize',
    'topEntitiesCount',
    'entityBoostWeight',
    'communityDetectionInterval',
];

export async function handleResetSettings() {
    if (
        !confirm(
            'Restore default math and threshold values? Your connection profiles and chat data will not be affected.'
        )
    ) {
        return;
    }

    const extension_settings = getDeps().getExtensionSettings();
    const currentSettings = extension_settings[extensionName] || {};

    // Save preserved values
    const preserved = {};
    for (const key of PRESERVED_KEYS) {
        if (key in currentSettings) {
            preserved[key] = currentSettings[key];
        }
    }

    // Reset each fine-tune setting to default
    for (const key of RESETTABLE_KEYS) {
        if (key in defaultSettings) {
            setSetting(key, defaultSettings[key]);
        }
    }

    // Restore preserved values
    Object.assign(extension_settings[extensionName], preserved);

    // Always enable debug after reset
    extension_settings[extensionName].debugMode = true;

    // Save
    getDeps().saveSettingsDebounced();

    // Update UI
    updateUI();

    showToast('success', 'Fine-tune values restored to defaults. Connection settings preserved.');
}

async function backfillEmbeddings() {
    if (!isEmbeddingsEnabled()) {
        showToast('warning', 'Configure Ollama URL and embedding model first');
        return;
    }

    const { backfillAllEmbeddings } = await import('../embeddings.js');
    const result = await backfillAllEmbeddings();

    if (result.total > 0) {
        showToast(
            'success',
            `Generated ${result.total} embeddings (${result.memories}m, ${result.nodes}n, ${result.communities}c)`
        );
    } else if (result.skipped) {
        showToast('info', 'All items already have embeddings');
    } else {
        showToast('warning', 'No embeddings generated - check connection');
    }

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
            logWarn(`Unknown default hint key: ${key}`);
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

    // Injection settings are now embedded in Advanced tab, no separate load needed

    logInfo('Settings loaded');
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

            setSetting(key, val);
            if (type !== 'bool') $(`#openvault_${id}_value`).text(val);
            if (callback) callback(val);
        });
    }

    // Basic toggles
    bindSetting('enabled', 'enabled', 'bool', () => updateEventListeners());
    bindSetting('debug', 'debugMode', 'bool');
    bindSetting('request_logging', 'requestLogging', 'bool');

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
    bindSetting('vector_threshold', 'vectorSimilarityThreshold', 'float');
    bindSetting('dedup_threshold', 'dedupSimilarityThreshold', 'float');

    // Query context enhancement settings
    bindSetting('entity_window', 'entityWindowSize');
    bindSetting('embedding_window', 'embeddingWindowSize');
    bindSetting('top_entities', 'topEntitiesCount');
    bindSetting('entity_boost', 'entityBoostWeight', 'float');

    // Backfill settings
    $('#openvault_backfill_rpm').on('change', function () {
        let value = $(this).val();
        value = validateRPM(value, 30);
        setSetting('backfillMaxRPM', value);
        $(this).val(value);
    });

    // Concurrency settings
    bindSetting('max_concurrency', 'maxConcurrency');

    // Embedding settings
    $('#openvault_ollama_url').on('change', function () {
        setSetting('ollamaUrl', $(this).val().trim());
    });

    $('#openvault_embedding_model').on('change', function () {
        setSetting('embeddingModel', $(this).val().trim());
    });

    $('#openvault_embedding_query_prefix').on('change', function () {
        setSetting('embeddingQueryPrefix', $(this).val());
    });

    $('#openvault_embedding_doc_prefix').on('change', function () {
        setSetting('embeddingDocPrefix', $(this).val());
    });

    $('#openvault_embedding_source').on('change', async function () {
        const value = $(this).val();

        // Reset old strategy before switching to prevent VRAM leak
        try {
            const currentSettings = getDeps().getExtensionSettings();
            const oldSource = currentSettings?.[extensionName]?.embeddingSource;

            if (oldSource && oldSource !== value) {
                const oldStrategy = getStrategy(oldSource);
                if (oldStrategy && typeof oldStrategy.reset === 'function') {
                    await oldStrategy.reset();
                }
            }
        } catch (err) {
            logWarn('Failed to reset old embedding strategy: ' + err.message);
        }

        // Persist the model selection
        setSetting('embeddingSource', value);

        // Auto-populate prefix fields from model defaults
        const prefixes = embeddingModelPrefixes[value] || embeddingModelPrefixes._default;
        setSetting('embeddingQueryPrefix', prefixes.queryPrefix);
        setSetting('embeddingDocPrefix', prefixes.docPrefix);
        $('#openvault_embedding_query_prefix').val(prefixes.queryPrefix);
        $('#openvault_embedding_doc_prefix').val(prefixes.docPrefix);

        // Invalidate stale embeddings if model changed
        const data = getOpenVaultData();
        if (data) {
            const { invalidateStaleEmbeddings, saveOpenVaultData } = await import('../utils/data.js');
            const wiped = invalidateStaleEmbeddings(data, value);
            if (wiped > 0) {
                await saveOpenVaultData();
                showToast('info', `Embedding model changed. Re-embedding ${wiped} vectors in background.`);
                // Auto-trigger comprehensive re-embedding in background
                import('../embeddings.js').then(({ backfillAllEmbeddings }) => {
                    backfillAllEmbeddings({ silent: true })
                        .then(() => refreshAllUI())
                        .catch(() => {});
                });
                refreshAllUI();
            }
        }

        $('#openvault_ollama_settings').toggle(value === 'ollama');
        updateEmbeddingStatusDisplay(getEmbeddingStatus());
    });

    // Profile selectors
    $('#openvault_extraction_profile').on('change', function () {
        setSetting('extractionProfile', $(this).val());
    });

    $('#openvault_backup_profile').on('change', function () {
        setSetting('backupProfile', $(this).val());
    });

    // Preamble language
    $('#openvault_preamble_language').on('change', function () {
        setSetting('preambleLanguage', $(this).val());
    });

    // Output language
    $('#openvault_output_language').on('change', function () {
        setSetting('outputLanguage', $(this).val());
    });

    // Prefill preset — handled by initPrefillSelector()

    // Feature settings
    bindSetting('reflection_threshold', 'reflectionThreshold');
    bindSetting('max_insights', 'maxInsightsPerReflection');
    bindSetting('world_context_budget', 'worldContextBudget', 'int', (v) =>
        updateWordsDisplay(v, 'openvault_world_context_budget_words')
    );
    bindSetting('community_interval', 'communityDetectionInterval');

    // Forgetfulness curve settings
    bindSetting('forgetfulness_lambda', 'forgetfulnessBaseLambda', 'float');

    // Max reflections per character
    bindSetting('max_reflections', 'maxReflectionsPerCharacter');

    // Jaccard dedup threshold
    bindSetting('dedup_jaccard', 'dedupJaccardThreshold', 'float');

    // Action buttons
    $('#openvault_backfill_embeddings_btn').on('click', backfillEmbeddings);
    $('#openvault_extract_all_btn').on('click', handleExtractAll);

    // Danger zone buttons
    $('#openvault_reset_settings_btn').on('click', handleResetSettings);
    $('#openvault_delete_chat_btn').on('click', handleDeleteChatData);
    $('#openvault_export_debug_btn').on('click', exportToClipboard);

    // Memory browser pagination
    $('#openvault_prev_page').on('click', () => prevPage());
    $('#openvault_next_page').on('click', () => nextPage());

    // Memory browser filters
    $('#openvault_filter_type').on('change', function () {
        setSetting('filter_type', $(this).val());
        resetAndRender();
    });

    $('#openvault_filter_character').on('change', function () {
        setSetting('filter_character', $(this).val());
        resetAndRender();
    });

    // Embedding status callback
    setEmbeddingStatusCallback((status) => {
        updateEmbeddingStatusDisplay(status);
    });

    // Test Ollama connection button
    $('#openvault_test_ollama_btn').on('click', testOllamaConnection);

    // Perf tab clipboard copy button
    $('#openvault_copy_perf_btn').on('click', () => {
        const text = formatForClipboard();
        navigator.clipboard.writeText(text).then(
            () => showToast('success', 'Perf data copied to clipboard'),
            () => showToast('error', 'Failed to copy — try selecting manually')
        );
    });

    // Injection settings bindings
    bindInjectionSettings();
}

// =============================================================================
// Injection Settings UI
// =============================================================================

/**
 * Bind injection settings UI events for position and depth controls.
 */
function bindInjectionSettings() {
    // Memory position selector
    $('#openvault_memory_position').on('change', function () {
        const position = parseInt($(this).val());
        setSetting('injection.memory.position', position);
        updateInjectionUI('memory');
    });

    // Memory depth input
    $('#openvault_memory_depth').on('input', function () {
        const depth = parseInt($(this).val()) || 4;
        setSetting('injection.memory.depth', depth);
    });

    // World position selector
    $('#openvault_world_position').on('change', function () {
        const position = parseInt($(this).val());
        setSetting('injection.world.position', position);
        updateInjectionUI('world');
    });

    // World depth input
    $('#openvault_world_depth').on('input', function () {
        const depth = parseInt($(this).val()) || 4;
        setSetting('injection.world.depth', depth);
    });

    // Copy macro buttons
    $('#openvault_copy_memory_macro').on('click', function () {
        navigator.clipboard.writeText('{{openvault_memory}}').then(
            () => showToast('success', 'Copied {{openvault_memory}} to clipboard'),
            () => showToast('error', 'Failed to copy')
        );
    });

    $('#openvault_copy_world_macro').on('click', function () {
        navigator.clipboard.writeText('{{openvault_world}}').then(
            () => showToast('success', 'Copied {{openvault_world}} to clipboard'),
            () => showToast('error', 'Failed to copy')
        );
    });
}

/**
 * Update injection settings UI visibility based on position selection.
 * @param {'memory'|'world'|'both'} type - Which injection type to update
 */
export function updateInjectionUI(type = 'both') {
    const settings = getSettings();

    const updateType = (t) => {
        const position = settings.injection?.[t]?.position ?? 1;
        const depth = settings.injection?.[t]?.depth ?? 4;

        // Update selector
        $(`#openvault_${t}_position`).val(position);

        // Show/hide depth input (only for IN_CHAT)
        $(`#openvault_${t}_depth_container`).toggle(position === 4);

        // Show/hide macro info (only for CUSTOM)
        $(`#openvault_${t}_macro_container`).toggle(position === -1);
    };

    if (type === 'both' || type === 'memory') updateType('memory');
    if (type === 'both' || type === 'world') updateType('world');
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

    $('#openvault_vector_threshold').val(settings.vectorSimilarityThreshold);
    $('#openvault_vector_threshold_value').text(settings.vectorSimilarityThreshold);

    $('#openvault_dedup_threshold').val(settings.dedupSimilarityThreshold);
    $('#openvault_dedup_threshold_value').text(settings.dedupSimilarityThreshold);

    // Query context enhancement settings
    $('#openvault_entity_window').val(settings.entityWindowSize);
    $('#openvault_entity_window_value').text(settings.entityWindowSize);

    $('#openvault_embedding_window').val(settings.embeddingWindowSize);
    $('#openvault_embedding_window_value').text(settings.embeddingWindowSize);

    $('#openvault_top_entities').val(settings.topEntitiesCount);
    $('#openvault_top_entities_value').text(settings.topEntitiesCount);

    $('#openvault_entity_boost').val(settings.entityBoostWeight);
    $('#openvault_entity_boost_value').text(settings.entityBoostWeight);

    // Concurrency settings
    $('#openvault_max_concurrency').val(settings.maxConcurrency);
    $('#openvault_max_concurrency_value').text(settings.maxConcurrency);

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

    // Max reflections per character — prevents reflection memory bloat
    $('#openvault_max_reflections').val(settings.maxReflectionsPerCharacter);
    $('#openvault_max_reflections_value').text(settings.maxReflectionsPerCharacter);

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
    const unextractedIds = getUnextractedMessageIds(chat, extractedIds);
    const unextractedTokens = getTokenSum(chat, unextractedIds);
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
    const visibleTokens = getTokenSum(chat, visibleIndices);
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
// Performance Tab
// =============================================================================

/**
 * Render the performance metrics table.
 * Reads from perf store, applies health thresholds, and updates DOM.
 */
export function renderPerfTab() {
    const tbody = document.getElementById('openvault_perf_tbody');
    if (!tbody) return;

    const data = getPerfData();
    const entries = Object.entries(data);

    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="openvault-placeholder">No perf data yet</td></tr>';
        return;
    }

    // Render in PERF_METRICS key order so order is stable
    const rows = [];
    for (const [id, meta] of Object.entries(PERF_METRICS)) {
        const entry = data[id];
        if (!entry) continue;
        const threshold = PERF_THRESHOLDS[id];
        const isOk = entry.ms <= threshold;
        const statusClass = isOk ? 'openvault-perf-ok' : 'openvault-perf-warn';
        const statusIcon = '●';
        const syncBadge = meta.sync ? '<span class="openvault-perf-sync-badge">SYNC</span>' : '';
        rows.push(`<tr>
            <td class="openvault-perf-icon"><i class="fa-solid ${meta.icon}"></i></td>
            <td>${meta.label}${syncBadge}</td>
            <td class="${statusClass}">${entry.ms.toFixed(2)}ms</td>
            <td>${entry.size || '—'}</td>
            <td class="openvault-perf-status ${statusClass}">${statusIcon}</td>
        </tr>`);
    }
    tbody.innerHTML = rows.join('');
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
    populateProfileDropdown($('#openvault_backup_profile'), profiles, settings.backupProfile);
}
