/**
 * OpenVault Scoring Math
 *
 * Pure mathematical functions for memory scoring.
 * Extracted for testability and reuse in both main thread and worker.
 */

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
 * Calculate memory score based on forgetfulness curve and vector similarity
 * @param {Object} memory - Memory object with message_ids, importance, embedding
 * @param {number[]|null} contextEmbedding - Context embedding for similarity
 * @param {number} chatLength - Current chat length
 * @param {Object} constants - Scoring constants (BASE_LAMBDA, IMPORTANCE_5_FLOOR)
 * @param {Object} settings - Scoring settings (vectorSimilarityThreshold, vectorSimilarityWeight)
 * @returns {number} Computed score
 */
export function calculateScore(memory, contextEmbedding, chatLength, constants, settings) {
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
    let score = importance * Math.exp(-lambda * distance);

    // Importance-5 floor: never drops below minimum score
    if (importance === 5) {
        score = Math.max(score, constants.IMPORTANCE_5_FLOOR);
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

    return score;
}

/**
 * Score and sort memories using forgetfulness curve + vector similarity
 * @param {Object[]} memories - Memories to score
 * @param {number[]|null} contextEmbedding - Context embedding
 * @param {number} chatLength - Current chat length
 * @param {Object} constants - Scoring constants
 * @param {Object} settings - Scoring settings
 * @returns {Array<{memory: Object, score: number}>} Scored and sorted memories
 */
export function scoreMemories(memories, contextEmbedding, chatLength, constants, settings) {
    const scored = memories.map(memory => {
        const score = calculateScore(memory, contextEmbedding, chatLength, constants, settings);
        return { memory, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored;
}
