/**
 * OpenVault Memory Scoring
 *
 * Algorithms for selecting relevant memories for retrieval.
 * Uses forgetfulness curve (exponential decay) and optional vector similarity.
 */

import { getDeps } from '../deps.js';
import { log, safeParseJSON, sliceToTokenBudget, estimateTokens } from '../utils.js';
import { extensionName } from '../constants.js';
import { callLLMForRetrieval } from '../llm.js';
import { buildSmartRetrievalPrompt } from '../prompts.js';
import { getEmbedding, isEmbeddingsEnabled } from '../embeddings.js';

// Lazy-initialized worker
let scoringWorker = null;

function getScoringWorker() {
    if (!scoringWorker) {
        scoringWorker = new Worker(new URL('./worker.js', import.meta.url));
    }
    return scoringWorker;
}

/**
 * Run scoring in web worker
 */
function runWorkerScoring(memories, contextEmbedding, chatLength, limit, settings) {
    return new Promise((resolve, reject) => {
        const worker = getScoringWorker();

        const handler = (e) => {
            worker.removeEventListener('message', handler);
            worker.removeEventListener('error', errorHandler);
            if (e.data.success) {
                resolve(e.data.results);
            } else {
                reject(new Error(e.data.error));
            }
        };

        const errorHandler = (e) => {
            worker.removeEventListener('message', handler);
            worker.removeEventListener('error', errorHandler);
            reject(e);
        };

        worker.addEventListener('message', handler);
        worker.addEventListener('error', errorHandler);

        worker.postMessage({
            memories,
            contextEmbedding,
            chatLength,
            limit,
            constants: {
                BASE_LAMBDA: settings.forgetfulnessBaseLambda ?? 0.05,
                IMPORTANCE_5_FLOOR: settings.forgetfulnessImportance5Floor ?? 5,
            },
            settings: {
                vectorSimilarityThreshold: settings.vectorSimilarityThreshold,
                vectorSimilarityWeight: settings.vectorSimilarityWeight
            }
        });
    });
}

/**
 * Select relevant memories using forgetfulness curve scoring (via Web Worker)
 * @param {Object[]} memories - Available memories
 * @param {string} recentContext - Recent chat context (for smart retrieval)
 * @param {string} userMessages - Last 3 user messages for embedding (capped at 1000 chars)
 * @param {string} characterName - POV character name (unused, kept for API compatibility)
 * @param {string[]} activeCharacters - List of active characters (unused, kept for API compatibility)
 * @param {number} limit - Maximum memories to return
 * @param {number} chatLength - Current chat length (for distance calculation)
 * @returns {Promise<Object[]>} Selected memories
 */
export async function selectRelevantMemoriesSimple(memories, recentContext, userMessages, characterName, activeCharacters, limit, chatLength) {
    const settings = getDeps().getExtensionSettings()[extensionName];

    // Get embedding for user messages if enabled (user intent matters most for retrieval)
    let contextEmbedding = null;
    if (isEmbeddingsEnabled() && userMessages) {
        contextEmbedding = await getEmbedding(userMessages);
    }

    return runWorkerScoring(memories, contextEmbedding, chatLength, limit, settings);
}

/**
 * Select relevant memories using LLM (smart mode)
 * @param {Object[]} memories - Available memories to select from
 * @param {string} recentContext - Recent chat context
 * @param {string} userMessages - Last 3 user messages for embedding fallback
 * @param {string} characterName - POV character name
 * @param {number} limit - Maximum memories to select
 * @param {number} chatLength - Current chat length (for fallback distance calculation)
 * @returns {Promise<Object[]>} - Selected memories
 */
