/**
 * Synchronous fallback scorer for environments where Web Workers are unavailable.
 * Uses the same scoring logic as worker.js but runs on the main thread.
 */
import { scoreMemories } from './math.js';

/**
 * Score memories synchronously (main-thread fallback).
 * @param {Array} memories - Array of memory objects with embeddings
 * @param {Object} params - Scoring parameters
 * @param {Array<number>} params.contextEmbedding - Query embedding vector
 * @param {number} params.chatLength - Current chat length for recency calculation
 * @param {number} params.limit - Maximum results to return
 * @param {Array<string>} params.queryTokens - Tokenized query for BM25
 * @param {Object} params.constants - Scoring constants (BASE_LAMBDA, IMPORTANCE_5_FLOOR)
 * @param {Object} params.settings - User settings (vectorSimilarityThreshold, vectorSimilarityWeight)
 * @returns {Array} Scored and sorted memory results
 */
export function scoreMemoriesSync(memories, params) {
    const {
        contextEmbedding,
        chatLength,
        limit,
        queryTokens,
        constants,
        settings
    } = params;

    // scoreMemories signature: (memories, contextEmbedding, chatLength, constants, settings, queryTokens)
    // Note: limit is handled by slicing the results
    const scored = scoreMemories(
        memories,
        contextEmbedding,
        chatLength,
        constants,
        settings,
        queryTokens
    );

    return scored.slice(0, limit);
}
