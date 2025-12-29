/**
 * OpenVault Event Handlers
 *
 * Handles all SillyTavern event subscriptions and processing.
 */

import { eventSource, event_types, saveChatConditional } from '../../../../../script.js';
import { getContext, extension_settings } from '../../../../extensions.js';
import { getOpenVaultData, getCurrentChatId, saveOpenVaultData, showToast, safeSetExtensionPrompt, withTimeout, log } from './utils.js';
import { extensionName, MEMORIES_KEY, EXTRACTED_BATCHES_KEY, RETRIEVAL_TIMEOUT_MS } from './constants.js';
import { operationState, setGenerationLock, clearGenerationLock, isChatLoadingCooldown, setChatLoadingCooldown, resetOperationStatesIfSafe } from './state.js';
import { setStatus } from './ui/status.js';
import { refreshAllUI, resetMemoryBrowserPage } from './ui/browser.js';
import { extractMemories, extractAllMessages } from './extraction/extract.js';
import { updateInjection } from './retrieval/retrieve.js';

/**
 * Auto-hide old messages beyond the threshold
 * Hides messages in pairs (user-assistant) to maintain conversation coherence
 * Messages are marked with is_system=true which excludes them from context
 * IMPORTANT: Only hides messages that have already been extracted into memories
 */
export async function autoHideOldMessages() {
    const settings = extension_settings[extensionName];
    if (!settings.autoHideEnabled) return;

    const context = getContext();
    const chat = context.chat || [];
    const threshold = settings.autoHideThreshold || 50;

    // Get messages that have been extracted into memories
    const data = getOpenVaultData();
    const extractedMessageIds = new Set();
    if (data) {
        for (const memory of (data[MEMORIES_KEY] || [])) {
            for (const msgId of (memory.message_ids || [])) {
                extractedMessageIds.add(msgId);
            }
        }
    }

    // Get visible (non-hidden) messages with their original indices
    const visibleMessages = chat
        .map((m, idx) => ({ ...m, idx }))
        .filter(m => !m.is_system);

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
        await saveChatConditional();
        log(`Auto-hid ${hiddenCount} messages (skipped ${skippedCount} not yet extracted) - threshold: ${threshold}`);
        showToast('info', `Auto-hid ${hiddenCount} old messages`);
    } else if (skippedCount > 0) {
        log(`Auto-hide: ${skippedCount} messages need extraction before hiding`);
    }
}

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

    // After cooldown, check if we should trigger automatic backfill
    setTimeout(() => {
        checkAndTriggerBackfill();
    }, 2500); // Slightly longer than cooldown to ensure it's cleared
}

/**
 * Check if there are enough unprocessed messages to trigger automatic backfill
 * Called after chat load cooldown when automatic mode is enabled
 */
async function checkAndTriggerBackfill() {
    const settings = extension_settings[extensionName];

    // Double-check automatic mode is still enabled
    if (!settings.enabled || !settings.automaticMode) return;

    // Don't trigger if an operation is in progress
    if (operationState.extractionInProgress || operationState.generationInProgress) {
        log('Skipping automatic backfill check - operation in progress');
        return;
    }

    const context = getContext();
    const chat = context.chat || [];
    if (chat.length === 0) return;

    const data = getOpenVaultData();
    if (!data) return;

    const messageCount = settings.messagesPerExtraction || 10;

    // Count ALL messages, not just visible ones
    const totalMessages = chat.length;

    // Get messages that have been extracted
    const extractedMessageIds = new Set();
    for (const memory of (data[MEMORIES_KEY] || [])) {
        for (const msgId of (memory.message_ids || [])) {
            extractedMessageIds.add(msgId);
        }
    }

    // Buffer zone: last N messages reserved for automatic extraction
    const bufferSize = messageCount * 2;
    const bufferStart = Math.max(0, totalMessages - bufferSize);

    // Count unprocessed messages before buffer
    let unprocessedCount = 0;
    for (let i = 0; i < bufferStart; i++) {
        if (!extractedMessageIds.has(i)) {
            unprocessedCount++;
        }
    }

    log(`Automatic backfill check: ${totalMessages} messages, ${extractedMessageIds.size} extracted, ${unprocessedCount} unprocessed before buffer`);

    // Trigger backfill if we have at least one batch worth of unprocessed messages
    if (unprocessedCount >= messageCount) {
        log(`Triggering automatic backfill for ${unprocessedCount} unprocessed messages`);
        showToast('info', `Starting automatic backfill (${unprocessedCount} messages)...`, 'OpenVault');

        try {
            await extractAllMessages(updateEventListeners);
        } catch (error) {
            console.error('[OpenVault] Automatic backfill error:', error);
            showToast('error', `Automatic backfill failed: ${error.message}`, 'OpenVault');
        }
    }
}

/**
 * Handle message received event (automatic mode)
 * Extracts memories AFTER AI responds
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

    // Don't extract during generation or if already extracting
    if (operationState.generationInProgress) {
        log('Skipping extraction - generation still in progress');
        return;
    }
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
    }
}

/**
 * Update event listeners based on settings
 * @param {boolean} skipInitialization - If true, skip the initial injection and backfill check
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
    if (operationState.generationInProgress) {
        log('Warning: Settings changed during generation, keeping locks');
    }

    if (settings.enabled && settings.automaticMode) {
        // Register event listeners for automatic mode
        eventSource.on(event_types.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
        eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

        log('Automatic mode enabled - event listeners registered');

        if (skipInitialization) {
            log('Skipping initialization (backfill mode) - retrieval will happen on next generation');
        } else {
            // Check for unprocessed batches when automatic mode is enabled
            setTimeout(() => {
                checkAndTriggerBackfill();
            }, 500);
        }
    } else {
        // Clear injection when disabled/manual
        safeSetExtensionPrompt('');
        log('Manual mode - injection cleared');
    }
}
