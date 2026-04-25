// @ts-check

/**
 * OpenVault Extraction - Backfill Operations
 *
 * Handles backfill extraction (processing all unextracted messages) and Emergency Cut functionality.
 * Manages retry logic, progress tracking, and message hiding.
 */

/** @typedef {import('../types').ExtractionOptions} ExtractionOptions */

import { getDeps } from '../deps.js';
import { deleteItemsFromST, isStVectorSource, syncItemsToST } from '../services/st-vector.js';
import { isWorkerRunning, operationState } from '../state.js';
import { getCurrentChatId, getOpenVaultData, saveOpenVaultData } from '../store/chat-data.js';
import { showToast } from '../utils/dom.js';
import { markStSynced } from '../utils/embedding-codec.js';
import { logDebug, logError, logInfo } from '../utils/logging.js';
import { yieldToMain } from '../utils/st-helpers.js';
import { extractMemories } from './extract.js';
import {
    getBackfillMessageIds,
    getBackfillStats,
    getFingerprint,
    getNextBatch,
    getProcessedFingerprints,
} from './scheduler.js';

// Constants
const BACKOFF_SCHEDULE_SECONDS = [1, 2, 3, 10, 20, 30, 30, 60, 60];
const MAX_BACKOFF_TOTAL_MS = 15 * 60 * 1000;

/**
 * Apply ST Vector Storage sync changes from domain function return values.
 * Handles both sync (insert) and delete operations in bulk.
 *
 * @param {import('../types').StSyncChanges} stChanges
 * @returns {Promise<void>}
 */
export async function applySyncChanges(stChanges) {
    if (!isStVectorSource()) return;
    const chatId = getCurrentChatId();
    let requiresSave = false;
    if (stChanges.toSync?.length > 0) {
        const items = stChanges.toSync.map((c) => ({ hash: c.hash, text: c.text, index: 0 }));
        const success = await syncItemsToST(items, chatId);
        if (success) {
            for (const c of stChanges.toSync) markStSynced(c.item);
            requiresSave = true;
        }
    }
    if (stChanges.toDelete?.length > 0) {
        await deleteItemsFromST(
            stChanges.toDelete.map((c) => c.hash),
            chatId
        );
    }
    if (requiresSave) {
        await saveOpenVaultData();
    }
}

/**
 * Hide all extracted messages from LLM context by setting is_system=true.
 * Only hides messages that have been successfully processed (fingerprint in processed set).
 *
 * @returns {Promise<number>} Number of messages hidden
 */
export async function hideExtractedMessages() {
    const context = getDeps().getContext();
    const chat = context.chat || [];
    const data = getOpenVaultData();
    const processedFps = getProcessedFingerprints(data);

    let hiddenCount = 0;
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (processedFps.has(getFingerprint(msg)) && !msg.is_system) {
            msg.is_system = true;
            msg.openvault_hidden = true;
            hiddenCount++;
        }
    }

    if (hiddenCount > 0) {
        await getDeps().saveChatConditional();
        logInfo(`Emergency Cut: hid ${hiddenCount} messages (all extracted)`);
    }
    return hiddenCount;
}

/**
 * Execute an Emergency Cut — extract all unprocessed messages and hide them.
 * Domain orchestrator with callback injection for UI updates.
 *
 * @param {Object} options
 * @param {function(string): void} [options.onWarning] - Called for non-fatal warnings
 * @param {function(string): boolean} [options.onConfirmPrompt] - Called for user confirmation; return false to cancel
 * @param {function(): void} [options.onStart] - Called when extraction phase begins
 * @param {function(number, number, number): void} [options.onProgress] - Called per batch (batchNum, totalBatches, eventsCreated)
 * @param {function({messagesProcessed: number, eventsCreated: number, hiddenCount: number}): void} [options.onComplete] - Called on success
 * @param {function(Error, boolean): void} [options.onError] - Called on failure (error, isCancel)
 * @param {AbortSignal} [options.abortSignal] - For cancellation
 * @returns {Promise<void>}
 */
