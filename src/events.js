/**
 * OpenVault Event Handlers
 *
 * Handles all SillyTavern event subscriptions and processing.
 */

import { extensionName, MEMORIES_KEY, RETRIEVAL_TIMEOUT_MS } from './constants.js';
import { getDeps } from './deps.js';
import { clearEmbeddingCache } from './embeddings.js';
import { extractAllMessages, extractMemories } from './extraction/extract.js';
import { getBackfillStats, getExtractedMessageIds, getNextBatch } from './extraction/scheduler.js';
import { updateInjection } from './retrieval/retrieve.js';
import {
    clearGenerationLock,
    isChatLoadingCooldown,
    operationState,
    resetOperationStatesIfSafe,
    setChatLoadingCooldown,
    setGenerationLock,
} from './state.js';
import { refreshAllUI, resetMemoryBrowserPage } from './ui/render.js';
import { setStatus } from './ui/status.js';
import {
    getCurrentChatId,
    getOpenVaultData,
    isAutomaticMode,
    log,
    safeSetExtensionPrompt,
    showToast,
    withTimeout,
} from './utils.js';

// =============================================================================
// Auto-Hide Old Messages (inlined from auto-hide.js)
// =============================================================================

/**
 * Auto-hide old messages beyond the threshold
 * Hides messages in pairs (user-assistant) to maintain conversation coherence
 * Messages are marked with is_system=true which excludes them from context
 * IMPORTANT: Only hides messages that have already been extracted into memories
 */
async function autoHideOldMessages() {
    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName];
    if (!settings.autoHideEnabled) return;

    const context = deps.getContext();
    const chat = context.chat || [];
    const threshold = settings.autoHideThreshold || 50;

    // Get messages that have been extracted into memories
    const data = getOpenVaultData();
    const extractedMessageIds = getExtractedMessageIds(data);

    // Get visible (non-hidden) messages with their original indices
    const visibleMessages = chat.map((m, idx) => ({ ...m, idx })).filter((m) => !m.is_system);

    // If we have fewer messages than threshold, nothing to hide
    if (visibleMessages.length <= threshold) return;

    // Calculate how many messages to hide
    const toHideCount = visibleMessages.length - threshold;

    // Round down to nearest even number (for pairs)
    const pairsToHide = Math.floor(toHideCount / 2);
    const messagesToHide = pairsToHide * 2;

    if (messagesToHide <= 0) return;

    // Hide the oldest messages, but ONLY if they've been extracted
    let hiddenCount = 0;
    let skippedCount = 0;
    for (let i = 0; i < messagesToHide && i < visibleMessages.length; i++) {
        const msgIdx = visibleMessages[i].idx;

        // Only hide if this message has been extracted into memories
        if (extractedMessageIds.has(msgIdx)) {
            chat[msgIdx].is_system = true;
            hiddenCount++;
        } else {
            skippedCount++;
        }
    }

    if (hiddenCount > 0) {
        await getDeps().saveChatConditional();
        log(`Auto-hid ${hiddenCount} messages (skipped ${skippedCount} not yet extracted) - threshold: ${threshold}`);
        showToast('info', `Auto-hid ${hiddenCount} old messages`);
    } else if (skippedCount > 0) {
        log(`Auto-hide: ${skippedCount} messages need extraction before hiding`);
    }
}

// =============================================================================
// Event Handlers
// =============================================================================

/**
 * Handle pre-generation event
 * @param {string} type - Generation type
 * @param {object} options - Generation options
 * @param {boolean} dryRun - If true, don't actually do retrieval
 */
