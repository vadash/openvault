/**
 * OpenVault Memory Retrieval
 *
 * Main retrieval logic for selecting and injecting memories into context.
 * Returns result objects; callers handle UI feedback (toasts, status).
 */

/**
 * RetrievalContext - Consolidated retrieval parameters
 *
 * @typedef {Object} RetrievalContext
 * @property {string} recentContext - Recent messages for BM25 matching
 * @property {string} userMessages - Last 3 user messages for embedding (capped at 1000 chars)
 * @property {number} chatLength - Current chat length for distance scoring
 * @property {string} primaryCharacter - POV character name
 * @property {string[]} activeCharacters - All active characters in scene
 * @property {string} headerName - Header for injection ("Scene" or character name)
 * @property {number} finalTokens - Final context token budget
 * @property {Object} graphNodes - Graph entity nodes for entity detection
 * @property {Object} graphEdges - Graph entity edges for corpus vocabulary
 * @property {Object[]} allAvailableMemories - All memories for expanded IDF corpus
 */

import { CHARACTERS_KEY, extensionName, MEMORIES_KEY } from '../constants.js';
import { getDeps } from '../deps.js';
import { getQueryEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
import { filterMemoriesByPOV, getActiveCharacters, getPOVContext } from '../pov.js';
import { getOpenVaultData } from '../utils/data.js';
import { logDebug, logError } from '../utils/logging.js';
import { isExtensionEnabled, safeSetExtensionPrompt } from '../utils/st-helpers.js';
import { cacheRetrievalDebug } from './debug-cache.js';
import { formatContextForInjection } from './formatting.js';
import { selectRelevantMemories } from './scoring.js';
import { retrieveWorldContext } from './world-context.js';

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
    return memories.filter((m) => {
        if (!m.message_ids?.length) return false;
        const minId = Math.min(...m.message_ids);
        return chat[minId]?.is_system;
    });
}

/**
 * Deduplicate memories by ID (reflections may share IDs with source memories)
 * @param {Object[]} memories - Memories to deduplicate
 * @returns {Object[]} Deduplicated memories
 */
function _deduplicateById(memories) {
    const seen = new Set();
    return memories.filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
    });
}

/**
 * Build retrieval context from current state
 * @param {Object} opts - Options
 * @param {string} [opts.pendingUserMessage] - User message not yet in chat
 * @returns {RetrievalContext}
 */
export function buildRetrievalContext(opts = {}) {
    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName];
    const context = deps.getContext();
    const chat = context.chat || [];
    const { povCharacters, isGroupChat } = getPOVContext();

    // Build recent context (all non-system messages)
    let recentContext = chat
        .filter((m) => !m.is_system)
        .map((m) => m.mes)
        .join('\n');
    if (opts.pendingUserMessage) {
        recentContext += '\n\n[User is about to say]: ' + opts.pendingUserMessage;
    }

    // Build user messages for embedding (last 3 user messages, capped at 1000 chars)
    let userMsgs = chat
        .filter((m) => !m.is_system && m.is_user)
        .slice(-3)
        .map((m) => m.mes);
    if (opts.pendingUserMessage) {
        userMsgs.push(opts.pendingUserMessage);
        userMsgs = userMsgs.slice(-3);
    }
    const userMessages = userMsgs.join('\n').slice(-1000);

    const primaryCharacter = isGroupChat ? povCharacters[0] : context.name2;

    const data = getOpenVaultData();

    return {
        recentContext,
        userMessages,
        chatLength: chat.length,
        primaryCharacter,
        activeCharacters: getActiveCharacters(),
        headerName: isGroupChat ? povCharacters[0] : 'Scene',
        finalTokens: settings.retrievalFinalTokens,
        worldContextBudget: settings.worldContextBudget,
        graphNodes: data?.graph?.nodes || {},
        graphEdges: data?.graph?.edges || {},
        allAvailableMemories: data?.[MEMORIES_KEY] || [], // Full memory list for IDF
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
        safeSetExtensionPrompt('', 'openvault_world');
        return;
    }

    if (safeSetExtensionPrompt(contextText)) {
        logDebug('Context injected into prompt');
    } else {
        logDebug('Failed to inject context');
    }
}

