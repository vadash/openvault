/**
 * OpenVault Scoring Math
 *
 * Pure mathematical functions for memory scoring.
 * Extracted for testability and reuse in both main thread and worker.
 */

import { record } from '../perf/store.js';
import { getEmbedding, hasEmbedding } from '../utils/embedding-codec.js';
import { yieldToMain } from '../utils/st-helpers.js';
import { stemWord } from '../utils/stemmer.js';
import { ALL_STOPWORDS } from '../utils/stopwords.js';

// BM25 parameters
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/**
 * Tokenize text into lowercase words, filtering stop words
 * @param {string} text - Text to tokenize
 * @returns {string[]} Array of tokens
 */
export function tokenize(text) {
    if (!text) return [];
    // \p{L} matches any Unicode letter (supports Cyrillic, Latin, CJK, etc.)
    // Using 'gu' flag for Unicode-aware matching
    return (text.toLowerCase().match(/[\p{L}0-9_]+/gu) || [])
        .filter((word) => word.length > 2 && !ALL_STOPWORDS.has(word))
        .map(stemWord)
        .filter((word) => word.length > 2); // Post-stem length filter (e.g. "боюсь" → "бо" filtered)
}

/**
 * Check if a memory contains an exact multi-word phrase (case-insensitive).
 * Normalizes whitespace and strips punctuation for matching.
 * @param {string} phrase - Multi-word phrase to find (must contain space)
 * @param {Object} memory - Memory object with summary field
 * @returns {boolean} True if exact phrase found in memory
 */
export function hasExactPhrase(phrase, memory) {
    if (!phrase || !memory?.summary) return false;

    // Only handle multi-word phrases
    const trimmedPhrase = phrase.trim();
    if (!trimmedPhrase.includes(' ')) return false;

    // Normalize both strings: lowercase, normalize whitespace, strip punctuation
    const normalize = (str) =>
        str
            .toLowerCase()
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/[^\p{L}\p{N}\s]/gu, '') // Strip punctuation (keep letters, numbers, spaces)
            .trim();

    const normalizedPhrase = normalize(trimmedPhrase);
    const normalizedSummary = normalize(memory.summary);

    return normalizedSummary.includes(normalizedPhrase);
}

/**
 * Calculate IDF scores and average document length for a corpus
 * @param {Object[]} memories - Memories to analyze
 * @param {Map} tokenizedMemories - Map of memory index to tokens
 * @returns {{idfMap: Map<string, number>, avgDL: number}}
 */
export function calculateIDF(memories, tokenizedMemories) {
    const N = memories.length;
    const df = new Map(); // Document frequency for each term
    let totalDL = 0;

    // Count document frequency and total document length
    for (const tokens of tokenizedMemories.values()) {
        totalDL += tokens.length;
        const uniqueTerms = new Set(tokens);
        for (const term of uniqueTerms) {
            df.set(term, (df.get(term) || 0) + 1);
        }
    }

    const avgDL = N > 0 ? totalDL / N : 0;
    const idfMap = new Map();

    // Calculate IDF using standard BM25 formula: log((N - df + 0.5) / (df + 0.5) + 1)
    for (const [term, freq] of df.entries()) {
        idfMap.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
    }

    return { idfMap, avgDL };
}

/**
 * IDF-aware query token frequency adjustment.
 * Reduces repeated tokens proportional to their IDF to prevent corpus-common
 * entity tokens (e.g. main character name) from inflating scores.
 * @param {string[]} queryTokens - Original query tokens (may have repeats)
 * @param {Map} idfMap - Precomputed IDF scores
 * @param {number} totalDocs - Total number of documents (memories)
 * @returns {string[]} Adjusted query tokens with TF scaled by IDF
 */