export async function executeEmergencyCut(options = {}) {
    const { onWarning, onConfirmPrompt, onStart, onProgress, onComplete, onError, abortSignal } = options;

    if (isWorkerRunning()) {
        onWarning?.('Background extraction in progress. Please wait a moment.');
        return;
    }

    const context = getDeps().getContext();
    const chat = context.chat || [];
    const data = getOpenVaultData();
    const stats = getBackfillStats(chat, data);

    let shouldExtract = true;

    if (stats.unextractedCount === 0) {
        const processedFps = getProcessedFingerprints(data);
        const hideableCount = chat.filter((m) => !m.is_system && processedFps.has(getFingerprint(m))).length;

        if (hideableCount === 0) {
            onWarning?.('No messages to hide');
            return;
        }

        const msg =
            `All messages are already extracted. Hide ${hideableCount} messages from the LLM to break the loop?\n\n` +
            'The LLM will only see: preset, char card, lorebooks, and OpenVault memories.';
        if (!onConfirmPrompt?.(msg)) return;
        shouldExtract = false;
    } else {
        const msg =
            `Extract and hide ${stats.unextractedCount} unprocessed messages?\n\n` +
            'The LLM will only see: preset, char card, lorebooks, and OpenVault memories.';
        if (!onConfirmPrompt?.(msg)) return;
    }

    if (!shouldExtract) {
        const hiddenCount = await hideExtractedMessages();
        onComplete?.({ messagesProcessed: 0, eventsCreated: 0, hiddenCount });
        return;
    }

    onStart?.();
    operationState.extractionInProgress = true;

    try {
        const result = await extractAllMessages({
            isEmergencyCut: true,
            progressCallback: onProgress,
            abortSignal,
        });

        const hiddenCount = await hideExtractedMessages();

        onComplete?.({
            messagesProcessed: result.messagesProcessed,
            eventsCreated: result.eventsCreated,
            hiddenCount,
        });
    } catch (err) {
        onError?.(err, err.name === 'AbortError');
    } finally {
        operationState.extractionInProgress = false;
    }
}

/**
 * Extract memories from all unextracted messages in current chat.
 * Processes in batches determined by extractionTokenBudget setting.
 *
 * @param {function|object} optionsOrCallback - Legacy callback OR options object
 * @returns {Promise<{messagesProcessed: number, eventsCreated: number}>}
 */