export async function onBeforeGeneration(type, _options, dryRun = false) {
    // Skip if disabled, manual mode, or dry run
    if (!isAutomaticMode() || dryRun) {
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
        const context = getDeps().getContext();
        const chat = context.chat || [];
        const lastUserMessage = [...chat].reverse().find((m) => m.is_user && !m.is_system);
        const pendingUserMessage = lastUserMessage?.mes || '';

        // Show toast notification during retrieval
        showToast('info', 'Retrieving memories...', 'OpenVault', { timeOut: 2000 });

        // Do memory retrieval before generation
        log(
            `>>> Pre-generation retrieval starting (type: ${type}, message: "${pendingUserMessage.substring(0, 50)}...")`
        );
        await withTimeout(updateInjection(pendingUserMessage), RETRIEVAL_TIMEOUT_MS, 'Memory retrieval');
        log('>>> Pre-generation retrieval complete');

        setStatus('ready');
    } catch (error) {
        getDeps().console.error('OpenVault: Error during pre-generation retrieval:', error);
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
    if (!isAutomaticMode()) return;

    log('Chat changed, clearing injection, cache and setting load cooldown');

    // Clear embedding cache to free memory when switching chats
    clearEmbeddingCache();

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
    if (!isAutomaticMode()) return;

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
        const deps = getDeps();
        const context = deps.getContext();
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

        const settings = deps.getExtensionSettings()[extensionName];
        const messageCount = settings.messagesPerExtraction || 10;
        const bufferSize = settings.extractionBuffer || 5;

        // Use scheduler to get next batch (excluding recent messages in buffer)
        const batchToExtract = getNextBatch(chat, data, messageCount, bufferSize);

        if (!batchToExtract) {
            const extractedCount = getExtractedMessageIds(data).size;
            log(`Auto-extract: ${extractedCount}/${chat.length} extracted, waiting for more messages`);
            return;
        }

        log(
            `Auto-extract: extracting batch of ${batchToExtract.length} messages (indices ${batchToExtract[0]}-${batchToExtract[batchToExtract.length - 1]})`
        );

        // Show extraction indicator
        setStatus('extracting');
        showToast(
            'info',
            `Extracting memories (messages ${batchToExtract[0] + 1}-${batchToExtract[batchToExtract.length - 1] + 1})...`,
            'OpenVault',
            {
                timeOut: 0,
                extendedTimeOut: 0,
                tapToDismiss: false,
                toastClass: 'toast openvault-extracting-toast',
            }
        );

        // Pass chatId to extractMemories for integrity check during long LLM calls
        const result = await extractMemories(batchToExtract, chatIdBeforeExtraction);

        // Clear the persistent toast and show success
        $('.openvault-extracting-toast').remove();
        if (result && result.status === 'success' && result.events_created > 0) {
            showToast(
                'success',
                `Extracted ${result.events_created} events from ${result.messages_processed} messages`,
                'OpenVault'
            );
            refreshAllUI();
        }
    } catch (error) {
        getDeps().console.error('[OpenVault] Automatic extraction error:', error);
        // Clear the persistent toast and show error
        $('.openvault-extracting-toast').remove();
        showToast('error', `Extraction failed: ${error.message}`, 'OpenVault');
    } finally {
        operationState.extractionInProgress = false;
        setStatus('ready');

        // Check for backfill after each generation cycle
        checkAndTriggerBackfill(updateEventListeners, chatIdBeforeExtraction);
    }
}

// =============================================================================
// Backfill Check (inlined from backfill.js)
// =============================================================================

/**
 * Check and trigger automatic backfill if there are enough unprocessed messages
 * Uses same logic as manual "Backfill Chat History" button
 * @param {function} updateEventListenersFn - Function to update event listeners after backfill
 * @param {string} targetChatId - Optional chat ID to verify we haven't switched chats
 */
async function checkAndTriggerBackfill(updateEventListenersFn, targetChatId) {
    if (!isAutomaticMode()) return;

    // Don't backfill if chat has changed since this was queued
    if (targetChatId && getCurrentChatId() !== targetChatId) return;

    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName];
    const context = deps.getContext();
    const chat = context.chat || [];
    if (chat.length === 0) return;

    const data = getOpenVaultData();
    if (!data) return;

    const messageCount = settings.messagesPerExtraction || 10;

    // Use scheduler to check for backfill work
    const stats = getBackfillStats(chat, data, messageCount);

    if (stats.completeBatches >= 1) {
        log(`Auto-backfill: ${stats.totalUnextracted} messages ready (${stats.completeBatches} batches)`);
        showToast('info', `Auto-backfill: ${stats.completeBatches} batches...`, 'OpenVault');

        try {
            await extractAllMessages(updateEventListenersFn);
        } catch (error) {
            deps.console.error('[OpenVault] Auto-backfill error:', error);
        }
    }
}

// =============================================================================
// Event Listener Management
// =============================================================================

/**
 * Event type to handler mapping for DRY listener management
 */
const EVENT_MAP = [
    ['GENERATION_AFTER_COMMANDS', onBeforeGeneration],
    ['GENERATION_ENDED', onGenerationEnded],
    ['MESSAGE_RECEIVED', onMessageReceived],
    ['CHAT_CHANGED', onChatChanged],
];

/**
 * Update event listeners based on settings
 */
export function updateEventListeners(_skipInitialization = false) {
    const { eventSource, eventTypes } = getDeps();

    // Reset operation state only if no generation in progress
    resetOperationStatesIfSafe();

    // Cleanup and register in one loop
    EVENT_MAP.forEach(([type, handler]) => {
        eventSource.removeListener(eventTypes[type], handler);
        if (isAutomaticMode()) {
            eventSource.on(eventTypes[type], handler);
            if (type === 'GENERATION_AFTER_COMMANDS') {
                eventSource.makeFirst(eventTypes[type], handler);
            }
        }
    });

    if (isAutomaticMode()) {
        log('Automatic mode enabled - event listeners registered');
    } else {
        // Clear injection when disabled/manual
        safeSetExtensionPrompt('');
        log('Manual mode - injection cleared');
    }
}
