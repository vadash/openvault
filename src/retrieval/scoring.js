/**
 * OpenVault Memory Scoring
 *
 * Algorithms for selecting relevant memories for retrieval.
 * Uses forgetfulness curve (exponential decay) and optional vector similarity.
 */

import { extensionName } from '../constants.js';
import { getDeps } from '../deps.js';
import { getQueryEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
import { log, sliceToTokenBudget } from '../utils.js';
import { scoreMemories } from './math.js';
import { buildBM25Tokens, buildEmbeddingQuery, extractQueryContext, parseRecentMessages } from './query-context.js';

/**
 * Build scoring parameters from extension settings
 * @returns {{constants: Object, settings: Object}}
 */
export function getScoringParams() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    return {
        constants: {
            BASE_LAMBDA: settings.forgetfulnessBaseLambda ?? 0.05,
            IMPORTANCE_5_FLOOR: settings.forgetfulnessImportance5Floor ?? 5,
        },
        settings: {
            vectorSimilarityThreshold: settings.vectorSimilarityThreshold,
            alpha: settings.alpha ?? 0.7,
            combinedBoostWeight: settings.combinedBoostWeight ?? 15,
        },
    };
}

/**
 * Score memories synchronously (main-thread).
 * @param {Object[]} memories - Memories to score
 * @param {number[]|null} contextEmbedding - Context embedding
 * @param {number} chatLength - Current chat length
 * @param {number} limit - Maximum results
 * @param {string|string[]} queryTokens - Query text or pre-tokenized array for BM25
 */
function scoreMemoriesDirect(memories, contextEmbedding, chatLength, limit, queryTokens) {
    const { constants, settings } = getScoringParams();
    const scored = scoreMemories(memories, contextEmbedding, chatLength, constants, settings, queryTokens);
    return scored.slice(0, limit).map((r) => r.memory);
}

/**
 * Select relevant memories using forgetfulness curve scoring
 * @param {Object[]} memories - Available memories
 * @param {Object} ctx - Retrieval context object
 * @param {string} ctx.recentContext - Recent chat context (for query context extraction)
 * @param {string} ctx.userMessages - Last 3 user messages for embedding (capped at 1000 chars)
 * @param {string[]} ctx.activeCharacters - List of active characters for entity extraction
 * @param {number} ctx.chatLength - Current chat length (for distance calculation)
 * @param {number} limit - Maximum memories to return
 * @returns {Promise<Object[]>} Selected memories
 */
async function selectRelevantMemoriesSimple(memories, ctx, limit) {
    const { recentContext, userMessages, activeCharacters, chatLength } = ctx;

    // Extract context from recent messages for enriched queries
    const recentMessages = parseRecentMessages(recentContext, 10);
    const queryContext = extractQueryContext(recentMessages, activeCharacters);

    // Build enriched queries
    // Use user messages only for embedding (intent matching)
    const userMessagesForEmbedding = parseRecentMessages(userMessages, 3);
    const embeddingQuery = buildEmbeddingQuery(userMessagesForEmbedding, queryContext);
    const bm25Tokens = buildBM25Tokens(userMessages, queryContext);

    // Log extracted entities for debugging
    if (queryContext.entities.length > 0 || embeddingQuery) {
        log(
            `Query context: entities=[${queryContext.entities.join(', ')}], embeddingQuery="${embeddingQuery?.slice(0, 100)}${embeddingQuery?.length > 100 ? '...' : ''}"`
        );
    }

    // Get embedding for enriched query if enabled
    let contextEmbedding = null;
    if (isEmbeddingsEnabled() && embeddingQuery) {
        contextEmbedding = await getQueryEmbedding(embeddingQuery);
    }

    return scoreMemoriesDirect(memories, contextEmbedding, chatLength, limit, bm25Tokens);
}

/**
 * Select relevant memories using scoring and token budget
 * @param {Object[]} memories - Available memories
 * @param {Object} ctx - Retrieval context object
 * @param {string} ctx.recentContext - Recent chat context
 * @param {string} ctx.userMessages - Last 3 user messages for embedding
 * @param {string[]} ctx.activeCharacters - List of active characters
 * @param {number} ctx.chatLength - Current chat length (for distance calculation)
 * @param {number} ctx.finalTokens - Final context token budget
 * @returns {Promise<Object[]>} Selected memories
 */
export async function selectRelevantMemories(memories, ctx) {
    if (!memories || memories.length === 0) return [];
    const { finalTokens } = ctx;
    const scored = await selectRelevantMemoriesSimple(memories, ctx, 1000);
    const finalResults = sliceToTokenBudget(scored, finalTokens);
    log(
        `Retrieval: ${memories.length} memories -> ${scored.length} scored -> ${finalResults.length} after token filter (${finalTokens} budget)`
    );
    return finalResults;
}