function adjustQueryTokensByIDF(queryTokens, idfMap, totalDocs) {
    if (!queryTokens || queryTokens.length === 0 || !idfMap) return queryTokens;

    const maxIDF = Math.log(totalDocs + 1); // IDF when df=0 (corpus-unique)
    if (maxIDF <= 0) return queryTokens;

    // Count unique tokens and their frequencies
    const tokenCounts = new Map();
    for (const t of queryTokens) {
        tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1);
    }

    // Build adjusted token array
    const adjusted = [];
    for (const [token, count] of tokenCounts.entries()) {
        const idf = idfMap.get(token) ?? maxIDF; // unknown terms get max IDF (corpus-unique)
        const idfRatio = idf / maxIDF; // [0, 1]
        const adjustedCount = Math.max(1, Math.round(count * idfRatio));
        for (let i = 0; i < adjustedCount; i++) {
            adjusted.push(token);
        }
    }
    return adjusted;
}

/**
 * Calculate BM25 score for a document against a query
 * @param {string[]} queryTokens - Tokenized query
 * @param {string[]} docTokens - Tokenized document
 * @param {Map} idfMap - Precomputed IDF scores
 * @param {number} avgDL - Average document length
 * @returns {number} BM25 score
 */
function bm25Score(queryTokens, docTokens, idfMap, avgDL) {
    const docLen = docTokens.length;
    if (docLen === 0 || queryTokens.length === 0 || avgDL === 0) return 0;

    // Count term frequency in document
    const tf = new Map();
    for (const token of docTokens) {
        tf.set(token, (tf.get(token) || 0) + 1);
    }

    let score = 0;
    for (const term of queryTokens) {
        const termFreq = tf.get(term) || 0;
        if (termFreq === 0) continue;

        const idf = idfMap.get(term) || 0;
        // BM25 formula: IDF * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgDL))
        const numerator = termFreq * (BM25_K1 + 1);
        const denominator = termFreq + BM25_K1 * (1 - BM25_B + (BM25_B * docLen) / avgDL);
        score += idf * (numerator / denominator);
    }

    return score;
}

/**
 * Calculate cosine similarity between two vectors.
 * 4x loop-unrolled for performance on 384/768-dim typed arrays.
 * @param {Float32Array|number[]} vecA - First vector
 * @param {Float32Array|number[]} vecB - Second vector
 * @returns {number} Cosine similarity (0-1)
 */
export function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
        return 0;
    }

    const len = vecA.length;
    let dot = 0,
        normA = 0,
        normB = 0;

    // Process 4 elements per iteration (384-dim → 96 iterations)
    const limit = len - (len % 4);
    for (let i = 0; i < limit; i += 4) {
        const a0 = vecA[i],
            a1 = vecA[i + 1],
            a2 = vecA[i + 2],
            a3 = vecA[i + 3];
        const b0 = vecB[i],
            b1 = vecB[i + 1],
            b2 = vecB[i + 2],
            b3 = vecB[i + 3];
        dot += a0 * b0 + a1 * b1 + a2 * b2 + a3 * b3;
        normA += a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3;
        normB += b0 * b0 + b1 * b1 + b2 * b2 + b3 * b3;
    }

    // Handle remainder (0-3 elements)
    for (let i = limit; i < len; i++) {
        dot += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dot / magnitude;
}

/**
 * Calculate memory score based on forgetfulness curve, vector similarity, and BM25
 * @param {Object} memory - Memory object with message_ids, importance, embedding
 * @param {Float32Array|null} contextEmbedding - Context embedding for similarity
 * @param {number} chatLength - Current chat length
 * @param {Object} constants - Scoring constants (BASE_LAMBDA, IMPORTANCE_5_FLOOR)
 * @param {Object} settings - Scoring settings (vectorSimilarityThreshold, alpha, combinedBoostWeight)
 * @param {number} [bm25Score] - Precomputed BM25 score
 * @returns {{total: number, base: number, baseAfterFloor: number, recencyPenalty: number, vectorBonus: number, vectorSimilarity: number, bm25Bonus: number, bm25Score: number, distance: number, importance: number}} Score breakdown
 */
