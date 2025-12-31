/**
 * OpenVault Memory Scoring
 *
 * Algorithms for selecting relevant memories for retrieval.
 * Uses forgetfulness curve (exponential decay) and optional vector similarity.
 */

import { getDeps } from '../deps.js';
import { log, parseJsonFromMarkdown } from '../utils.js';
import { extensionName, FORGETFULNESS } from '../constants.js';
import { callLLMForRetrieval } from '../llm.js';
import { buildSmartRetrievalPrompt } from '../prompts.js';
import { getEmbedding, cosineSimilarity, isEmbeddingsEnabled } from '../embeddings.js';

/**
 * Select relevant memories using forgetfulness curve scoring
 * @param {Object[]} memories - Available memories
 * @param {string} recentContext - Recent chat context
 * @param {string} characterName - POV character name (unused, kept for API compatibility)
 * @param {string[]} activeCharacters - List of active characters (unused, kept for API compatibility)
 * @param {number} limit - Maximum memories to return
 * @param {number} chatLength - Current chat length (for distance calculation)
 * @returns {Promise<Object[]>} Selected memories
 */
export async function selectRelevantMemoriesSimple(memories, recentContext, characterName, activeCharacters, limit, chatLength) {
    const settings = getDeps().getExtensionSettings()[extensionName];

    // Get embedding for current context if enabled
    let contextEmbedding = null;
    if (isEmbeddingsEnabled()) {
        // Use last ~500 chars of context for embedding
        const contextSnippet = recentContext.slice(-500);
        contextEmbedding = await getEmbedding(contextSnippet);
    }

    const scored = memories.map(memory => {
        // === Forgetfulness Curve ===
        // Use message distance (narrative time) instead of timestamp
        const messageIds = memory.message_ids || [0];
        const maxMessageId = Math.max(...messageIds);
        const distance = Math.max(0, chatLength - maxMessageId);

        // Get importance (1-5, default 3)
        const importance = memory.importance || 3;

        // Calculate lambda: higher importance = slower decay
        // importance 5 -> lambda = 0.05 / 25 = 0.002 (very slow decay)
        // importance 1 -> lambda = 0.05 / 1  = 0.05  (fast decay)
        const lambda = FORGETFULNESS.BASE_LAMBDA / (importance * importance);

        // Core forgetfulness formula: Score = Importance × e^(-λ × Distance)
        let score = importance * Math.exp(-lambda * distance);

        // Importance-5 floor: never drops below minimum score
        if (importance === 5) {
            score = Math.max(score, FORGETFULNESS.IMPORTANCE_5_FLOOR);
        }

        // === Vector Similarity Bonus ===
        if (contextEmbedding && memory.embedding) {
            const similarity = cosineSimilarity(contextEmbedding, memory.embedding);
            const threshold = settings.vectorSimilarityThreshold || 0.5;
            const maxBonus = settings.vectorSimilarityWeight || 15;

            if (similarity > threshold) {
                // Scale similarity above threshold to bonus points
                // e.g., similarity 0.75 with threshold 0.5 -> (0.75-0.5)/(1-0.5) = 0.5 -> 7.5 points
                const normalizedSim = (similarity - threshold) / (1 - threshold);
                score += normalizedSim * maxBonus;
            }
        }

        return { memory, score };
    });

    // Sort by score (highest first) and take top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.memory);
}

/**
 * Select relevant memories using LLM (smart mode)
 * @param {Object[]} memories - Available memories to select from
 * @param {string} recentContext - Recent chat context
 * @param {string} characterName - POV character name
 * @param {number} limit - Maximum memories to select
 * @param {number} chatLength - Current chat length (for fallback distance calculation)
 * @returns {Promise<Object[]>} - Selected memories
 */
export async function selectRelevantMemoriesSmart(memories, recentContext, characterName, limit, chatLength) {
    if (memories.length === 0) return [];
    if (memories.length <= limit) return memories; // No need to select if we have few enough

    log(`Smart retrieval: analyzing ${memories.length} memories to select ${limit} most relevant`);

    // Build numbered list of memories with importance
    const numberedList = memories.map((m, i) => {
        const typeTag = `[${m.event_type || 'event'}]`;
        const importance = m.importance || 3;
        const importanceTag = `[\u2605${'\u2605'.repeat(importance - 1)}]`; // Show 1-5 stars
        const secretTag = m.is_secret ? '[Secret] ' : '';
        return `${i + 1}. ${typeTag} ${importanceTag} ${secretTag}${m.summary}`;
    }).join('\n');

    const prompt = buildSmartRetrievalPrompt(recentContext, numberedList, characterName, limit);

    try {
        // Call LLM for retrieval (uses retrieval profile, separate from extraction)
        const response = await callLLMForRetrieval(prompt);

        // Parse the response
        let parsed;
        try {
            parsed = parseJsonFromMarkdown(response);
        } catch (parseError) {
            log(`Smart retrieval: Failed to parse LLM response, falling back to simple mode. Error: ${parseError.message}`);
            return selectRelevantMemoriesSimple(memories, recentContext, characterName, [], limit, chatLength);
        }

        // Extract selected indices
        const selectedIndices = parsed.selected || [];
        if (!Array.isArray(selectedIndices) || selectedIndices.length === 0) {
            log('Smart retrieval: No memories selected by LLM, falling back to simple mode');
            return selectRelevantMemoriesSimple(memories, recentContext, characterName, [], limit, chatLength);
        }

        // Convert 1-indexed to 0-indexed and filter valid indices
        const selectedMemories = selectedIndices
            .map(i => memories[i - 1]) // Convert to 0-indexed
            .filter(m => m !== undefined);

        if (selectedMemories.length === 0) {
            log('Smart retrieval: Invalid indices from LLM, falling back to simple mode');
            return selectRelevantMemoriesSimple(memories, recentContext, characterName, [], limit, chatLength);
        }

        log(`Smart retrieval: LLM selected ${selectedMemories.length} memories. Reasoning: ${parsed.reasoning || 'none provided'}`);
        return selectedMemories;
    } catch (error) {
        log(`Smart retrieval error: ${error.message}, falling back to simple mode`);
        return selectRelevantMemoriesSimple(memories, recentContext, characterName, [], limit, chatLength);
    }
}

/**
 * Select relevant memories using LLM or simple matching (dispatcher)
 * Uses smart retrieval if enabled in settings
 * @param {Object[]} memories - Available memories
 * @param {string} recentContext - Recent chat context
 * @param {string} characterName - POV character name
 * @param {string[]} activeCharacters - List of active characters
 * @param {number} limit - Maximum memories to return
 * @param {number} chatLength - Current chat length (for distance calculation)
 * @returns {Promise<Object[]>} Selected memories
 */
export async function selectRelevantMemories(memories, recentContext, characterName, activeCharacters, limit, chatLength) {
    const settings = getDeps().getExtensionSettings()[extensionName];

    if (settings.smartRetrievalEnabled) {
        return selectRelevantMemoriesSmart(memories, recentContext, characterName, limit, chatLength);
    } else {
        return selectRelevantMemoriesSimple(memories, recentContext, characterName, activeCharacters, limit, chatLength);
    }
}
