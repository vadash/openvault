/**
 * UI Action Handlers
 *
 * Handlers for user actions like extraction, deletion, reset, and embedding operations.
 * These are thin UI wrappers around domain functions.
 */

import { defaultSettings, extensionName } from '../constants.js';
import { getDeps } from '../deps.js';
import { getEmbeddingStatus, getStrategy, isEmbeddingsEnabled, testOllamaConnection } from '../embeddings.js';
import { updateEventListeners } from '../events.js';
import { setSetting } from '../settings.js';
import { deleteCurrentChatData, getOpenVaultData, saveOpenVaultData } from '../store/chat-data.js';
import { showToast } from '../utils/dom.js';
import { logError, logWarn } from '../utils/logging.js';
import { refreshAllUI } from './render.js';
import { updateUI } from './settings.js';
import { setStatus, updateEmbeddingStatusDisplay } from './status.js';

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
    'extractionMaxTurns',
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

/**
 * Handle Extract All button click.
 */
export async function handleExtractAll() {
    const { extractAllMessages } = await import('../extraction/extract.js');
    await extractAllMessages({
        onComplete: updateEventListeners,
        onStart: (batchCount) => {
            setStatus('extracting');
            toastr?.info(`Backfill: 0% (~${batchCount} batches estimated)`, 'OpenVault - Extracting', {
                timeOut: 0,
                extendedTimeOut: 0,
                tapToDismiss: false,
                toastClass: 'toast openvault-backfill-toast',
            });
        },
        onProgress: (batchNum, totalBatches, progressPercent, _eventsCreated, retryText) => {
            $('.openvault-backfill-toast .toast-message').text(
                `Backfill: ${progressPercent}% (${batchNum}/~${totalBatches} batches) - Processing...${retryText}`
            );
        },
        onBatchRetryWait: (batchNum, _totalBatches, backoffSeconds, retryCount) => {
            $('.openvault-backfill-toast .toast-message').text(
                `Backfill: batch ${batchNum} - Waiting ${backoffSeconds}s before retry ${retryCount}...`
            );
        },
        onPhase2Start: () => {
            $('.openvault-backfill-toast .toast-message').text(
                'Backfill: 100% - Synthesizing world state and reflections. This may take a minute...'
            );
        },
        onFinish: ({ messagesProcessed, eventsCreated }) => {
            $('.openvault-backfill-toast').remove();
            showToast('success', `Extracted ${eventsCreated} events from ${messagesProcessed} messages`);
            refreshAllUI();
            setStatus('ready');
        },
        onAbort: () => {
            $('.openvault-backfill-toast').remove();
            showToast('warning', 'Backfill aborted: chat changed', 'OpenVault');
            setStatus('ready');
        },
        onError: (error) => {
            $('.openvault-backfill-toast').remove();
            showToast('warning', error.message, 'OpenVault');
            setStatus('ready');
        },
    });
}

/**
 * Handle Delete Chat Data button click.
 */
export async function handleDeleteChatData() {
    if (!confirm('Are you sure you want to delete all OpenVault data for this chat?')) {
        return;
    }

    const deleted = await deleteCurrentChatData();
    if (deleted) {
        showToast('success', 'Chat memories deleted');
        refreshAllUI();
    }
}

/**
 * Handle Reset Settings button click.
 */
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

/**
 * Handle Backfill Embeddings button click.
 */
export async function backfillEmbeddings() {
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

/**
 * Handle Ollama Test button click.
 */
export async function handleOllamaTestClick() {
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
        await testOllamaConnection(url);
        $btn.removeClass('error').addClass('success');
        $btn.html('<i class="fa-solid fa-check"></i> Connected');
    } catch (err) {
        $btn.removeClass('success').addClass('error');
        $btn.html('<i class="fa-solid fa-xmark"></i> Failed');
        logError('Ollama test failed', err);
    }

    setTimeout(() => {
        $btn.removeClass('success error');
        $btn.html('<i class="fa-solid fa-plug"></i> Test');
    }, 3000);
}

/**
 * Handle Embedding Source change.
 * Invalidates stale embeddings when model changes and optionally re-embeds.
 */
export async function handleEmbeddingSourceChange(value) {
    const { embeddingModelPrefixes } = await import('../constants.js');

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
        const { invalidateStaleEmbeddings } = await import('../embeddings/migration.js');
        const wiped = await invalidateStaleEmbeddings(data, value);
        if (wiped > 0) {
            await saveOpenVaultData();
            showToast('info', `Embedding model changed. Re-embedding ${wiped} vectors in background.`);
            // Auto-trigger comprehensive re-embedding in background
            import('../embeddings.js')
                .then(({ backfillAllEmbeddings }) => {
                    backfillAllEmbeddings({ silent: true })
                        .then(() => refreshAllUI())
                        .catch(() => {});
                })
                .catch(() => {});
            refreshAllUI();
        }
    }

    $('#openvault_ollama_settings').toggle(value === 'ollama');
    updateEmbeddingStatusDisplay(getEmbeddingStatus());
}