export function calculateScore(memory, contextEmbedding, chatLength, constants, settings, bm25Score = 0) {
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

    // Access-reinforced decay: dampen lambda by retrieval history
    const hits = memory.retrieval_hits || 0;
    const hitDamping = Math.max(0.5, 1 / (1 + hits * 0.1));
    const lambda = (constants.BASE_LAMBDA / (importance * importance)) * hitDamping;

    // Core forgetfulness formula: Score = Importance × e^(-λ × Distance)
    const base = importance * Math.exp(-lambda * distance);

    // Importance-5 soft floor: never drops below 1.0 (baseline relevant)
    let baseAfterFloor = base;
    if (importance === 5) {
        baseAfterFloor = Math.max(base, 1.0);
    }

    const recencyPenalty = baseAfterFloor - base;

    // === Alpha-Blend Scoring ===
    const alpha = settings.alpha;
    const boostWeight = settings.combinedBoostWeight;

    // === Vector Similarity Bonus (alpha-blend) ===
    let vectorBonus = 0;
    let vectorSimilarity = 0;

    if (contextEmbedding && hasEmbedding(memory)) {
        vectorSimilarity = cosineSimilarity(contextEmbedding, getEmbedding(memory));
        const threshold = settings.vectorSimilarityThreshold;

        if (vectorSimilarity > threshold) {
            // Scale similarity above threshold to bonus points
            // e.g., similarity 0.75 with threshold 0.5 -> (0.75-0.5)/(1-0.5) = 0.5
            const normalizedSim = (vectorSimilarity - threshold) / (1 - threshold);
            // Vector bonus = alpha * boostWeight * normalizedSim
            vectorBonus = alpha * boostWeight * normalizedSim;
        }
    }

    // === BM25 Bonus (alpha-blend, pre-normalized to [0,1]) ===
    // bm25Score is expected to be normalized [0,1] by scoreMemories()
    // BM25 bonus = (1 - alpha) * boostWeight * normalizedBM25
    const bm25Bonus = (1 - alpha) * boostWeight * bm25Score;

    let total = baseAfterFloor + vectorBonus + bm25Bonus;

    // === Frequency Boost (mentions) ===
    const mentions = memory.mentions || 1;
    const frequencyFactor = 1 + Math.log(mentions) * 0.05;
    total *= frequencyFactor;

    // === Reflection Decay ===
    // Reflections lose additional score with distance beyond threshold
    // Higher-level reflections decay slower (level divisor)
    if (memory.type === 'reflection' && distance > constants.reflectionDecayThreshold) {
        const threshold = constants.reflectionDecayThreshold;
        const level = memory.level || 1; // Default to level 1 for legacy
        const multiplier = constants.reflectionLevelMultiplier || 2.0;
        const levelDivisor = multiplier ** (level - 1);

        // Decay is divided by level multiplier: level 2 decays 2x slower
        const decayFactor = Math.max(0.25, 1 - (distance - threshold) / (2 * threshold * levelDivisor));
        total *= decayFactor;
    }

    return {
        total,
        base,
        baseAfterFloor,
        recencyPenalty,
        vectorBonus,
        vectorSimilarity,
        bm25Bonus,
        bm25Score,
        distance,
        importance,
        hitDamping,
        frequencyFactor,
    };
}

/**
 * Score and sort memories using forgetfulness curve + vector similarity + BM25
 * @param {Object[]} memories - Memories to score
 * @param {Float32Array|null} contextEmbedding - Context embedding
 * @param {number} chatLength - Current chat length
 * @param {Object} constants - Scoring constants
 * @param {Object} settings - Scoring settings
 * @param {string|string[]} [queryTokens] - Query text or pre-tokenized array for BM25 scoring
 * @param {string[]} [characterNames] - Main character names to filter from query tokens (dynamic stopwords)
 * @returns {Promise<Array<{memory: Object, score: number, breakdown: Object}>>} Scored and sorted memories
 */
