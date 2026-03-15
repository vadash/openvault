/**
 * OpenVault Memory Scoring
 *
 * Algorithms for selecting relevant memories for retrieval.
 * Uses forgetfulness curve (exponential decay) and optional vector similarity.
 */

import { extensionName } from '../constants.js';
import { getDeps } from '../deps.js';
import { getQueryEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
import { logDebug } from '../utils/logging.js';
import { assignMemoriesToBuckets, getMemoryPosition } from '../utils/text.js';
import { countTokens } from '../utils/tokens.js';
import { cacheRetrievalDebug, cacheScoringDetails } from './debug-cache.js';
import { scoreMemories } from './math.js';
import {
    buildBM25Tokens,
    buildCorpusVocab,
    buildEmbeddingQuery,
    extractQueryContext,
    parseRecentMessages,
} from './query-context.js';

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
async function scoreMemoriesDirect(
    memories,
    contextEmbedding,
    chatLength,
    limit,
    queryTokens,
    characterNames = [],
    hiddenMemories = [] // NEW: Optional parameter
) {
    const { constants, settings } = getScoringParams();
    const scored = await scoreMemories(
        memories,
        contextEmbedding,
        chatLength,
        constants,
        settings,
        queryTokens,
        characterNames,
        hiddenMemories // NEW: Pass through
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
async function selectRelevantMemoriesSimple(memories, ctx, limit, allHiddenMemories = []) {
    const { recentContext, userMessages, activeCharacters, chatLength } = ctx;

    // Extract context from recent messages for enriched queries
    const recentMessages = parseRecentMessages(recentContext, 10);
    const queryContext = extractQueryContext(recentMessages, activeCharacters, ctx.graphNodes || {});

    // Build enriched queries
    // Use user messages only for embedding (intent matching)
    const userMessagesForEmbedding = parseRecentMessages(userMessages, 3);
    const embeddingQuery = buildEmbeddingQuery(userMessagesForEmbedding, queryContext);

    // Event gate: skip BM25 pipeline when no events in candidates
    const hasEvents = memories.some((m) => m.type === 'event');

    let bm25Tokens = [];
    const bm25Meta = {};
    if (hasEvents) {
        const corpusVocab = buildCorpusVocab(memories, allHiddenMemories, ctx.graphNodes || {}, ctx.graphEdges || {});
        bm25Tokens = buildBM25Tokens(userMessages, queryContext, corpusVocab, bm25Meta);
    }

    // Cache query context for debug export
    cacheRetrievalDebug({
        queryContext: {
            entities: queryContext.entities,
            embeddingQuery: embeddingQuery,
            bm25Tokens: {
                total: Array.isArray(bm25Tokens) ? bm25Tokens.length : 0,
                entityStems: bm25Meta.entityStems || 0,
                grounded: bm25Meta.grounded || 0,
                nonGrounded: bm25Meta.nonGrounded || 0,
                layer0Count: bm25Meta.layer0Count || 0,
                layer1Count: bm25Meta.layer1Count || 0,
            },
        },
    });

    // Log extracted entities for debugging
    if (queryContext.entities.length > 0 || embeddingQuery) {
        logDebug(
            `Query context: entities=[${queryContext.entities.join(', ')}], embeddingQuery="${embeddingQuery?.slice(0, 100)}${embeddingQuery?.length > 100 ? '...' : ''}"`
        );
    }

    // Get embedding for enriched query if enabled
    let contextEmbedding = null;
    if (isEmbeddingsEnabled() && embeddingQuery) {
        contextEmbedding = await getQueryEmbedding(embeddingQuery);
    }

    return scoreMemoriesDirect(
        memories,
        contextEmbedding,
        chatLength,
        limit,
        bm25Tokens,
        activeCharacters || [],
        allHiddenMemories // NEW: Pass hidden memories for IDF
    );
}

/**
 * Select memories using score-first budgeting with soft chronological balancing.
 * @param {Array<{memory: Object, score: number, breakdown: Object}>} scoredMemories - Pre-scored, sorted
 * @param {number} tokenBudget - Maximum tokens to select
 * @param {number} chatLength - Current chat length
 * @param {number} [minRepresentation=0.20] - Minimum 20% per bucket
 * @param {number} [softBalanceBudget=0.05] - 5% budget for balancing
 * @returns {Object[]} Selected memories
 */
export function selectMemoriesWithSoftBalance(
    scoredMemories,
    tokenBudget,
    chatLength,
    minRepresentation = 0.2,
    softBalanceBudget = 0.05
) {
    if (!scoredMemories || scoredMemories.length === 0) return [];
    if (tokenBudget <= 0) return [];

    // Phase 1: Score-first selection (95% of budget)
    const phase1Budget = tokenBudget * (1 - softBalanceBudget);
    const phase1Selected = [];

    let totalTokens = 0;
    for (const { memory } of scoredMemories) {
        const memTokens = countTokens(memory.summary || '');
        if (totalTokens + memTokens > phase1Budget) break;
        phase1Selected.push(memory);
        totalTokens += memTokens;
    }

    // Phase 2: Soft chronological balancing (5% of budget)
    const phase2Budget = tokenBudget - totalTokens;
    if (phase2Budget <= 0) return phase1Selected;

    // Analyze bucket distribution
    const buckets = assignMemoriesToBuckets(phase1Selected, chatLength);
    const bucketCounts = {
        old: buckets.old.reduce((sum, m) => sum + countTokens(m.summary), 0),
        mid: buckets.mid.reduce((sum, m) => sum + countTokens(m.summary), 0),
        recent: buckets.recent.reduce((sum, m) => sum + countTokens(m.summary), 0),
    };
    const totalSelected = bucketCounts.old + bucketCounts.mid + bucketCounts.recent;

    // Calculate minimum tokens per bucket
    const minTokens = totalSelected * minRepresentation;

    // Find underrepresented buckets and add memories
    const phase2Selected = [...phase1Selected];
    const remainingCandidates = scoredMemories
        .filter(({ memory }) => !phase1Selected.includes(memory))
        .map(({ memory }) => memory);

    for (const bucketName of ['old', 'mid', 'recent']) {
        if (bucketCounts[bucketName] < minTokens && buckets[bucketName].length > 0) {
            // Add memories from this bucket until min reached
            for (const memory of remainingCandidates) {
                const memTokens = countTokens(memory.summary || '');
                if (totalTokens + memTokens > tokenBudget) break;

                // Use getMemoryPosition for consistent bucket assignment
                const position = getMemoryPosition(memory);
                const isRecent = position >= chatLength - 100;
                const isMid = position >= chatLength - 500 && !isRecent;
                const isOld = !isRecent && !isMid;

                if (
                    (bucketName === 'old' && isOld) ||
                    (bucketName === 'mid' && isMid) ||
                    (bucketName === 'recent' && isRecent)
                ) {
                    phase2Selected.push(memory);
                    totalTokens += memTokens;
                    bucketCounts[bucketName] += memTokens;
                    remainingCandidates.splice(remainingCandidates.indexOf(memory), 1);
                }
            }
        }
    }

    return phase2Selected;
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

    // Build hidden memories set (all memories - candidates)
    const candidateIds = new Set(activeMemories.map((m) => m.id));
    const hiddenMemories = (ctx.allAvailableMemories || []).filter((m) => !m.archived && !candidateIds.has(m.id));

    const { memories: scoredMemories, scoredResults } = await selectRelevantMemoriesSimple(
        activeMemories,
        ctx,
        1000,
        hiddenMemories
    );
    const finalResults = selectMemoriesWithSoftBalance(scoredResults, finalTokens, ctx.chatLength);
    const selectedIds = new Set(finalResults.map((m) => m.id));

    // Cache scoring details for debug export
    cacheScoringDetails(scoredResults, selectedIds);

    // Calculate bucket distribution before and after soft balance
    const beforeBuckets = assignMemoriesToBuckets(scoredMemories, ctx.chatLength);
    const afterBuckets = assignMemoriesToBuckets(finalResults, ctx.chatLength);

    const countTokens = (bucket) => bucket.reduce((sum, m) => sum + (m.summary?.length || 0), 0); // Approximation

    // Cache token budget utilization and bucket distribution for debug export
    cacheRetrievalDebug({
        tokenBudget: {
            budget: finalTokens,
            scoredCount: scoredMemories.length,
            selectedCount: finalResults.length,
            trimmedByBudget: scoredMemories.length - finalResults.length,
        },
        bucketDistribution: {
            before: {
                old: countTokens(beforeBuckets.old),
                mid: countTokens(beforeBuckets.mid),
                recent: countTokens(beforeBuckets.recent),
            },
            after: {
                old: countTokens(afterBuckets.old),
                mid: countTokens(afterBuckets.mid),
                recent: countTokens(afterBuckets.recent),
            },
            selectedCount: finalResults.length,
        },
    });

    // Increment retrieval_hits counter for each selected memory
    // Mutates in-place; next save cycle will persist the counter
    for (const memory of finalResults) {
        memory.retrieval_hits = (memory.retrieval_hits || 0) + 1;
    }

    logDebug(
        `Retrieval: ${activeMemories.length} active memories -> ${scoredMemories.length} scored -> ${finalResults.length} after token filter (${finalTokens} budget)`
    );
    return finalResults;
}