export async function extractAllMessages(optionsOrCallback) {
    // Normalize options to handle legacy function argument
    const opts = typeof optionsOrCallback === 'function' ? { onComplete: optionsOrCallback } : optionsOrCallback || {};

    const {
        isEmergencyCut = false,
        isBackfill = true,
        progressCallback = null,
        abortSignal = null,
        onComplete = null,
    } = opts;

    const deps = getDeps();
    const settings = deps.getExtensionSettings()[require('../constants.js').extensionName];
    const tokenBudget = settings?.extractionTokenBudget || 2000;

    // Get initial batch count for progress reporting
    const context = deps.getContext();
    const chat = context.chat || [];
    const data = getOpenVaultData();

    const { messageIds: initialMessageIds, batchCount: initialBatchCount } = getBackfillMessageIds(
        chat,
        data,
        tokenBudget,
        isEmergencyCut // Bypass token budget check for Emergency Cut
    );
    const processedFps = getProcessedFingerprints(data);

    if (processedFps.size > 0) {
        logDebug(`Backfill: Skipping ${processedFps.size} already-extracted messages`);
    }

    if (initialMessageIds.length === 0) {
        if (processedFps.size > 0) {
            showToast('info', `All eligible messages already extracted (${processedFps.size} messages have memories)`);
        } else {
            showToast('warning', `Not enough messages for a complete batch (need token budget met)`);
        }
        return { messagesProcessed: 0, eventsCreated: 0 };
    }

    // Notify caller that backfill is starting (skip for Emergency Cut - uses modal instead)
    if (!isEmergencyCut && progressCallback) {
        progressCallback(0, initialBatchCount, 0);
    }

    // Capture chat ID to detect if user switches during backfill
    const targetChatId = getCurrentChatId();

    // Process in batches - re-fetch indices each iteration to handle chat mutations
    let totalEvents = 0;
    let batchesProcessed = 0;
    let messagesProcessed = 0;
    let currentBatch = null;
    let retryCount = 0;
    let cumulativeBackoffMs = 0;
    let remainingUnextracted = initialMessageIds.length;

    while (true) {
        // Check abort signal at start of loop
        if (abortSignal?.aborted) {
            throw new DOMException('Emergency Cut Cancelled', 'AbortError');
        }

        // If we have no current batch or need to get a fresh one (after successful extraction)
        if (!currentBatch) {
            // Re-fetch current state to handle chat mutations (deletions/additions)
            const freshContext = getDeps().getContext();
            const freshChat = freshContext.chat;
            const freshData = getOpenVaultData();

            // Debug: log processed message tracking state
            const processedCount = (freshData?.processed_messages || []).length;
            const memoryCount = (freshData?.memories || []).length;
            logDebug(`Backfill state: ${processedCount} processed messages tracked, ${memoryCount} memories stored`);

            if (!freshChat || !freshData) {
                logDebug('Backfill: Lost chat context, stopping');
                break;
            }

            const { messageIds: freshIds, batchCount: remainingBatches } = getBackfillMessageIds(
                freshChat,
                freshData,
                tokenBudget,
                isEmergencyCut // Bypass token budget check for Emergency Cut
            );

            remainingUnextracted = freshIds.length;

            logDebug(
                `Backfill check: ${freshIds.length} unextracted messages available, ${remainingBatches} complete batches remaining`
            );

            // Get next batch using token budget
            currentBatch = getNextBatch(
                freshChat,
                freshData,
                tokenBudget,
                isEmergencyCut,
                settings.extractionMaxTurns || Infinity
            );
            if (!currentBatch) {
                logDebug('Backfill: No more complete batches available');
                break;
            }
        }

        // Update progress (toast for normal, callback for Emergency Cut)
        // Adaptive estimate: use actual throughput to predict remaining work
        const estimatedTotal = messagesProcessed + remainingUnextracted;
        const progressPercent =
            estimatedTotal > 0 ? Math.min(Math.round((messagesProcessed / estimatedTotal) * 100), 100) : 0;
        const avgPerBatch = batchesProcessed > 0 ? messagesProcessed / batchesProcessed : 0;
        const estimatedBatchesLeft = avgPerBatch > 0 ? Math.ceil(remainingUnextracted / avgPerBatch) : 0;
        const estimatedTotalBatches = batchesProcessed + estimatedBatchesLeft;

        const retryText =
            retryCount > 0
                ? ` (retry ${retryCount}, backoff ${Math.round(cumulativeBackoffMs / 1000)}s/${Math.round(MAX_BACKOFF_TOTAL_MS / 1000)}s)`
                : '';

        if (isEmergencyCut) {
            progressCallback?.(batchesProcessed + 1, estimatedTotalBatches, totalEvents);
        } else {
            showToast(
                'info',
                `Backfill progress: ${progressPercent}% (${batchesProcessed + 1}/${estimatedTotalBatches} batches, ${totalEvents} events)${retryText}`
            );
        }

        try {
            // Extract this batch
            const result = await extractMemories(currentBatch, targetChatId, {
                isBackfill,
                abortSignal,
            });

            if (result.status === 'success' && result.events_created > 0) {
                totalEvents += result.events_created;
                messagesProcessed += result.messages_processed;
                batchesProcessed++;
                retryCount = 0;
                cumulativeBackoffMs = 0;
                currentBatch = null; // Force re-fetch on next iteration

                // Yield to main thread between batches to keep UI responsive
                await yieldToMain();
            } else if (result.status === 'skipped' && result.reason === 'no_new_messages') {
                // No more messages to extract
                logDebug('Backfill: No new messages found, stopping');
                break;
            } else {
                // Extraction failed or was skipped
                throw new Error(result.reason || 'Extraction failed');
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                throw error; // Re-throw AbortError to cancel the entire operation
            }

            logError(`Backfill batch error: ${error.message}`);

            // Retry with exponential backoff
            const backoffIndex = Math.min(retryCount, BACKOFF_SCHEDULE_SECONDS.length - 1);
            const backoffSeconds = BACKOFF_SCHEDULE_SECONDS[backoffIndex];
            cumulativeBackoffMs += backoffSeconds * 1000;

            if (cumulativeBackoffMs > MAX_BACKOFF_TOTAL_MS) {
                logDebug('Backfill: Max cumulative backoff exceeded, stopping');
                break;
            }

            logDebug(`Backfill: Retrying in ${backoffSeconds}s...`);
            await new Promise((resolve) => setTimeout(resolve, backoffSeconds * 1000));
            retryCount++;
            currentBatch = null; // Force re-fetch on next iteration
        }
    }

    logInfo(`Backfill complete: ${messagesProcessed} messages processed, ${totalEvents} events created`);

    if (onComplete) {
        onComplete({ messagesProcessed, eventsCreated: totalEvents });
    }

    return { messagesProcessed, eventsCreated: totalEvents };
}

// Helper function to get extension name dynamically
function _getExtensionName() {
    return require('../constants.js').extensionName;
}