/**
 * Core retrieval logic: select relevant memories, format, and inject
 * @param {Object[]} memoriesToUse - Pre-filtered memories to select from
 * @param {Object} data - OpenVault data object
 * @param {RetrievalContext} ctx - Retrieval context
 * @returns {Promise<{memories: Object[], context: string}|null>}
 */
async function selectFormatAndInject(memoriesToUse, data, ctx) {
    const { primaryCharacter, activeCharacters, headerName, finalTokens, chatLength, userMessages } = ctx;

    const relevantMemories = await selectRelevantMemories(memoriesToUse, ctx);

    if (!relevantMemories || relevantMemories.length === 0) {
        // Clear world context if no memories found
        safeSetExtensionPrompt('', 'openvault_world');
        return null;
    }

    // Get emotional context
    const primaryCharState = data[CHARACTERS_KEY]?.[primaryCharacter];
    const emotionalInfo = {
        emotion: primaryCharState?.current_emotion || 'neutral',
        fromMessages: primaryCharState?.emotion_from_messages || null,
    };

    // Get present characters (excluding POV)
    const presentCharacters = activeCharacters.filter((c) => c !== primaryCharacter);

    // Format and inject memories
    const formattedContext = formatContextForInjection(
        relevantMemories,
        presentCharacters,
        emotionalInfo,
        headerName,
        finalTokens,
        chatLength
    );

    if (formattedContext) {
        injectContext(formattedContext);
    }

    // Cache injected context for debug export
    cacheRetrievalDebug({
        injectedContext: formattedContext,
        selectedCount: relevantMemories.length,
        eventsCount: relevantMemories.filter((m) => m.type !== 'reflection').length,
        reflectionsCount: relevantMemories.filter((m) => m.type === 'reflection').length,
    });

    // Inject world context from community summaries
    const worldCommunities = data.communities;
    if (worldCommunities && Object.keys(worldCommunities).length > 0) {
        let worldQueryEmbedding = null;
        if (isEmbeddingsEnabled()) {
            worldQueryEmbedding = await getQueryEmbedding(userMessages || ctx.recentContext?.slice(-500));
        }
        if (worldQueryEmbedding) {
            const worldResult = retrieveWorldContext(
                worldCommunities,
                data.global_world_state || null,
                userMessages || '',
                worldQueryEmbedding,
                ctx.worldContextBudget
            );
            safeSetExtensionPrompt(worldResult.text, 'openvault_world');
            // Cache world context result for debug export
            if (worldResult?.text) {
                cacheRetrievalDebug({
                    injectedWorldContext: worldResult.text,
                    isMacroIntent: worldResult.isMacroIntent,
                });
            }
        } else {
            safeSetExtensionPrompt('', 'openvault_world');
        }
    } else {
        safeSetExtensionPrompt('', 'openvault_world');
    }

    return { memories: relevantMemories, context: formattedContext };
}

/**
 * Retrieve relevant context and inject into prompt
 * @returns {Promise<{memories: Object[], context: string}|null>}
 */
