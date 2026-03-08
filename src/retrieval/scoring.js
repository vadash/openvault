/**
 * OpenVault Memory Scoring
 *
 * Algorithms for selecting relevant memories for retrieval.
 * Uses forgetfulness curve (exponential decay) and optional vector similarity.
 */

import { extensionName } from '../constants.js';
import { getDeps } from '../deps.js';
import { getQueryEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
import { log } from '../utils/logging.js';
import { sliceToTokenBudget } from '../utils/text.js';
import { cacheRetrievalDebug, cacheScoringDetails } from './debug-cache.js';
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
            BASE_LAMBDA: settings.forgetfulnessBaseLambda,
            IMPORTANCE_5_FLOOR: settings.forgetfulnessImportance5Floor,
            reflectionDecayThreshold: settings.reflectionDecayThreshold,
        },
        settings: {
            vectorSimilarityThreshold: settings.vectorSimilarityThreshold,
            alpha: settings.alpha,
            combinedBoostWeight: settings.combinedBoostWeight,
        },
    };
}

/**
 * Score memories (main-thread, async to allow yielding).
 * @param {Object[]} memories - Memories to score
 * @param {number[]|null} contextEmbedding - Context embedding
 * @param {number} chatLength - Current chat length
 * @param {number} limit - Maximum results
 * @param {string|string[]} queryTokens - Query text or pre-tokenized array for BM25
 * @param {string[]} [characterNames] - Main character names to filter from query tokens
 * @returns {Promise<{memories: Object[], scoredResults: Array<{memory: Object, score: number, breakdown: Object}>}>}
 */
async function scoreMemoriesDirect(memories, contextEmbedding, chatLength, limit, queryTokens, characterNames = []) {
    const { constants, settings } = getScoringParams();
    const scored = await scoreMemories(
        memories,
        contextEmbedding,
        chatLength,
        constants,
        settings,
        queryTokens,
        characterNames
    );
    const topScored = scored.slice(0, limit);
    return {
        memories: topScored.map((r) => r.memory),
        scoredResults: topScored,
    };
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
 * @returns {Promise<{memories: Object[], scoredResults: Array<{memory: Object, score: number, breakdown: Object}>}>}
 */
async function selectRelevantMemoriesSimple(memories, ctx, limit) {
    const { recentContext, userMessages, activeCharacters, chatLength } = ctx;

    // Extract context from recent messages for enriched queries
    const recentMessages = parseRecentMessages(recentContext, 10);
    const queryContext = extractQueryContext(recentMessages, activeCharacters, ctx.graphNodes || {});

    // Build enriched queries
    // Use user messages only for embedding (intent matching)
    const userMessagesForEmbedding = parseRecentMessages(userMessages, 3);
    const embeddingQuery = buildEmbeddingQuery(userMessagesForEmbedding, queryContext);
    const bm25Tokens = buildBM25Tokens(userMessages, queryContext);

    // Cache query context for debug export
    cacheRetrievalDebug({
        queryContext: {
            entities: queryContext.entities,
            embeddingQuery: embeddingQuery,
            bm25TokenCount: Array.isArray(bm25Tokens) ? bm25Tokens.length : 0,
        },
    });

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

    return scoreMemoriesDirect(memories, contextEmbedding, chatLength, limit, bm25Tokens, activeCharacters || []);
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
    // Skip archived reflections in retrieval
    const activeMemories = memories.filter((m) => !m.archived);
    const { finalTokens } = ctx;
    const { memories: scoredMemories, scoredResults } = await selectRelevantMemoriesSimple(activeMemories, ctx, 1000);
    const finalResults = sliceToTokenBudget(scoredMemories, finalTokens);
    const selectedIds = new Set(finalResults.map((m) => m.id));

    // Cache scoring details for debug export
    cacheScoringDetails(scoredResults, selectedIds);

    // Increment retrieval_hits counter for each selected memory
    // Mutates in-place; next save cycle will persist the counter
    for (const memory of finalResults) {
        memory.retrieval_hits = (memory.retrieval_hits || 0) + 1;
    }

    log(
        `Retrieval: ${activeMemories.length} active memories -> ${scoredMemories.length} scored -> ${finalResults.length} after token filter (${finalTokens} budget)`
    );
    return finalResults;
}
