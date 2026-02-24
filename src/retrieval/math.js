/**
 * OpenVault Scoring Math
 *
 * Pure mathematical functions for memory scoring.
 * Extracted for testability and reuse in both main thread and worker.
 */

import snowball from 'https://esm.sh/snowball-stemmers@0.6.0';

// Stemmers — initialized once at module level
const ruStemmer = snowball.newStemmer('russian');
const enStemmer = snowball.newStemmer('english');

// Script detection regex (compiled once)
const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
const LATIN_RE = /\p{Script=Latin}/u;

/**
 * Stem a word using the appropriate language stemmer based on script detection.
 * Cyrillic → Russian stemmer, Latin → English stemmer, other (CJK, etc.) → unchanged.
 */
function stemWord(word) {
    if (CYRILLIC_RE.test(word)) return ruStemmer.stem(word);
    if (LATIN_RE.test(word)) return enStemmer.stem(word);
    return word;
}

// Common stop words to filter out during tokenization
const STOP_WORDS = new Set([
    // English
    'the', 'and', 'is', 'a', 'an', 'in', 'to', 'of', 'for', 'with', 'on',
    'at', 'from', 'by', 'as', 'it', 'this', 'that', 'are', 'was', 'were',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'or',
    'but', 'not', 'no', 'yes', 'so', 'if', 'then', 'than', 'when', 'what',
    'which', 'who', 'whom', 'whose', 'where', 'why', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'only',
    'own', 'same', 'just', 'also', 'now', 'here', 'there', 'about', 'into',
    'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down',
    'out', 'off', 'over', 'under', 'again', 'further', 'once', 'he', 'she',
    'they', 'we', 'you', 'i', 'me', 'him', 'her', 'them', 'us', 'my', 'your',
    'his', 'its', 'our', 'their',
    // Russian (common stop words)
    'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а',
    'то', 'все', 'она', 'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же',
    'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было', 'вот', 'от',
    'меня', 'еще', 'нет', 'о', 'из', 'ему', 'теперь', 'когда', 'даже', 'ну',
    'вдруг', 'ли', 'если', 'уже', 'или', 'ни', 'быть', 'был', 'него', 'до',
    'вас', 'нибудь', 'опять', 'уж', 'вам', 'ведь', 'там', 'потом', 'себя',
    'ничего', 'ей', 'может', 'они', 'тут', 'где', 'есть', 'надо', 'ней',
    'для', 'мы', 'тебя', 'их', 'чем', 'была', 'сам', 'чтоб', 'без', 'будто',
    'чего', 'раз', 'тоже', 'себе', 'под', 'будет', 'ж', 'тогда', 'кто',
    'этот', 'того', 'потому', 'этого', 'какой', 'совсем', 'ним', 'здесь',
    'этом', 'один', 'почти', 'мой', 'тем', 'чтобы', 'нее', 'сейчас', 'были',
    'куда', 'зачем', 'всех', 'никогда', 'можно', 'при', 'наконец', 'два',
    'об', 'другой', 'хоть', 'после', 'над', 'больше', 'тот', 'через', 'эти',
    'нас', 'про', 'всего', 'них', 'какая', 'много', 'разве', 'три', 'эту',
    'моя', 'впрочем', 'хорошо', 'свою', 'этой', 'перед', 'иногда', 'лучше',
    'чуть', 'том', 'нельзя', 'такой', 'им', 'более', 'всегда', 'конечно',
    'всю', 'между'
]);

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
        .filter(word => word.length > 2 && !STOP_WORDS.has(word))
        .map(stemWord);
}

/**
 * Calculate IDF scores and average document length for a corpus
 * @param {Object[]} memories - Memories to analyze
 * @param {Map} tokenizedMemories - Map of memory index to tokens
 * @returns {{idfMap: Map<string, number>, avgDL: number}}
 */
