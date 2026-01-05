/**
 * OpenVault Scoring Web Worker
 *
 * Offloads heavy memory scoring computations to prevent UI freezing.
 */

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
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
 * Score and sort memories using forgetfulness curve + vector similarity
 */
function scoreMemories(memories, contextEmbedding, chatLength, constants, settings) {
    const scored = memories.map(memory => {
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

        return { memory, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored;
}

self.onmessage = function(e) {
    const { memories, contextEmbedding, chatLength, limit, constants, settings } = e.data;

    try {
        const scored = scoreMemories(memories, contextEmbedding, chatLength, constants, settings);
        const results = scored.slice(0, limit).map(s => s.memory);
        self.postMessage({ success: true, results });
    } catch (error) {
        self.postMessage({ success: false, error: error.message });
    }
};
