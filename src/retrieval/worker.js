/**
 * OpenVault Scoring Web Worker
 *
 * Offloads heavy memory scoring computations to prevent UI freezing.
 * Uses module worker syntax to import shared scoring math.
 *
 * Optimization: Caches memories to avoid redundant Structured Clone transfers.
 * Main thread only sends memories when count changes.
 */

import { scoreMemories } from './math.js';

// Cached memories to avoid redundant transfers
let cachedMemories = [];

self.onmessage = function(e) {
    const { memories, memoriesChanged, contextEmbedding, chatLength, limit, constants, settings, queryText, queryTokens } = e.data;

    // Update cache if new memories provided
    if (memoriesChanged && memories) {
        cachedMemories = memories;
    }

    try {
        // Support both queryTokens (array) and queryText (string) for backwards compatibility
        const query = queryTokens || queryText;
        const scored = scoreMemories(cachedMemories, contextEmbedding, chatLength, constants, settings, query);
        const results = scored.slice(0, limit).map(s => s.memory);
        self.postMessage({ success: true, results });
    } catch (error) {
        self.postMessage({ success: false, error: error.message });
    }
};
