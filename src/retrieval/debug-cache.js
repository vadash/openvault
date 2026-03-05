/**
 * OpenVault Debug Cache
 *
 * Stores intermediates from the last retrieval run for debug export.
 * Updated by retrieve.js/scoring.js at key decision points.
 */

/** @type {Object|null} */
let lastRetrieval = null;

/** @type {Array<Object>|null} */
let cachedScoringDetails = null;

/**
 * Cache retrieval debug data. Merges with existing cache (additive).
 * @param {Object} data - Key-value pairs to cache
 */
export function cacheRetrievalDebug(data) {
    if (!lastRetrieval) {
        lastRetrieval = { timestamp: Date.now() };
    }
    Object.assign(lastRetrieval, data);
    lastRetrieval.timestamp = Date.now();
}

/**
 * Cache scoring breakdown details for each scored memory.
 * @param {Array<{memory: Object, score: number, breakdown: Object}>} scoredResults - Results from scoreMemories
 * @param {Set<string>|string[]} selectedIds - Memory IDs that were selected for final output
 */
export function cacheScoringDetails(scoredResults, selectedIds) {
    const selectedSet = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);

    cachedScoringDetails = scoredResults.map(({ memory, breakdown }) => {
        // Truncate summary to 80 chars
        const summary = memory.summary || '';
        const truncatedSummary = summary.length > 80 ? summary.slice(0, 77) + '...' : summary;

        return {
            memoryId: memory.id,
            type: memory.type || 'event',
            summary: truncatedSummary,
            scores: {
                base: breakdown.base,
                baseAfterFloor: breakdown.baseAfterFloor,
                recencyPenalty: breakdown.recencyPenalty,
                vectorSimilarity: breakdown.vectorSimilarity,
                vectorBonus: breakdown.vectorBonus,
                bm25Score: breakdown.bm25Score,
                bm25Bonus: breakdown.bm25Bonus,
                total: breakdown.total,
            },
            selected: selectedSet.has(memory.id),
            distance: breakdown.distance,
        };
    });
}

/**
 * Get the last cached scoring details.
 * @returns {Array<Object>|null}
 */
export function getCachedScoringDetails() {
    return cachedScoringDetails;
}

/**
 * Get the last cached retrieval debug data.
 * @returns {Object|null}
 */
export function getLastRetrievalDebug() {
    return lastRetrieval;
}

/**
 * Clear the debug cache (call on chat change).
 */
export function clearRetrievalDebug() {
    lastRetrieval = null;
    cachedScoringDetails = null;
}
