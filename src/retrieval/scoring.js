// @ts-check

/**
 * OpenVault Memory Scoring
 *
 * Algorithms for selecting relevant memories for retrieval.
 * Uses forgetfulness curve (exponential decay) and optional vector similarity.
 */

/** @typedef {import('../types').Memory} Memory */
/** @typedef {import('../types').ScoredMemory} ScoredMemory */
/** @typedef {import('../types').RetrievalContext} RetrievalContext */
/** @typedef {import('../types').ScoringConfig} ScoringConfig */
/** @typedef {import('../types').ForgetfulnessConstants} ForgetfulnessConstants */
/** @typedef {import('../types').ScoringSettings} ScoringSettings */
/** @typedef {import('../types').IDFCache} IDFCache */

import { DEBUG_TRIMMED_CANDIDATES, OVER_FETCH_MULTIPLIER } from '../constants.js';
import { getQueryEmbedding, getStrategy, isEmbeddingsEnabled } from '../embeddings.js';
import { logDebug } from '../utils/logging.js';
import { assignMemoriesToBuckets, getMemoryPosition } from '../utils/text.js';
import { countTokens } from '../utils/tokens.js';
import { cacheRetrievalDebug, cacheScoringDetails } from './debug-cache.js';
import { rankToProxyScore, scoreMemories } from './math.js';
import {
    buildBM25Tokens,
    buildCorpusVocab,
    buildEmbeddingQuery,
    extractQueryContext,
    parseRecentMessages,
} from './query-context.js';

/**
 * Score memories (main-thread, async to allow yielding).
 * @param {Memory[]} memories - Memories to score
 * @param {Float32Array|number[]|null} contextEmbedding - Context embedding
 * @param {number} chatLength - Current chat length
 * @param {number} limit - Maximum results
 * @param {string|string[]} queryTokens - Query text or pre-tokenized array for BM25
 * @param {string[]} [characterNames] - Main character names to filter from query tokens
 * @param {Memory[]} [hiddenMemories] - Hidden memories for expanded corpus IDF
 * @param {IDFCache|null} [idfCache] - Pre-computed IDF cache
 * @param {Partial<ScoringConfig>} [scoringConfig] - Flat scoring configuration from settings
 * @returns {Promise<{memories: Memory[], scoredResults: ScoredMemory[]}>}
 */
async function scoreMemoriesDirect(
    memories,
    contextEmbedding,
    chatLength,
    limit,
    queryTokens,
    characterNames = [],
    hiddenMemories = [],
    idfCache = null,
    scoringConfig = /** @type {Partial<ScoringConfig>} */ ({}),
    chatFingerprintMap = null
) {
    // Destructure flat scoringConfig into the {constants, settings} shape math.js expects
    const constants = {
        BASE_LAMBDA: scoringConfig.forgetfulnessBaseLambda,
        IMPORTANCE_5_FLOOR: scoringConfig.forgetfulnessImportance5Floor,
        reflectionDecayThreshold: scoringConfig.reflectionDecayThreshold,
    };
    const settings = {
        vectorSimilarityThreshold: scoringConfig.vectorSimilarityThreshold,
        alpha: scoringConfig.alpha,
        combinedBoostWeight: scoringConfig.combinedBoostWeight,
        transientDecayMultiplier: scoringConfig.transientDecayMultiplier,
    };
    const scored = await scoreMemories(
        memories,
        contextEmbedding,
        chatLength,
        constants,
        settings,
        queryTokens,
        characterNames,
        hiddenMemories,
        idfCache,
        chatFingerprintMap
    );
    const topScored = scored.slice(0, limit);
    return {
        memories: topScored.map((r) => r.memory),
        scoredResults: topScored,
    };
}

/**
 * Select relevant memories using forgetfulness curve scoring
 * @param {Memory[]} memories - Available memories
 * @param {RetrievalContext} ctx - Retrieval context object
 * @param {number} limit - Maximum memories to return
 * @param {Memory[]} [allHiddenMemories] - All hidden memories for IDF corpus
 * @param {IDFCache|null} [idfCache] - Pre-computed IDF cache
 * @returns {Promise<{memories: Memory[], scoredResults: ScoredMemory[]}>}
 */
async function selectRelevantMemoriesSimple(memories, ctx, limit, allHiddenMemories = [], idfCache = null) {
    const { recentContext, userMessages, activeCharacters, chatLength, scoringConfig, queryConfig } = ctx;

    // Check if using ST Vector Storage (external storage strategy)
    const source = scoringConfig.embeddingSource;
    const strategy = getStrategy(source);

    if (strategy.usesExternalStorage()) {
        return selectRelevantMemoriesWithST(memories, ctx, limit, allHiddenMemories, idfCache, strategy);
    }

    // Extract context from recent messages for enriched queries
    const recentMessages = parseRecentMessages(recentContext, 10);
    const queryContext = extractQueryContext(recentMessages, activeCharacters, ctx.graphNodes || {}, queryConfig);

    // Build enriched queries
    // Use user messages only for embedding (intent matching)
    const userMessagesForEmbedding = parseRecentMessages(userMessages, 3);
    const embeddingQuery = buildEmbeddingQuery(userMessagesForEmbedding, queryContext, queryConfig);

    // Event gate: skip BM25 pipeline when no events in candidates
    const hasEvents = memories.some((m) => m.type === 'event');

    let bm25Tokens = [];
    const bm25Meta = {};
    if (hasEvents) {
        const corpusVocab = buildCorpusVocab(memories, allHiddenMemories, ctx.graphNodes || {}, ctx.graphEdges || {});
        bm25Tokens = buildBM25Tokens(userMessages, queryContext, corpusVocab, bm25Meta, queryConfig);
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
        allHiddenMemories,
        idfCache,
        scoringConfig,
        ctx.chatFingerprintMap
    );
}

