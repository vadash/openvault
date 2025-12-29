/**
 * OpenVault Memory Retrieval
 *
 * Main retrieval logic for selecting and injecting memories into context.
 */

import { getContext, extension_settings } from '../../../../../extensions.js';
import { getOpenVaultData, safeSetExtensionPrompt, showToast, log, isExtensionEnabled, isAutomaticMode } from '../utils.js';
import { extensionName, MEMORIES_KEY, CHARACTERS_KEY, LAST_BATCH_KEY, RECENT_MESSAGE_BUFFER } from '../constants.js';
import { setStatus } from '../ui/status.js';
import { getActiveCharacters, getPOVContext, filterMemoriesByPOV } from '../pov.js';
import { selectRelevantMemories } from './scoring.js';
import { getRelationshipContext, formatContextForInjection } from './formatting.js';

/**
 * Inject retrieved context into the prompt
 * @param {string} contextText - Formatted context to inject
 */
export function injectContext(contextText) {
    if (!contextText) {
        // Clear the injection if no context
        safeSetExtensionPrompt('');
        return;
    }

    if (safeSetExtensionPrompt(contextText)) {
        log('Context injected into prompt');
    } else {
        log('Failed to inject context');
    }
}

/**
 * Core retrieval logic: select relevant memories, format, and inject
 * @param {Object[]} memoriesToUse - Pre-filtered memories to select from
 * @param {Object} data - OpenVault data object
 * @param {string} recentMessages - Chat context for relevance matching
 * @param {string} primaryCharacter - Primary character for formatting
 * @param {string[]} activeCharacters - All active characters
 * @param {string} headerName - Header name for injection
 * @param {Object} settings - Extension settings
 * @returns {Promise<{memories: Object[], context: string}|null>}
 */
async function selectFormatAndInject(memoriesToUse, data, recentMessages, primaryCharacter, activeCharacters, headerName, settings) {
    const relevantMemories = await selectRelevantMemories(
        memoriesToUse,
        recentMessages,
        primaryCharacter,
        activeCharacters,
        settings.maxMemoriesPerRetrieval
    );

    if (!relevantMemories || relevantMemories.length === 0) {
        return null;
    }

    // Get relationship and emotional context
    const relationshipContext = getRelationshipContext(data, primaryCharacter, activeCharacters);
    const primaryCharState = data[CHARACTERS_KEY]?.[primaryCharacter];
    const emotionalInfo = {
        emotion: primaryCharState?.current_emotion || 'neutral',
        fromMessages: primaryCharState?.emotion_from_messages || null,
    };

    // Format and inject
    const formattedContext = formatContextForInjection(
        relevantMemories,
        relationshipContext,
        emotionalInfo,
        headerName,
        settings.tokenBudget
    );

    if (formattedContext) {
        injectContext(formattedContext);
    }

    return { memories: relevantMemories, context: formattedContext };
}

/**
 * Retrieve relevant context and inject into prompt
 * @returns {Promise<{memories: Object[], context: string}|null>}
 */
export async function retrieveAndInjectContext() {
    if (!isExtensionEnabled()) {
        log('OpenVault disabled, skipping retrieval');
        return null;
    }

    const settings = extension_settings[extensionName];
    const context = getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) {
        log('No chat to retrieve context for');
        return null;
    }

    const data = getOpenVaultData();
    if (!data) {
        log('No chat context available');
        return null;
    }
    const memories = data[MEMORIES_KEY] || [];

    if (memories.length === 0) {
        log('No memories stored yet');
        return null;
    }

    setStatus('retrieving');

    try {
        const activeCharacters = getActiveCharacters();
        const { povCharacters, isGroupChat } = getPOVContext();

        // Filter memories by POV
        const accessibleMemories = filterMemoriesByPOV(memories, povCharacters, data);
        log(`POV filter: mode=${isGroupChat ? 'group' : 'narrator'}, characters=[${povCharacters.join(', ')}], total=${memories.length}, accessible=${accessibleMemories.length}`);

        // Fallback to all memories if POV filter is too strict
        let memoriesToUse = accessibleMemories;
        if (accessibleMemories.length === 0 && memories.length > 0) {
            log('POV filter returned 0 results, using all memories as fallback');
            memoriesToUse = memories;
        }

        if (memoriesToUse.length === 0) {
            log('No memories available');
            setStatus('ready');
            return null;
        }

        const primaryCharacter = isGroupChat ? povCharacters[0] : context.name2;
        const headerName = isGroupChat ? primaryCharacter : 'Scene';
        const recentMessages = chat.filter(m => !m.is_system).map(m => m.mes).join('\n');

        const result = await selectFormatAndInject(
            memoriesToUse, data, recentMessages, primaryCharacter, activeCharacters, headerName, settings
        );

        if (!result) {
            log('No relevant memories found');
            setStatus('ready');
            return null;
        }

        log(`Injected ${result.memories.length} memories into context`);
        showToast('success', `Retrieved ${result.memories.length} relevant memories`);
        setStatus('ready');
        return result;
    } catch (error) {
        console.error('[OpenVault] Retrieval error:', error);
        setStatus('error');
        return null;
    }
}

