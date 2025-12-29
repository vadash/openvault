/**
 * OpenVault Event Handlers
 *
 * Handles all SillyTavern event subscriptions and processing.
 */

import { eventSource, event_types } from '../../../../../script.js';
import { getContext, extension_settings } from '../../../../extensions.js';
import { getOpenVaultData, getCurrentChatId, saveOpenVaultData, showToast, safeSetExtensionPrompt, withTimeout, log } from './utils.js';
import { extensionName, MEMORIES_KEY, EXTRACTED_BATCHES_KEY, RETRIEVAL_TIMEOUT_MS } from './constants.js';
import { operationState, setGenerationLock, clearGenerationLock, isChatLoadingCooldown, setChatLoadingCooldown, resetOperationStatesIfSafe } from './state.js';
import { setStatus } from './ui/status.js';
import { refreshAllUI, resetMemoryBrowserPage } from './ui/browser.js';
import { extractMemories } from './extraction/extract.js';
import { extractAllMessages } from './extraction/batch.js';
import { updateInjection } from './retrieval/retrieve.js';
import { autoHideOldMessages } from './auto-hide.js';
import { checkAndTriggerBackfill } from './backfill.js';

/**
 * Handle pre-generation event
 * @param {string} type - Generation type
 * @param {object} options - Generation options
 * @param {boolean} dryRun - If true, don't actually do retrieval
 */
export async function onBeforeGeneration(type, options, dryRun = false) {
    const settings = extension_settings[extensionName];

    // Skip if disabled, manual mode, or dry run
    if (!settings.enabled || !settings.automaticMode || dryRun) {
        return;
    }

    // Skip if already generating (prevent re-entry)
    if (operationState.generationInProgress) {
        log('Skipping retrieval - generation already in progress');
        return;
    }

    // Skip if retrieval already in progress
    if (operationState.retrievalInProgress) {
        log('Skipping retrieval - retrieval already in progress');
        return;
    }

    // Set retrieval flag immediately to prevent concurrent retrievals
    operationState.retrievalInProgress = true;

    try {
        // Auto-hide old messages before building context
        await autoHideOldMessages();

        // Skip retrieval if no memories exist yet
        const data = getOpenVaultData();
        if (!data) {
            log('>>> Skipping retrieval - no context available');
            return;
        }
        const memories = data[MEMORIES_KEY] || [];
        if (memories.length === 0) {
            log('>>> Skipping retrieval - no memories yet');
            return;
        }

        setStatus('retrieving');
        setGenerationLock();

        // Get context for retrieval - use the last user message if available
        const context = getContext();
        const chat = context.chat || [];
        const lastUserMessage = [...chat].reverse().find(m => m.is_user && !m.is_system);
        const pendingUserMessage = lastUserMessage?.mes || '';

        // Show toast notification during retrieval
        showToast('info', 'Retrieving memories...', 'OpenVault', { timeOut: 2000 });

        // Do memory retrieval before generation
        log(`>>> Pre-generation retrieval starting (type: ${type}, message: "${pendingUserMessage.substring(0, 50)}...")`);
        await withTimeout(
            updateInjection(pendingUserMessage),
            RETRIEVAL_TIMEOUT_MS,
            'Memory retrieval'
        );
        log('>>> Pre-generation retrieval complete');

        setStatus('ready');
    } catch (error) {
        console.error('OpenVault: Error during pre-generation retrieval:', error);
        setStatus('error');
        // Don't block generation on retrieval failure
    } finally {
        // Always clear retrieval flag
        operationState.retrievalInProgress = false;
    }
}

/**
 * Handle generation ended event
 */
export function onGenerationEnded() {
    clearGenerationLock();
    log('Generation ended, clearing lock');
}

/**
 * Handle chat changed event
 */
export function onChatChanged() {
    const settings = extension_settings[extensionName];
    if (!settings.enabled || !settings.automaticMode) return;

    log('Chat changed, clearing injection and setting load cooldown');

    // Reset memoryBrowserPage to prevent showing wrong page after chat switch
    resetMemoryBrowserPage();

    // Set cooldown to prevent MESSAGE_RECEIVED from triggering extraction during chat load
    setChatLoadingCooldown(2000, log);

    // Clear operation states on chat change to prevent stale locks
    resetOperationStatesIfSafe();

    // Clear current injection - it will be refreshed in onBeforeGeneration
    safeSetExtensionPrompt('');

    // Refresh UI on chat change
    refreshAllUI();
    setStatus('ready');
}

/**
 * Handle message received event (automatic mode)
 * Extracts memories AFTER AI responds, then checks for backfill
 * @param {number} messageId - The message ID
 */
