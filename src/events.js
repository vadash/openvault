/**
 * OpenVault Event Handlers
 *
 * Handles all SillyTavern event subscriptions and processing.
 */

import { eventSource, event_types } from '../../../../../script.js';
import { getContext, extension_settings } from '../../../../extensions.js';
import { getOpenVaultData, getCurrentChatId, showToast, safeSetExtensionPrompt, withTimeout, log, getExtractedMessageIds, getUnextractedMessageIds, isAutomaticMode } from './utils.js';
import { extensionName, MEMORIES_KEY, RETRIEVAL_TIMEOUT_MS } from './constants.js';
import { operationState, setGenerationLock, clearGenerationLock, isChatLoadingCooldown, setChatLoadingCooldown, resetOperationStatesIfSafe } from './state.js';
import { setStatus } from './ui/status.js';
import { refreshAllUI, resetMemoryBrowserPage } from './ui/browser.js';
import { extractMemories } from './extraction/extract.js';
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
    if (!isAutomaticMode()) return;

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

        const settings = extension_settings[extensionName];
        const messageCount = settings.messagesPerExtraction || 10;

        // Use message-based tracking (works correctly with auto-hide)
        const extractedMessageIds = getExtractedMessageIds(data);
        const totalMessages = chat.length;
        const extractedCount = extractedMessageIds.size;

        // Find unextracted message indices (excluding last N messages as buffer)
        const extractableIds = getUnextractedMessageIds(chat, extractedMessageIds, messageCount);

        // Only extract if we have a complete batch ready
        if (extractableIds.length < messageCount) {
            const remaining = messageCount - extractableIds.length;
            log(`Auto-extract: ${extractedCount}/${totalMessages} extracted, ${extractableIds.length} ready, need ${remaining} more for next batch`);
            return;
        }

        // Get the oldest complete batch of unextracted messages
        const batchToExtract = extractableIds.slice(0, messageCount);

        log(`Auto-extract: ${extractedCount}/${totalMessages} extracted, extracting batch of ${batchToExtract.length} messages (indices ${batchToExtract[0]}-${batchToExtract[batchToExtract.length - 1]})`);

        // Show extraction indicator
        setStatus('extracting');
        showToast('info', `Extracting memories (messages ${batchToExtract[0] + 1}-${batchToExtract[batchToExtract.length - 1] + 1})...`, 'OpenVault', {
            timeOut: 0,
            extendedTimeOut: 0,
            tapToDismiss: false,
            toastClass: 'toast openvault-extracting-toast'
        });

        const result = await extractMemories(batchToExtract);

        // Check if chat changed during extraction - don't save to wrong chat
        const chatIdAfterExtraction = getCurrentChatId();
        if (chatIdBeforeExtraction !== chatIdAfterExtraction) {
            log(`Chat changed during extraction (${chatIdBeforeExtraction} -> ${chatIdAfterExtraction}), not marking batch`);
            $('.openvault-extracting-toast').remove();
            showToast('warning', 'Chat changed during extraction, results may be incomplete', 'OpenVault');
            return;
        }

        // Clear the persistent toast and show success
        $('.openvault-extracting-toast').remove();
        if (result && result.events_created > 0) {
            showToast('success', `Extracted ${result.events_created} events from ${result.messages_processed} messages`, 'OpenVault');
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
export function updateEventListeners(_skipInitialization = false) {
    // Remove old event listeners first to prevent duplicates
    eventSource.removeListener(event_types.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
    eventSource.removeListener(event_types.GENERATION_ENDED, onGenerationEnded);
    eventSource.removeListener(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.removeListener(event_types.CHAT_CHANGED, onChatChanged);

    // Reset operation state only if no generation in progress
    resetOperationStatesIfSafe();

    if (isAutomaticMode()) {
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
