/**
 * OpenVault Embeddings
 *
 * Local vector embeddings via Transformers.js or Ollama for semantic similarity search.
 * Supports multiple embedding models with lazy loading.
 */

import { getStrategy, setGlobalStatusCallback, TRANSFORMERS_MODELS } from './embeddings/strategies.js';
import { getDeps } from './deps.js';
import { log } from './utils.js';
import { extensionName } from './constants.js';

// =============================================================================
// Public API - Strategy Delegation
// =============================================================================

/**
 * Set callback for embedding status updates
 * @param {Function} callback - Function(status: string) to call on status change
 */
export function setEmbeddingStatusCallback(callback) {
    setGlobalStatusCallback(callback);
}

/**
 * Get current embedding model status
 * @returns {string} Current status
 */
export function getEmbeddingStatus() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings?.embeddingSource || 'multilingual-e5-small';
    const strategy = getStrategy(source);
    return strategy.getStatus();
}

/**
 * Check if embeddings are configured and available
 * @returns {boolean} True if embedding source is configured
 */
export function isEmbeddingsEnabled() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings?.embeddingSource || 'multilingual-e5-small';
    const strategy = getStrategy(source);
    return strategy.isEnabled();
}

/**
 * Get embedding for text using configured source
 * Delegates to the appropriate strategy based on settings.
 * @param {string} text - Text to embed
 * @returns {Promise<number[]|null>} Embedding vector or null if unavailable
 */
export async function getEmbedding(text) {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings?.embeddingSource || 'multilingual-e5-small';
    const strategy = getStrategy(source);
    return strategy.getEmbedding(text);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Process items in batches with parallel execution within each batch
 * @param {Array} items - Items to process
 * @param {number} batchSize - Number of items per batch
 * @param {Function} fn - Async function to apply to each item
 * @returns {Promise<Array>} Results in order
 */
async function processInBatches(items, batchSize, fn) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(fn));
        results.push(...batchResults);
    }
    return results;
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} vecA - First vector
 * @param {number[]} vecB - Second vector
 * @returns {number} Similarity score between -1 and 1 (0 if invalid)
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

// =============================================================================
// Batch Operations
// =============================================================================

/**
 * Generate embeddings for multiple memories that don't have them yet
 * @param {Object[]} memories - Memories to embed
 * @returns {Promise<number>} Number of memories successfully embedded
 */
export async function generateEmbeddingsForMemories(memories) {
    if (!isEmbeddingsEnabled()) {
        return 0;
    }

    const validMemories = memories.filter(m => m.summary && !m.embedding);

    if (validMemories.length === 0) {
        return 0;
    }

    const embeddings = await processInBatches(validMemories, 5, m => getEmbedding(m.summary));

    let count = 0;
    for (let i = 0; i < validMemories.length; i++) {
        if (embeddings[i]) {
            validMemories[i].embedding = embeddings[i];
            count++;
        }
    }

    return count;
}

/**
 * Enrich events with embeddings (mutates events in place)
 * @param {Object[]} events - Events to enrich with embeddings
 * @returns {Promise<number>} Number of events successfully embedded
 */
export async function enrichEventsWithEmbeddings(events) {
    if (!isEmbeddingsEnabled()) {
        return 0;
    }

    const validEvents = events.filter(e => e.summary && !e.embedding);

    if (validEvents.length === 0) {
        return 0;
    }

    log(`Generating embeddings for ${validEvents.length} events`);

    const embeddings = await processInBatches(validEvents, 5, e => getEmbedding(e.summary));

    let count = 0;
    for (let i = 0; i < validEvents.length; i++) {
        if (embeddings[i]) {
            validEvents[i].embedding = embeddings[i];
            count++;
        }
    }

    return count;
}

// =============================================================================
// Re-exports for backward compatibility
// =============================================================================

export { TRANSFORMERS_MODELS };