export async function onMessageReceived(messageId) {
    const settings = extension_settings[extensionName];
    if (!settings.enabled || !settings.automaticMode) return;

    // Don't extract during chat load cooldown
    if (isChatLoadingCooldown()) {
        log(`Skipping extraction for message ${messageId} - chat load cooldown active`);
        return;
    }

    // Don't extract if already extracting
    if (operationState.extractionInProgress) {
        log('Skipping extraction - extraction already in progress');
        return;
    }

    // Set extraction flag IMMEDIATELY after check to prevent race conditions
    operationState.extractionInProgress = true;

    // Capture chat ID before any async operations to detect chat switch
    const chatIdBeforeExtraction = getCurrentChatId();

    try {
        const context = getContext();
        const chat = context.chat || [];
        const message = chat[messageId];

        // Only extract after AI messages (not user messages)
        if (!message || message.is_user || message.is_system) {
            log(`Message ${messageId} is user/system message, skipping extraction`);
            return;
        }

        const data = getOpenVaultData();
        if (!data) {
            log('Cannot get OpenVault data, skipping extraction');
            return;
        }

        const messageCount = settings.messagesPerExtraction || 10;

        // Get all non-system messages
        const nonSystemMessages = chat
            .map((m, idx) => ({ ...m, idx }))
            .filter(m => !m.is_system);

        const totalMessages = nonSystemMessages.length;

        // Get the highest extracted batch number (-1 if none extracted yet)
        const extractedBatches = data[EXTRACTED_BATCHES_KEY] || [];
        const highestExtractedBatch = extractedBatches.length > 0 ? Math.max(...extractedBatches) : -1;

        // Calculate the next batch to extract
        const nextBatchToExtract = highestExtractedBatch + 1;

        // Calculate how many complete batches worth of messages we have
        const totalCompleteBatches = Math.floor(totalMessages / messageCount);

        // We need the batch we want to extract PLUS one buffer batch
        const requiredBatches = nextBatchToExtract + 2;

        log(`AI message received: ${messageId}, total: ${totalMessages}, complete batches: ${totalCompleteBatches}, last extracted: ${highestExtractedBatch}, next to extract: ${nextBatchToExtract}, required: ${requiredBatches}`);

        if (totalCompleteBatches < requiredBatches) {
            const messagesNeeded = requiredBatches * messageCount;
            const remaining = messagesNeeded - totalMessages;
            log(`Not enough messages yet: have ${totalMessages}, need ${messagesNeeded} (${remaining} more) to safely extract batch ${nextBatchToExtract}`);
            return;
        }

        // Double-check this batch hasn't been extracted (safety check)
        if (extractedBatches.includes(nextBatchToExtract)) {
            log(`Batch ${nextBatchToExtract} already extracted, skipping`);
            return;
        }

        // Calculate message range for this batch (0-indexed)
        const startIdx = nextBatchToExtract * messageCount;
        const endIdx = startIdx + messageCount;
        const batchMessages = nonSystemMessages.slice(startIdx, endIdx);

        if (batchMessages.length !== messageCount) {
            log(`Batch ${nextBatchToExtract} has wrong size (${batchMessages.length}/${messageCount}), skipping`);
            return;
        }

        log(`Extracting batch ${nextBatchToExtract} (messages ${startIdx}-${endIdx - 1}, indices: ${batchMessages.map(m => m.idx).join(',')})`);

        // Show extraction indicator
        setStatus('extracting');
        showToast('info', `Extracting memories (batch ${nextBatchToExtract + 1}, messages ${startIdx + 1}-${endIdx})...`, 'OpenVault', {
            timeOut: 0,
            extendedTimeOut: 0,
            tapToDismiss: false,
            toastClass: 'toast openvault-extracting-toast'
        });

        const messageIds = batchMessages.map(m => m.idx);
        const result = await extractMemories(messageIds);

        // Check if chat changed during extraction - don't save to wrong chat
        const chatIdAfterExtraction = getCurrentChatId();
        if (chatIdBeforeExtraction !== chatIdAfterExtraction) {
            log(`Chat changed during extraction (${chatIdBeforeExtraction} -> ${chatIdAfterExtraction}), not marking batch`);
            $('.openvault-extracting-toast').remove();
            showToast('warning', 'Chat changed during extraction, results may be incomplete', 'OpenVault');
            return;
        }

        // Only mark batch as extracted if events were actually created
        if (result && result.events_created > 0) {
            // Re-get data in case it changed (get fresh reference after async)
            const freshData = getOpenVaultData();
            if (freshData) {
                freshData[EXTRACTED_BATCHES_KEY] = freshData[EXTRACTED_BATCHES_KEY] || [];
                if (!freshData[EXTRACTED_BATCHES_KEY].includes(nextBatchToExtract)) {
                    freshData[EXTRACTED_BATCHES_KEY].push(nextBatchToExtract);
                }
                await saveOpenVaultData();
                log(`Batch ${nextBatchToExtract} extracted and marked (${result.events_created} events)`);
            }
        } else {
            log(`Batch ${nextBatchToExtract} extraction produced no events, not marking as extracted`);
        }

        // Clear the persistent toast and show success
        $('.openvault-extracting-toast').remove();
        if (result && result.events_created > 0) {
            showToast('success', `Batch ${nextBatchToExtract + 1} extracted successfully (${result.events_created} events)`, 'OpenVault');
        }
    } catch (error) {
        console.error('[OpenVault] Automatic extraction error:', error);
        // Clear the persistent toast and show error
        $('.openvault-extracting-toast').remove();
        showToast('error', `Extraction failed: ${error.message}`, 'OpenVault');
    } finally {
        operationState.extractionInProgress = false;
        setStatus('ready');

        // Check for backfill after each generation cycle
        checkAndTriggerBackfill(updateEventListeners);
    }
}

/**
 * Update event listeners based on settings
 */
export function updateEventListeners(skipInitialization = false) {
    const settings = extension_settings[extensionName];

    // Remove old event listeners first to prevent duplicates
    eventSource.removeListener(event_types.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
    eventSource.removeListener(event_types.GENERATION_ENDED, onGenerationEnded);
    eventSource.removeListener(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.removeListener(event_types.CHAT_CHANGED, onChatChanged);

    // Reset operation state only if no generation in progress
    resetOperationStatesIfSafe();

    if (settings.enabled && settings.automaticMode) {
        // Register event listeners for automatic mode
        eventSource.on(event_types.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
        eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

        log('Automatic mode enabled - event listeners registered');
    } else {
        // Clear injection when disabled/manual
        safeSetExtensionPrompt('');
        log('Manual mode - injection cleared');
    }
}