function calculateIDF(memories, tokenizedMemories) {
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
        const denominator = termFreq + BM25_K1 * (1 - BM25_B + BM25_B * docLen / avgDL);
        score += idf * (numerator / denominator);
    }

    return score;
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} vecA - First vector
 * @param {number[]} vecB - Second vector
 * @returns {number} Cosine similarity (0-1)
 */
export function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
        return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Calculate memory score based on forgetfulness curve, vector similarity, and BM25
 * @param {Object} memory - Memory object with message_ids, importance, embedding
 * @param {number[]|null} contextEmbedding - Context embedding for similarity
 * @param {number} chatLength - Current chat length
 * @param {Object} constants - Scoring constants (BASE_LAMBDA, IMPORTANCE_5_FLOOR)
 * @param {Object} settings - Scoring settings (vectorSimilarityThreshold, vectorSimilarityWeight, keywordMatchWeight)
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
    const lambda = constants.BASE_LAMBDA / (importance * importance);

    // Core forgetfulness formula: Score = Importance × e^(-λ × Distance)
    const base = importance * Math.exp(-lambda * distance);

    // Importance-5 floor: never drops below minimum score
    let baseAfterFloor = base;
    if (importance === 5) {
        baseAfterFloor = Math.max(base, constants.IMPORTANCE_5_FLOOR);
    }

    const recencyPenalty = baseAfterFloor - base;

    // === Vector Similarity Bonus ===
    let vectorBonus = 0;
    let vectorSimilarity = 0;

    if (contextEmbedding && memory.embedding) {
        vectorSimilarity = cosineSimilarity(contextEmbedding, memory.embedding);
        const threshold = settings.vectorSimilarityThreshold || 0.5;
        const maxBonus = settings.vectorSimilarityWeight || 15;

        if (vectorSimilarity > threshold) {
            // Scale similarity above threshold to bonus points
            // e.g., similarity 0.75 with threshold 0.5 -> (0.75-0.5)/(1-0.5) = 0.5 -> 7.5 points
            const normalizedSim = (vectorSimilarity - threshold) / (1 - threshold);
            vectorBonus = normalizedSim * maxBonus;
        }
    }

    // === BM25 Keyword Match Bonus ===
    const keywordWeight = settings.keywordMatchWeight ?? 1.0;
    const bm25Bonus = bm25Score * keywordWeight;

    const total = baseAfterFloor + vectorBonus + bm25Bonus;

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
        importance
    };
}

/**
 * Score and sort memories using forgetfulness curve + vector similarity + BM25
 * @param {Object[]} memories - Memories to score
 * @param {number[]|null} contextEmbedding - Context embedding
 * @param {number} chatLength - Current chat length
 * @param {Object} constants - Scoring constants
 * @param {Object} settings - Scoring settings
 * @param {string|string[]} [queryTokens] - Query text or pre-tokenized array for BM25 scoring
 * @returns {Array<{memory: Object, score: number, breakdown: Object}>} Scored and sorted memories
 */
export function scoreMemories(memories, contextEmbedding, chatLength, constants, settings, queryTokens) {
    // Precompute BM25 data if query tokens provided
    let tokens = null;
    let idfMap = null;
    let avgDL = 0;
    let memoryTokensList = null;

    if (queryTokens) {
        // If queryTokens is array, use directly; if string, tokenize
        tokens = Array.isArray(queryTokens) ? queryTokens : tokenize(queryTokens);
        if (tokens.length > 0) {
            // Pre-tokenize all memories
            memoryTokensList = memories.map(m => tokenize(m.summary || ''));
            const idfData = calculateIDF(memories, new Map(memoryTokensList.map((t, i) => [i, t])));
            idfMap = idfData.idfMap;
            avgDL = idfData.avgDL;
        }
    }

    const scored = memories.map((memory, index) => {
        let bm25 = 0;
        if (tokens && idfMap && memoryTokensList) {
            bm25 = bm25Score(tokens, memoryTokensList[index], idfMap, avgDL);
        }
        const breakdown = calculateScore(memory, contextEmbedding, chatLength, constants, settings, bm25);
        return { memory, score: breakdown.total, breakdown };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored;
}