/**
 * Update the injection (for automatic mode)
 * This rebuilds and re-injects context based on current state
 * @param {string} pendingUserMessage - Optional user message not yet in chat
 */
export async function updateInjection(pendingUserMessage = '') {
    // Clear injection if disabled or not in automatic mode
    if (!isAutomaticMode()) {
        safeSetExtensionPrompt('');
        return;
    }

    const settings = extension_settings[extensionName];
    const context = getContext();
    if (!context.chat || context.chat.length === 0) {
        safeSetExtensionPrompt('');
        return;
    }

    const data = getOpenVaultData();
    if (!data) {
        safeSetExtensionPrompt('');
        return;
    }
    const memories = data[MEMORIES_KEY] || [];

    if (memories.length === 0) {
        safeSetExtensionPrompt('');
        return;
    }

    const activeCharacters = getActiveCharacters();
    const { povCharacters, isGroupChat } = getPOVContext();

    // Filter memories by POV
    const accessibleMemories = filterMemoriesByPOV(memories, povCharacters, data);

    // Exclude memories from recent messages (they're still in context)
    const recentMessageIds = new Set(context.chat.map((m, idx) => idx).slice(-RECENT_MESSAGE_BUFFER));
    const nonRecentMemories = accessibleMemories.filter(m => {
        if (!m.message_ids || m.message_ids.length === 0) return true;
        const allSourcesRecent = m.message_ids.every(id => recentMessageIds.has(id));
        if (allSourcesRecent) {
            log(`Excluding recent memory: "${m.summary?.substring(0, 40)}..." (from messages ${m.message_ids.join(',')})`);
            return false;
        }
        return true;
    });

    // Exclude memories from the most recent extraction batch
    const lastBatchId = data[LAST_BATCH_KEY];
    const nonBatchMemories = nonRecentMemories.filter(m => {
        if (lastBatchId && m.batch_id === lastBatchId) {
            log(`Excluding last-batch memory: "${m.summary?.substring(0, 40)}..." (batch: ${m.batch_id})`);
            return false;
        }
        return true;
    });

    log(`Retrieval: ${accessibleMemories.length} accessible, ${nonRecentMemories.length} after recent filter, ${nonBatchMemories.length} after batch filter`);

    // Fallback to all memories if filters are too strict
    let memoriesToUse = nonBatchMemories;
    if (nonBatchMemories.length === 0 && memories.length > 0) {
        log('Injection: All memories filtered out (POV, recency, or batch), using all memories as fallback');
        memoriesToUse = memories;
    }

    if (memoriesToUse.length === 0) {
        safeSetExtensionPrompt('');
        return;
    }

    const primaryCharacter = isGroupChat ? povCharacters[0] : context.name2;
    const headerName = isGroupChat ? primaryCharacter : 'Scene';

    // Build chat context, optionally including pending user message
    let recentMessages = context.chat.filter(m => !m.is_system).map(m => m.mes).join('\n');
    if (pendingUserMessage) {
        recentMessages = recentMessages + '\n\n[User is about to say]: ' + pendingUserMessage;
        log(`Including pending user message in retrieval context`);
    }

    const result = await selectFormatAndInject(
        memoriesToUse, data, recentMessages, primaryCharacter, activeCharacters, headerName, settings
    );

    if (!result) {
        safeSetExtensionPrompt('');
        return;
    }

    log(`Injection updated: ${result.memories.length} memories`);
}
