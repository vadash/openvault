/**
 * OpenVault Settings Panel UI
 *
 * Handles loading settings, binding UI elements, and updating the interface.
 * Refactored to use raw jQuery instead of bindings.js abstraction.
 *
 * Action handlers moved to actions.js.
 * Emergency cut modal moved to emergency-cut.js.
 * Prefill selector moved to prefill-selector.js.
 */

import {
    defaultSettings,
    extensionFolderPath,
    extensionName,
    PAYLOAD_CALC,
    PERF_METRICS,
    PERF_THRESHOLDS,
    UI_DEFAULT_HINTS,
} from '../constants.js';
import { getDeps } from '../deps.js';
import { getEmbeddingStatus, setEmbeddingStatusCallback } from '../embeddings.js';
import { updateEventListeners } from '../events.js';
import { formatForClipboard, getAll as getPerfData } from '../perf/store.js';
import { getSettings, setSetting } from '../settings.js';
import { getOpenVaultData } from '../store/chat-data.js';
import { showToast } from '../utils/dom.js';
import { logInfo, logWarn } from '../utils/logging.js';
// Action handlers
import {
    backfillEmbeddings,
    handleDeleteChatData,
    handleEmbeddingSourceChange,
    handleExtractAll,
    handleOllamaTestClick,
    handleResetSettings,
} from './actions.js';
import { handleEmergencyCutClick } from './emergency-cut.js';
import { exportToClipboard } from './export-debug.js';
import { validateRPM } from './helpers.js';
import { initPrefillSelector, syncPrefillSelector } from './prefill-selector.js';
import { initBrowser, refreshAllUI, resetAndRender } from './render.js';
import { updateEmbeddingStatusDisplay } from './status.js';

export { handleResetSettings } from './actions.js';
// Re-export for backward compatibility
export { hideEmergencyCutModal, showEmergencyCutModal } from './emergency-cut.js';

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
    bindSetting('extraction_max_turns', 'extractionMaxTurns', 'int', () => updatePayloadCalculator());
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
    $('#openvault_backfill_rpm').on('input', function () {
        let value = $(this).val();
        value = validateRPM(value, 10);
        setSetting('backfillMaxRPM', value);
        $(this).val(value);
        $('#openvault_backfill_rpm_value').text(value);
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
        await handleEmbeddingSourceChange($(this).val());
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
    // NEW: Reflection control toggles
    bindSetting('reflection_generation', 'reflectionGenerationEnabled', 'bool');
    bindSetting('reflection_injection', 'reflectionInjectionEnabled', 'bool');
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

    // Emergency Cut button
    $('#openvault_emergency_cut_btn').on('click', handleEmergencyCutClick);

    // Danger zone buttons
    $('#openvault_reset_settings_btn').on('click', handleResetSettings);
    $('#openvault_delete_chat_btn').on('click', handleDeleteChatData);
    $('#openvault_export_debug_btn').on('click', exportToClipboard);

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
    $('#openvault_test_ollama_btn').on('click', handleOllamaTestClick);

    // Perf tab clipboard copy button
    $('#openvault_copy_perf_btn').on('click', () => {
        const text = formatForClipboard();
        navigator.clipboard
            .writeText(text)
            .then(
                () => showToast('success', 'Perf data copied to clipboard'),
                () => showToast('error', 'Failed to copy — try selecting manually')
            )
            .catch(() => {});
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
        const position = parseInt($(this).val(), 10);
        setSetting('injection.memory.position', position);
        updateInjectionUI('memory');
    });

    // Memory depth input
    $('#openvault_memory_depth').on('input', function () {
        const depth = parseInt($(this).val(), 10) || 4;
        setSetting('injection.memory.depth', depth);
    });

    // World position selector
    $('#openvault_world_position').on('change', function () {
        const position = parseInt($(this).val(), 10);
        setSetting('injection.world.position', position);
        updateInjectionUI('world');
    });

    // World depth input
    $('#openvault_world_depth').on('input', function () {
        const depth = parseInt($(this).val(), 10) || 4;
        setSetting('injection.world.depth', depth);
    });

    // Copy macro buttons
    $('#openvault_copy_memory_macro').on('click', () => {
        navigator.clipboard
            .writeText('{{openvault_memory}}')
            .then(
                () => showToast('success', 'Copied {{openvault_memory}} to clipboard'),
                () => showToast('error', 'Failed to copy')
            )
            .catch(() => {});
    });

    $('#openvault_copy_world_macro').on('click', () => {
        navigator.clipboard
            .writeText('{{openvault_world}}')
            .then(
                () => showToast('success', 'Copied {{openvault_world}} to clipboard'),
                () => showToast('error', 'Failed to copy')
            )
            .catch(() => {});
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
        const _depth = settings.injection?.[t]?.depth ?? 4;

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

    $('#openvault_extraction_max_turns').val(settings.extractionMaxTurns);
    $('#openvault_extraction_max_turns_value').text(settings.extractionMaxTurns);

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
    $('#openvault_backfill_rpm_value').text(settings.backfillMaxRPM);

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

    // NEW: Reflection control toggles
    $('#openvault_reflection_generation').prop('checked', settings.reflectionGenerationEnabled);
    $('#openvault_reflection_injection').prop('checked', settings.reflectionInjectionEnabled);

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
    const { getExtractionBudgetProgress } = await import('../extraction/scheduler.js');

    // Extraction indicator - use domain function
    const { unextractedTokens, extractionPct, extractionBudget } = getExtractionBudgetProgress(
        chat,
        data,
        settings.extractionTokenBudget,
        settings.extractionMaxTurns || Infinity
    );

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