export async function scoreMemories(
    memories,
    contextEmbedding,
    chatLength,
    constants,
    settings,
    queryTokens,
    characterNames = [],
    hiddenMemories = [] // NEW: Optional hidden memories for IDF
) {
    const start = performance.now();

    // Build corpus: candidates + hidden (if provided)
    const idfCorpus = hiddenMemories.length > 0 ? [...memories, ...hiddenMemories] : memories;

    // Precompute BM25 data if query tokens provided
    let tokens = null;
    let idfMap = null;
    let avgDL = 0;
    let memoryTokensList = null;

    if (queryTokens) {
        // If queryTokens is array, use directly; if string, tokenize
        tokens = Array.isArray(queryTokens) ? queryTokens : tokenize(queryTokens);

        // Filter out main character name stems — they appear in nearly every memory
        // and have near-zero IDF, wasting BM25 weight on non-discriminative tokens
        if (characterNames.length > 0) {
            const charStems = new Set(characterNames.flatMap((name) => tokenize(name.toLowerCase())));
            tokens = tokens.filter((t) => !charStems.has(t));
        }

        if (tokens.length > 0) {
            // Full IDF setup: tokenization + calculation (timed)
            const idfStart = performance.now();

            // Tokenize ALL memories in corpus (candidates + hidden)
            const corpusMemoryTokens = idfCorpus.map((m) => m.tokens || tokenize(m.summary || ''));

            // Calculate IDF from expanded corpus
            const tokenizedMap = new Map(corpusMemoryTokens.map((t, i) => [i, t]));
            const idfData = calculateIDF(idfCorpus, tokenizedMap);

            record('idf_calculation', performance.now() - idfStart, `${idfCorpus.length} docs`);
            idfMap = idfData.idfMap;
            avgDL = idfData.avgDL;

            // Only score candidate memories (not hidden ones)
            memoryTokensList = corpusMemoryTokens.slice(0, memories.length);

            // IDF-aware query TF adjustment (existing)
            tokens = adjustQueryTokensByIDF(tokens, idfMap, idfCorpus.length);
        }
    }

    // Separate exact phrase tokens from stem tokens
    // Exact phrases contain spaces (multi-word entities from Layer 0)
    // Stem tokens are single words (Layer 1+)
    const exactPhrases = (tokens || []).filter((t) => t.includes(' '));
    const stemTokens = (tokens || []).filter((t) => !t.includes(' '));

    // Compute BM25 using stem tokens only (existing logic)
    const rawBM25Scores = memories.map((_memory, index) => {
        if (stemTokens.length > 0 && idfMap && memoryTokensList) {
            return bm25Score(stemTokens, memoryTokensList[index], idfMap, avgDL);
        }
        return 0;
    });

    // Apply exact phrase boost: flat additive score for matching phrases
    // Use max IDF as phrase weight (phrases are highly specific)
    const maxIDF = idfMap ? Math.max(...idfMap.values()) : Math.log(idfCorpus.length + 1);

    for (let i = 0; i < memories.length; i++) {
        if (exactPhrases.length === 0) break;

        for (const phrase of exactPhrases) {
            if (hasExactPhrase(phrase, memories[i])) {
                // Add flat 10x boost per matching exact phrase
                // Multiplied by maxIDF to scale with corpus size
                rawBM25Scores[i] += 10.0 * maxIDF;
            }
        }
    }

    // Batch-max normalize BM25 to [0, 1] for alpha-blend scoring
    const maxBM25 = Math.max(...rawBM25Scores, 1e-9);
    const normalizedBM25Scores = rawBM25Scores.map((s) => s / maxBM25);

    const scored = [];
    for (let i = 0; i < memories.length; i++) {
        if (i % 250 === 0 && i > 0) await yieldToMain();
        const memory = memories[i];
        const breakdown = calculateScore(
            memory,
            contextEmbedding,
            chatLength,
            constants,
            settings,
            normalizedBM25Scores[i]
        );
        scored.push({ memory, score: breakdown.total, breakdown });
    }

    scored.sort((a, b) => b.score - a.score);

    const duration = performance.now() - start;
    record('memory_scoring', duration, `${memories.length} memories`);

    return scored;
}
