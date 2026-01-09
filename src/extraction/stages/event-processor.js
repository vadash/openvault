/**
 * OpenVault Extraction Pipeline - Stage 4: Event Processing
 *
 * Enriches events with embeddings and deduplicates against existing memories.
 */

import { enrichEventsWithEmbeddings } from '../../embeddings.js';
import { cosineSimilarity } from '../../retrieval/math.js';
import { log } from '../../utils.js';

/**
 * Filter out events that are too similar to existing memories
 * @param {Object[]} newEvents - Newly extracted events with embeddings
 * @param {Object[]} existingMemories - Existing memories with embeddings
 * @param {number} threshold - Similarity threshold (0-1, default 0.85)
 * @returns {Object[]} Filtered events that are sufficiently unique
 */
function filterSimilarEvents(newEvents, existingMemories, threshold = 0.85) {
    if (!existingMemories?.length) return newEvents;

    return newEvents.filter(event => {
        if (!event.embedding) return true; // Keep if no embedding

        for (const memory of existingMemories) {
            if (!memory.embedding) continue;

            const similarity = cosineSimilarity(event.embedding, memory.embedding);
            if (similarity >= threshold) {
                log(`Dedup: Skipping "${event.summary}..." (${(similarity * 100).toFixed(1)}% similar to existing)`);
                return false;
            }
        }
        return true;
    });
}

/**
 * Enrich events with embeddings and deduplicate against existing memories
 * @param {Array} events - Parsed events from LLM
 * @param {Object} data - OpenVault data object
 * @param {Object} settings - Extension settings
 * @returns {Promise<Array>} Enriched and deduplicated events
 */
export async function processEvents(events, data, settings) {
    if (events.length === 0) {
        return events;
    }

    // Generate embeddings for new events
    await enrichEventsWithEmbeddings(events);

    // Filter out events too similar to existing memories
    const dedupThreshold = settings.dedupSimilarityThreshold ?? 0.85;
    const existingMemories = data.memories || [];
    const uniqueEvents = filterSimilarEvents(events, existingMemories, dedupThreshold);

    if (uniqueEvents.length < events.length) {
        log(`Dedup: Filtered ${events.length - uniqueEvents.length} similar events`);
    }

    return uniqueEvents;
}
