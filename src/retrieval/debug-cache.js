/**
 * OpenVault Debug Cache
 *
 * Stores intermediates from the last retrieval run for debug export.
 * Updated by retrieve.js/scoring.js at key decision points.
 */

/** @type {Object|null} */
let lastRetrieval = null;

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
}
