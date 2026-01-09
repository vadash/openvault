/**
 * OpenVault Memory Retrieval
 *
 * Main retrieval logic for selecting and injecting memories into context.
 * Returns result objects; callers handle UI feedback (toasts, status).
 */

import { getDeps } from '../deps.js';
import { getOpenVaultData, safeSetExtensionPrompt, log, isExtensionEnabled, isAutomaticMode } from '../utils.js';
import { extensionName, MEMORIES_KEY, CHARACTERS_KEY } from '../constants.js';
import { getActiveCharacters, getPOVContext, filterMemoriesByPOV } from '../pov.js';
import { selectRelevantMemories } from './scoring.js';
import { getRelationshipContext, formatContextForInjection } from './formatting.js';

/**
 * Get memories from hidden (system) messages that need retrieval
 * Memories from visible messages are already in context and don't need injection.
 *
 * Uses MIN message_id check: memory is injectable once the oldest message in its
 * batch is hidden. This is more aggressive than checking all message_ids, allowing
 * earlier injection with minimal overlap risk.
 *
 * @param {Object[]} chat - Chat messages array
 * @param {Object[]} memories - All memories
 * @returns {Object[]} Memories whose oldest source message is hidden
 */
function _getHiddenMemories(chat, memories) {
    return memories.filter(m => {
        if (!m.message_ids?.length) return false;
        const minId = Math.min(...m.message_ids);
        return chat[minId]?.is_system;
    });
}

/**
 * Build retrieval context from current state
 * @param {Object} opts - Options
 * @param {string} [opts.pendingUserMessage] - User message not yet in chat
 * @returns {import('./context.js').RetrievalContext}
 */
export function buildRetrievalContext(opts = {}) {
    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName];
    const context = deps.getContext();
    const chat = context.chat || [];
    const { povCharacters, isGroupChat } = getPOVContext();

    // Build recent context (all non-system messages)
    let recentContext = chat.filter(m => !m.is_system).map(m => m.mes).join('\n');
    if (opts.pendingUserMessage) {
        recentContext += '\n\n[User is about to say]: ' + opts.pendingUserMessage;
    }

    // Build user messages for embedding (last 3 user messages, capped at 1000 chars)
    let userMsgs = chat.filter(m => !m.is_system && m.is_user).slice(-3).map(m => m.mes);
    if (opts.pendingUserMessage) {
        userMsgs.push(opts.pendingUserMessage);
        userMsgs = userMsgs.slice(-3);
    }
    const userMessages = userMsgs.join('\n').slice(-1000);

    const primaryCharacter = isGroupChat ? povCharacters[0] : context.name2;

    return {
        recentContext,
        userMessages,
        chatLength: chat.length,
        primaryCharacter,
        activeCharacters: getActiveCharacters(),
        headerName: isGroupChat ? povCharacters[0] : 'Scene',
        preFilterTokens: settings.retrievalPreFilterTokens || 24000,
        finalTokens: settings.retrievalFinalTokens || 12000,
        smartRetrievalEnabled: settings.smartRetrievalEnabled,
    };
}

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
 * @param {string} userMessages - Last 3 user messages for embedding (capped at 1000 chars)
 * @param {string} primaryCharacter - Primary character for formatting
 * @param {string[]} activeCharacters - All active characters
 * @param {string} headerName - Header name for injection
 * @param {Object} settings - Extension settings
 * @param {number} chatLength - Current chat length (for distance calculation)
 * @returns {Promise<{memories: Object[], context: string}|null>}
 */
