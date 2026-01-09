/**
 * OpenVault Scoring Web Worker
 *
 * Offloads heavy memory scoring computations to prevent UI freezing.
 * Uses module worker syntax to import shared scoring math.
 */

import { scoreMemories } from './math.js';

self.onmessage = function(e) {
    const { memories, contextEmbedding, chatLength, limit, constants, settings, queryText, queryTokens } = e.data;

    try {
        // Support both queryTokens (array) and queryText (string) for backwards compatibility
        const query = queryTokens || queryText;
        const scored = scoreMemories(memories, contextEmbedding, chatLength, constants, settings, query);
        const results = scored.slice(0, limit).map(s => s.memory);
        self.postMessage({ success: true, results });
    } catch (error) {
        self.postMessage({ success: false, error: error.message });
    }
};