export async function selectRelevantMemoriesSmart(memories, recentContext, userMessages, characterName, limit, chatLength) {
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

        // Parse the response using robust json-repair
        const parsed = safeParseJSON(response);
        if (!parsed) {
            log('Smart retrieval: Failed to parse LLM response, falling back to simple mode');
            return selectRelevantMemoriesSimple(memories, recentContext, userMessages, characterName, [], limit, chatLength);
        }

        // Extract selected indices
        const selectedIndices = parsed.selected || [];
        if (!Array.isArray(selectedIndices) || selectedIndices.length === 0) {
            log('Smart retrieval: No memories selected by LLM, falling back to simple mode');
            return selectRelevantMemoriesSimple(memories, recentContext, userMessages, characterName, [], limit, chatLength);
        }

        // Convert 1-indexed to 0-indexed and filter valid indices
        const selectedMemories = selectedIndices
            .map(i => memories[i - 1]) // Convert to 0-indexed
            .filter(m => m !== undefined);

        if (selectedMemories.length === 0) {
            log('Smart retrieval: Invalid indices from LLM, falling back to simple mode');
            return selectRelevantMemoriesSimple(memories, recentContext, userMessages, characterName, [], limit, chatLength);
        }

        log(`Smart retrieval: LLM selected ${selectedMemories.length} memories. Reasoning: ${parsed.reasoning || 'none provided'}`);
        return selectedMemories;
    } catch (error) {
        log(`Smart retrieval error: ${error.message}, falling back to simple mode`);
        return selectRelevantMemoriesSimple(memories, recentContext, userMessages, characterName, [], limit, chatLength);
    }
}

/**
 * Select relevant memories using Two-Stage Token-Based Pipeline
 * Stage 1: Algorithmic scoring with token budget pre-filter
 * Stage 2: Smart LLM selection OR simple token budget slice
 * @param {Object[]} memories - Available memories
 * @param {string} recentContext - Recent chat context
 * @param {string} userMessages - Last 3 user messages for embedding
 * @param {string} characterName - POV character name
 * @param {string[]} activeCharacters - List of active characters (unused, kept for API)
 * @param {Object} settings - Extension settings with token budgets
 * @param {number} chatLength - Current chat length (for distance calculation)
 * @returns {Promise<Object[]>} Selected memories
 */
export async function selectRelevantMemories(memories, recentContext, userMessages, characterName, activeCharacters, settings, chatLength) {
    if (!memories || memories.length === 0) return [];

    const preFilterTokens = settings.retrievalPreFilterTokens || 24000;
    const finalTokens = settings.retrievalFinalTokens || 12000;

    // Stage 1: Algorithmic Filtering
    // Get scored results (pass high count limit, we'll token-slice after)
    const scored = await selectRelevantMemoriesSimple(
        memories,
        recentContext,
        userMessages,
        characterName,
        activeCharacters,
        1000, // High count limit - we'll apply token budget after
        chatLength
    );

    // Apply Stage 1 token budget (pre-filter)
    const stage1Results = sliceToTokenBudget(scored, preFilterTokens);
    log(`Stage 1: ${memories.length} memories -> ${scored.length} scored -> ${stage1Results.length} after token filter (${preFilterTokens} budget)`);

    if (stage1Results.length === 0) return [];

    // Stage 2: Smart Selection OR Simple Slice
    if (settings.smartRetrievalEnabled) {
        // Calculate target count based on average memory cost
        const totalStage1Tokens = stage1Results.reduce((sum, m) => sum + estimateTokens(m.summary), 0);
        const avgMemoryCost = totalStage1Tokens / stage1Results.length;
        const targetCount = Math.max(1, Math.floor(finalTokens / avgMemoryCost));

        log(`Stage 2 (Smart): avgCost=${avgMemoryCost.toFixed(0)}, targetCount=${targetCount}`);

        // If we already have fewer than target, skip LLM call
        if (stage1Results.length <= targetCount) {
            log(`Stage 2: Skipping LLM (${stage1Results.length} <= ${targetCount})`);
            return stage1Results;
        }

        return selectRelevantMemoriesSmart(stage1Results, recentContext, userMessages, characterName, targetCount, chatLength);
    } else {
        // Simple mode: just apply final token budget
        const finalResults = sliceToTokenBudget(stage1Results, finalTokens);
        log(`Stage 2 (Simple): ${stage1Results.length} -> ${finalResults.length} after final token filter (${finalTokens} budget)`);
        return finalResults;
    }
}