/**
 * Select relevant memories using ST Vector Storage + Alpha-Blend reranking.
 * Over-fetches from ST, assigns rank-position proxy scores, then feeds into scoreMemories.
 * @param {Memory[]} memories - Available memories
 * @param {RetrievalContext} ctx - Retrieval context object
 * @param {number} limit - Maximum memories to return
 * @param {Memory[]} allHiddenMemories - All hidden memories for IDF corpus
 * @param {IDFCache|null} idfCache - Pre-computed IDF cache
 * @param {Object} strategy - ST Vector strategy object with searchItems method
 * @returns {Promise<{memories: Memory[], scoredResults: ScoredMemory[]}>}
 */
async function selectRelevantMemoriesWithST(memories, ctx, limit, allHiddenMemories, idfCache, strategy) {
    const { recentContext, userMessages, activeCharacters, chatLength, scoringConfig, queryConfig } = ctx;

    // Over-fetch from ST for reranking headroom
    const stTopK = limit * OVER_FETCH_MULTIPLIER;
    const stResults = await strategy.searchItems(
        userMessages || recentContext?.slice(-500) || '',
        stTopK,
        scoringConfig.vectorSimilarityThreshold
    );

    // Build lookup maps for all item types
    const memoriesById = new Map(memories.map((m) => [m.id, m]));
    const nodesById = new Map(Object.entries(ctx.graphNodes || {}));

    if (stResults && stResults.length > 0) {
        const candidates = [];
        for (let i = 0; i < stResults.length; i++) {
            const result = stResults[i];
            let item = memoriesById.get(result.id);
            let itemType = 'memory';

            if (!item) {
                item = nodesById.get(result.id);
                itemType = 'node';
            }

            if (!item) continue;

            // Only memories can be scored with BM25 + forgetfulness
            if (itemType !== 'memory') continue;

            item._proxyVectorScore = rankToProxyScore(i, stResults.length);
            candidates.push(item);
        }

        if (candidates.length > 0) {
            // Build BM25 tokens (same as local path)
            const recentMessages = parseRecentMessages(recentContext, 10);
            const queryContext = extractQueryContext(
                recentMessages,
                activeCharacters,
                ctx.graphNodes || {},
                queryConfig
            );

            const hasEvents = candidates.some((m) => m.type === 'event');
            let bm25Tokens = [];
            if (hasEvents) {
                const corpusVocab = buildCorpusVocab(
                    candidates,
                    allHiddenMemories,
                    ctx.graphNodes || {},
                    ctx.graphEdges || {}
                );
                bm25Tokens = buildBM25Tokens(userMessages, queryContext, corpusVocab, null, queryConfig);
            }

            // Score with proxy vector scores + BM25 + forgetfulness
            // Destructure for math.js
            const constants = {
                BASE_LAMBDA: scoringConfig.forgetfulnessBaseLambda,
                IMPORTANCE_5_FLOOR: scoringConfig.forgetfulnessImportance5Floor,
                reflectionDecayThreshold: scoringConfig.reflectionDecayThreshold,
            };
            const scoringSettings = {
                vectorSimilarityThreshold: scoringConfig.vectorSimilarityThreshold,
                alpha: scoringConfig.alpha,
                combinedBoostWeight: scoringConfig.combinedBoostWeight,
                transientDecayMultiplier: scoringConfig.transientDecayMultiplier,
            };
            const scored = await scoreMemories(
                candidates,
                null, // No context embedding — proxy scores are on memories
                chatLength,
                constants,
                scoringSettings,
                bm25Tokens,
                activeCharacters || [],
                allHiddenMemories,
                idfCache,
                ctx.chatFingerprintMap
            );

            const topScored = scored.slice(0, limit);

            // Clean up proxy scores from memories (don't persist them)
            for (const memory of candidates) {
                delete memory._proxyVectorScore;
            }

            return {
                memories: topScored.map((r) => r.memory),
                scoredResults: topScored,
            };
        }
    }

    // Graceful degradation: ST returned 0 candidates, fall through to BM25-only
    const recentMessages = parseRecentMessages(recentContext, 10);
    const queryContext = extractQueryContext(recentMessages, activeCharacters, ctx.graphNodes || {}, queryConfig);
    const hasEvents = memories.some((m) => m.type === 'event');
    let bm25Tokens = [];
    if (hasEvents) {
        const corpusVocab = buildCorpusVocab(memories, allHiddenMemories, ctx.graphNodes || {}, ctx.graphEdges || {});
        bm25Tokens = buildBM25Tokens(userMessages, queryContext, corpusVocab, null, queryConfig);
    }

    return scoreMemoriesDirect(
        memories,
        null,
        chatLength,
        limit,
        bm25Tokens,
        activeCharacters || [],
        allHiddenMemories,
        idfCache,
        scoringConfig,
        ctx.chatFingerprintMap
    );
}