async function selectFormatAndInject(memoriesToUse, data, recentMessages, userMessages, primaryCharacter, activeCharacters, headerName, settings, chatLength) {
    const relevantMemories = await selectRelevantMemories(
        memoriesToUse,
        recentMessages,
        userMessages,
        primaryCharacter,
        activeCharacters,
        settings,  // Pass settings object for token budgets
        chatLength
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
        settings.retrievalFinalTokens,
        chatLength
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

    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName];
    const context = deps.getContext();
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

    try {
        const activeCharacters = getActiveCharacters();
        const { povCharacters, isGroupChat } = getPOVContext();

        // Filter to memories from hidden messages only (visible messages are already in context)
        const hiddenMemories = _getHiddenMemories(chat, memories);

        // Filter memories by POV
        const accessibleMemories = filterMemoriesByPOV(hiddenMemories, povCharacters, data);
        log(`Retrieval filter: total=${memories.length}, hidden=${hiddenMemories.length}, pov=${accessibleMemories.length} (mode=${isGroupChat ? 'group' : 'narrator'}, chars=[${povCharacters.join(', ')}])`);

        // Fallback to hidden memories if POV filter is too strict
        let memoriesToUse = accessibleMemories;
        if (accessibleMemories.length === 0 && hiddenMemories.length > 0) {
            log('POV filter returned 0 results, using all hidden memories as fallback');
            memoriesToUse = hiddenMemories;
        }

        if (memoriesToUse.length === 0) {
            log('No memories available');
            return null;
        }

        const primaryCharacter = isGroupChat ? povCharacters[0] : context.name2;
        const headerName = isGroupChat ? primaryCharacter : 'Scene';
        const recentMessages = chat.filter(m => !m.is_system).map(m => m.mes).join('\n');
        // Extract last 3 user messages for embedding (user intent matters most)
        const userMessages = chat.filter(m => !m.is_system && m.is_user).slice(-3).map(m => m.mes).join('\n').slice(-1000);
        const chatLength = chat.length;

        const result = await selectFormatAndInject(
            memoriesToUse, data, recentMessages, userMessages, primaryCharacter, activeCharacters, headerName, settings, chatLength
        );

        if (!result) {
            log('No relevant memories found');
            return null;
        }

        log(`Injected ${result.memories.length} memories into context`);
        return result;
    } catch (error) {
        getDeps().console.error('[OpenVault] Retrieval error:', error);
        throw error;
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

    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName];
    const context = deps.getContext();
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

    // Filter to memories from hidden messages only (visible messages are already in context)
    const hiddenMemories = _getHiddenMemories(context.chat, memories);

    // Filter memories by POV
    const accessibleMemories = filterMemoriesByPOV(hiddenMemories, povCharacters, data);
    log(`Stage 0: ${memories.length} total -> ${hiddenMemories.length} hidden -> ${accessibleMemories.length} after POV filter`);

    // Fallback to hidden memories if POV filter is too strict
    let memoriesToUse = accessibleMemories;
    if (accessibleMemories.length === 0 && hiddenMemories.length > 0) {
        log('Injection: POV filter returned 0, using all hidden memories as fallback');
        memoriesToUse = hiddenMemories;
    }

    if (memoriesToUse.length === 0) {
        safeSetExtensionPrompt('');
        return;
    }

    const primaryCharacter = isGroupChat ? povCharacters[0] : context.name2;
    const headerName = isGroupChat ? primaryCharacter : 'Scene';
    const chatLength = context.chat.length;

    // Build chat context, optionally including pending user message
    let recentMessages = context.chat.filter(m => !m.is_system).map(m => m.mes).join('\n');
    if (pendingUserMessage) {
        recentMessages = recentMessages + '\n\n[User is about to say]: ' + pendingUserMessage;
        log(`Including pending user message in retrieval context`);
    }

    // Extract last 3 user messages for embedding (user intent matters most)
    let userMsgs = context.chat.filter(m => !m.is_system && m.is_user).slice(-3).map(m => m.mes);
    if (pendingUserMessage) {
        userMsgs.push(pendingUserMessage);
        userMsgs = userMsgs.slice(-3); // Keep only last 3
    }
    const userMessages = userMsgs.join('\n').slice(-1000);

    const result = await selectFormatAndInject(
        memoriesToUse, data, recentMessages, userMessages, primaryCharacter, activeCharacters, headerName, settings, chatLength
    );

    if (!result) {
        safeSetExtensionPrompt('');
        return;
    }

    log(`Injection updated: ${result.memories.length} memories`);
}
