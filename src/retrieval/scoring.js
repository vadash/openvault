/**
 * OpenVault Memory Scoring
 *
 * Algorithms for selecting relevant memories for retrieval.
 * Uses forgetfulness curve (exponential decay) and optional vector similarity.
 */

import { extensionName } from '../constants.js';
import { getDeps } from '../deps.js';
import { getQueryEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
import { parseRetrievalResponse } from '../extraction/structured.js';
import { callLLMForRetrieval } from '../llm.js';
import { buildSmartRetrievalPrompt } from '../prompts.js';
import { estimateTokens, log, sliceToTokenBudget } from '../utils.js';
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
            // Keep old keys for any code that still reads them during transition
            vectorSimilarityWeight: settings.vectorSimilarityWeight,
            keywordMatchWeight: settings.keywordMatchWeight ?? 1.0,
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
export async function selectRelevantMemoriesSimple(memories, ctx, limit) {
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
 * Select relevant memories using LLM (smart mode)
 * @param {Object[]} memories - Available memories to select from
 * @param {Object} ctx - Retrieval context object
 * @param {string} ctx.recentContext - Recent chat context
 * @param {string} ctx.userMessages - Last 3 user messages for embedding fallback
 * @param {string} ctx.primaryCharacter - POV character name
 * @param {string[]} ctx.activeCharacters - List of active characters (for fallback)
 * @param {number} ctx.chatLength - Current chat length (for fallback distance calculation)
 * @param {number} limit - Maximum memories to select
 * @returns {Promise<Object[]>} - Selected memories
 */
export async function selectRelevantMemoriesSmart(memories, ctx, limit) {
    const { recentContext, primaryCharacter } = ctx;

    if (memories.length === 0) return [];
    if (memories.length <= limit) return memories; // No need to select if we have few enough

    log(`Smart retrieval: analyzing ${memories.length} memories to select ${limit} most relevant`);

    // Build numbered list of memories with importance
    const numberedList = memories
        .map((m, i) => {
            const importance = m.importance || 3;
            const importanceTag = `[\u2605${'\u2605'.repeat(importance - 1)}]`; // Show 1-5 stars
            const secretTag = m.is_secret ? '[Secret] ' : '';
            return `${i + 1}. ${importanceTag} ${secretTag}${m.summary}`;
        })
        .join('\n');

    const prompt = buildSmartRetrievalPrompt(recentContext, numberedList, primaryCharacter, limit);

    try {
        // Call LLM for retrieval with structured output enabled
        const response = await callLLMForRetrieval(prompt, { structured: true });

        // Parse the response using Zod schema validation
        const parsed = parseRetrievalResponse(response);

        // Extract selected indices
        const selectedIndices = parsed.selected || [];
        if (!Array.isArray(selectedIndices) || selectedIndices.length === 0) {
            log('Smart retrieval: No memories selected by LLM, falling back to simple mode');
            return selectRelevantMemoriesSimple(memories, ctx, limit);
        }

        // Convert 1-indexed to 0-indexed and filter valid indices
        const selectedMemories = selectedIndices
            .map((i) => memories[i - 1]) // Convert to 0-indexed
            .filter((m) => m !== undefined);

        if (selectedMemories.length === 0) {
            log('Smart retrieval: Invalid indices from LLM, falling back to simple mode');
            return selectRelevantMemoriesSimple(memories, ctx, limit);
        }

        log(
            `Smart retrieval: LLM selected ${selectedMemories.length} memories. Reasoning: ${parsed.reasoning || 'none provided'}`
        );
        return selectedMemories;
    } catch (error) {
        log(`Smart retrieval error: ${error.message}, falling back to simple mode`);
        return selectRelevantMemoriesSimple(memories, ctx, limit);
    }
}

/**
 * Select relevant memories using scoring and token budget
 * - Simple mode: Score and slice to final budget in one pass
 * - Smart mode: Two-stage pipeline with LLM selection
 * @param {Object[]} memories - Available memories
 * @param {Object} ctx - Retrieval context object
 * @param {string} ctx.recentContext - Recent chat context
 * @param {string} ctx.userMessages - Last 3 user messages for embedding
 * @param {string} ctx.primaryCharacter - POV character name
 * @param {string[]} ctx.activeCharacters - List of active characters
 * @param {number} ctx.chatLength - Current chat length (for distance calculation)
 * @param {number} ctx.preFilterTokens - Smart mode pre-filter token budget
 * @param {number} ctx.finalTokens - Final context token budget
 * @param {boolean} ctx.smartRetrievalEnabled - Whether to use LLM-based smart retrieval
 * @returns {Promise<Object[]>} Selected memories
 */
export async function selectRelevantMemories(memories, ctx) {
    if (!memories || memories.length === 0) return [];

    const { preFilterTokens, finalTokens, smartRetrievalEnabled } = ctx;

    // Get scored results (pass high count limit, we'll token-slice after)
    const scored = await selectRelevantMemoriesSimple(
        memories,
        ctx,
        1000 // High count limit - we'll apply token budget after
    );

    if (smartRetrievalEnabled) {
        // Smart mode: Two-stage pipeline
        // Stage 1: Pre-filter to give LLM a manageable pool
        const stage1Results = sliceToTokenBudget(scored, preFilterTokens);
        log(
            `Stage 1: ${memories.length} memories -> ${scored.length} scored -> ${stage1Results.length} after token filter (${preFilterTokens} budget)`
        );

        if (stage1Results.length === 0) return [];

        // Stage 2: LLM selection
        const totalStage1Tokens = stage1Results.reduce((sum, m) => sum + estimateTokens(m.summary), 0);
        const avgMemoryCost = totalStage1Tokens / stage1Results.length;
        const targetCount = Math.max(1, Math.floor(finalTokens / avgMemoryCost));

        log(`Stage 2 (Smart): avgCost=${avgMemoryCost.toFixed(0)}, targetCount=${targetCount}`);

        // If we already have fewer than target, skip LLM call
        if (stage1Results.length <= targetCount) {
            log(`Stage 2: Skipping LLM (${stage1Results.length} <= ${targetCount})`);
            return stage1Results;
        }

        return selectRelevantMemoriesSmart(stage1Results, ctx, targetCount);
    } else {
        // Simple mode: Single-stage - slice directly to final budget
        const finalResults = sliceToTokenBudget(scored, finalTokens);
        log(
            `Retrieval: ${memories.length} memories -> ${scored.length} scored -> ${finalResults.length} after token filter (${finalTokens} budget)`
        );
        return finalResults;
    }
}