/**
 * Select memories using pre-allocated bucket quotas with score-based filling.
 * Pre-allocates minRepresentation per bucket first, then fills remainder by score.
 * @param {ScoredMemory[]} scoredMemories - Pre-scored, sorted
 * @param {number} tokenBudget - Maximum tokens to select
 * @param {number} chatLength - Current chat length
 * @param {number} [minRepresentation=0.20] - Minimum 20% per bucket
 * @returns {Memory[]} Selected memories
 */
export function selectMemoriesWithSoftBalance(scoredMemories, tokenBudget, chatLength, minRepresentation = 0.2) {
    if (!scoredMemories || scoredMemories.length === 0) return [];
    if (tokenBudget <= 0) return [];

    // Group all candidates by bucket first
    const bucketCandidates = { old: [], mid: [], recent: [] };
    for (const { memory } of scoredMemories) {
        const position = getMemoryPosition(memory);
        const isRecent = position >= chatLength - 100;
        const isMid = position >= chatLength - 500 && !isRecent;
        const isOld = !isRecent && !isMid;

        if (isOld) bucketCandidates.old.push(memory);
        else if (isMid) bucketCandidates.mid.push(memory);
        else bucketCandidates.recent.push(memory);
    }

    // Phase 1: Fill each bucket's quota (minRepresentation per bucket)
    const quotaBudget = tokenBudget * minRepresentation;
    const selected = [];
    let totalTokens = 0;
    const selectedIds = new Set();

    for (const bucketName of ['old', 'mid', 'recent']) {
        let bucketTokens = 0;
        for (const memory of bucketCandidates[bucketName]) {
            if (selectedIds.has(memory.id)) continue;
            const memTokens = countTokens(memory.summary || '');
            if (bucketTokens + memTokens > quotaBudget) break;
            selected.push(memory);
            selectedIds.add(memory.id);
            totalTokens += memTokens;
            bucketTokens += memTokens;
        }
    }

    // Phase 2: Fill remaining budget by highest score (regardless of bucket)
    const remainingBudget = tokenBudget - totalTokens;
    if (remainingBudget > 0) {
        for (const { memory } of scoredMemories) {
            if (selectedIds.has(memory.id)) continue;
            const memTokens = countTokens(memory.summary || '');
            if (totalTokens + memTokens > tokenBudget) break;
            selected.push(memory);
            selectedIds.add(memory.id);
            totalTokens += memTokens;
        }
    }

    return selected;
}

/**
 * Select relevant memories using scoring and token budget
 * @param {Memory[]} memories - Available memories
 * @param {RetrievalContext} ctx - Retrieval context object
 * @returns {Promise<Memory[]>} Selected memories
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
        hiddenMemories,
        ctx.idfCache || null
    );
    const finalResults = selectMemoriesWithSoftBalance(scoredResults, finalTokens, ctx.chatLength);
    const selectedIds = new Set(finalResults.map((m) => m.id));

    // Cache scoring details for debug export
    cacheScoringDetails(scoredResults, selectedIds);

    // Calculate bucket distribution before and after soft balance
    const beforeBuckets = assignMemoriesToBuckets(scoredMemories, ctx.chatLength);
    const afterBuckets = assignMemoriesToBuckets(finalResults, ctx.chatLength);

    const sumBucketTokens = (bucket) => bucket.reduce((sum, m) => sum + countTokens(m.summary || ''), 0);

    // Capture top trimmed candidates (highest-scoring memories that missed the budget cut)
    const trimmedCandidates = scoredResults
        .filter((r) => !selectedIds.has(r.memory.id))
        .slice(0, DEBUG_TRIMMED_CANDIDATES)
        .map((r) => ({ id: r.memory.id, score: r.score, summary: r.memory.summary?.slice(0, 120) }));

    // Cache token budget utilization and bucket distribution for debug export
    cacheRetrievalDebug({
        tokenBudget: {
            budget: finalTokens,
            scoredCount: scoredMemories.length,
            selectedCount: finalResults.length,
            trimmedByBudget: scoredMemories.length - finalResults.length,
            trimmed_candidates: trimmedCandidates,
        },
        bucketDistribution: {
            before: {
                old: sumBucketTokens(beforeBuckets.old),
                mid: sumBucketTokens(beforeBuckets.mid),
                recent: sumBucketTokens(beforeBuckets.recent),
            },
            after: {
                old: sumBucketTokens(afterBuckets.old),
                mid: sumBucketTokens(afterBuckets.mid),
                recent: sumBucketTokens(afterBuckets.recent),
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