export async function retrieveAndInjectContext() {
    if (!isExtensionEnabled()) {
        logDebug('OpenVault disabled, skipping retrieval');
        safeSetExtensionPrompt('', 'openvault_world');
        return null;
    }

    const deps = getDeps();
    const context = deps.getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) {
        logDebug('No chat to retrieve context for');
        safeSetExtensionPrompt('', 'openvault_world');
        return null;
    }

    const data = getOpenVaultData();
    if (!data) {
        logDebug('No chat context available');
        safeSetExtensionPrompt('', 'openvault_world');
        return null;
    }
    const memories = data[MEMORIES_KEY] || [];

    if (memories.length === 0) {
        logDebug('No memories stored yet');
        safeSetExtensionPrompt('', 'openvault_world');
        return null;
    }

    try {
        const { povCharacters, isGroupChat } = getPOVContext();

        // Filter to memories from hidden messages only (visible messages are already in context)
        const hiddenMemories = _getHiddenMemories(chat, memories);
        // Include reflections (which have no message_ids) in candidate set
        const reflections = memories.filter((m) => m.type === 'reflection');
        const candidateMemories = _deduplicateById([...hiddenMemories, ...reflections]);

        // Filter memories by POV
        const accessibleMemories = filterMemoriesByPOV(candidateMemories, povCharacters, data);
        logDebug(
            `Retrieval filter: total=${memories.length}, hidden=${hiddenMemories.length}, reflections=${reflections.length}, pov=${accessibleMemories.length} (mode=${isGroupChat ? 'group' : 'narrator'}, chars=[${povCharacters.join(', ')}])`
        );

        // Cache filter stats for debug export
        cacheRetrievalDebug({
            filters: {
                totalMemories: memories.length,
                hiddenMemories: hiddenMemories.length,
                afterPOVFilter: accessibleMemories.length,
            },
            povCharacters,
        });

        // Fallback to hidden memories if POV filter is too strict
        let memoriesToUse = accessibleMemories;
        if (accessibleMemories.length === 0 && hiddenMemories.length > 0) {
            logDebug('POV filter returned 0 results, using all hidden memories as fallback');
            memoriesToUse = hiddenMemories;
        }

        if (memoriesToUse.length === 0) {
            logDebug('No memories available');
            safeSetExtensionPrompt('', 'openvault_world');
            return null;
        }

        const ctx = buildRetrievalContext();

        // Cache retrieval context for debug export
        cacheRetrievalDebug({
            retrievalContext: {
                userMessages: ctx.userMessages,
                chatLength: ctx.chatLength,
                primaryCharacter: ctx.primaryCharacter,
                activeCharacters: ctx.activeCharacters,
                tokenBudget: ctx.finalTokens,
                worldContextBudget: ctx.worldContextBudget,
            },
        });

        const result = await selectFormatAndInject(memoriesToUse, data, ctx);

        if (!result) {
            logDebug('No relevant memories found');
            safeSetExtensionPrompt('', 'openvault_world');
            return null;
        }

        logDebug(`Injected ${result.memories.length} memories into context`);
        return result;
    } catch (error) {
        const chatLength = chat?.length || 0;
        const povCharacters = getPOVContext().povCharacters;
        logError('Retrieval error', error, { chatLength, povCharacters });
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
    if (!isExtensionEnabled()) {
        safeSetExtensionPrompt('');
        safeSetExtensionPrompt('', 'openvault_world');
        return;
    }

    const deps = getDeps();
    const context = deps.getContext();
    if (!context.chat || context.chat.length === 0) {
        safeSetExtensionPrompt('');
        safeSetExtensionPrompt('', 'openvault_world');
        return;
    }

    const data = getOpenVaultData();
    if (!data) {
        safeSetExtensionPrompt('');
        safeSetExtensionPrompt('', 'openvault_world');
        return;
    }
    const memories = data[MEMORIES_KEY] || [];

    if (memories.length === 0) {
        safeSetExtensionPrompt('');
        safeSetExtensionPrompt('', 'openvault_world');
        return;
    }

    const { povCharacters } = getPOVContext();

    // Filter to memories from hidden messages only (visible messages are already in context)
    const hiddenMemories = _getHiddenMemories(context.chat, memories);
    // Include reflections (which have no message_ids) in candidate set
    const reflections = memories.filter((m) => m.type === 'reflection');
    const candidateMemories = _deduplicateById([...hiddenMemories, ...reflections]);

    // Filter memories by POV
    const accessibleMemories = filterMemoriesByPOV(candidateMemories, povCharacters, data);
    logDebug(
        `POV filter: ${memories.length} total -> ${hiddenMemories.length} hidden + ${reflections.length} reflections -> ${accessibleMemories.length} accessible`
    );

    // Fallback to candidate memories if POV filter is too strict
    let memoriesToUse = accessibleMemories;
    if (accessibleMemories.length === 0 && candidateMemories.length > 0) {
        logDebug('Injection: POV filter returned 0, using all candidate memories as fallback');
        memoriesToUse = candidateMemories;
    }

    if (memoriesToUse.length === 0) {
        safeSetExtensionPrompt('');
        safeSetExtensionPrompt('', 'openvault_world');
        return;
    }

    if (pendingUserMessage) {
        logDebug(`Including pending user message in retrieval context`);
    }

    const ctx = buildRetrievalContext({ pendingUserMessage });

    const result = await selectFormatAndInject(memoriesToUse, data, ctx);

    if (!result) {
        safeSetExtensionPrompt('');
        safeSetExtensionPrompt('', 'openvault_world');
        return;
    }

    logDebug(`Injection updated: ${result.memories.length} memories`);
}
