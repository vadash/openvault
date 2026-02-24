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
import { cosineSimilarity } from './retrieval/math.js';

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

// LRU cache for embedding results to avoid redundant API calls
// Maximum cache size prevents unbounded memory growth during long sessions
const MAX_CACHE_SIZE = 500;
const embeddingCache = new Map();

/**
 * Get embedding for text using configured source
 * Delegates to the appropriate strategy based on settings.
 * Results are cached to avoid redundant API calls for the same text.
 * Uses LRU eviction when cache reaches MAX_CACHE_SIZE.
 * @param {string} text - Text to embed
 * @returns {Promise<number[]|null>} Embedding vector or null if unavailable
 */
export async function getEmbedding(text) {
    if (!text) return null;

    // Check cache first - refresh position for LRU behavior
    if (embeddingCache.has(text)) {
        const value = embeddingCache.get(text);
        // Delete and re-insert to mark as recently used
        embeddingCache.delete(text);
        embeddingCache.set(text, value);
        return value;
    }

    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings?.embeddingSource || 'multilingual-e5-small';
    const strategy = getStrategy(source);
    const result = await strategy.getEmbedding(text);

    // Cache successful results (cache failures as null to avoid retrying)
    // Evict oldest entry if at capacity
    if (embeddingCache.size >= MAX_CACHE_SIZE) {
        const firstKey = embeddingCache.keys().next().value;
        if (firstKey !== undefined) {
            embeddingCache.delete(firstKey);
        }
    }
    embeddingCache.set(text, result);
    return result;
}

/**
 * Clear the embedding cache. Useful for testing or when settings change.
 */
export function clearEmbeddingCache() {
    embeddingCache.clear();
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

// cosineSimilarity imported from ./retrieval/math.js for DRY

// =============================================================================
// Tag Formatting
// =============================================================================

/**
 * Format memory text for document embedding with tag prefix
 * @param {string} summary - Memory summary text
 * @param {string[]|null} tags - Tags from extraction
 * @param {Object} settings - Extension settings
 * @returns {string} Formatted text for embedding
 */
export function formatForEmbedding(summary, tags, settings) {
    const format = settings?.embeddingTagFormat ?? 'bracket';
    if (format === 'none' || !tags?.length) return summary;

    const tagPrefix = tags
        .filter(t => t !== 'NONE')
        .map(t => `[${t}]`)
        .join(' ');

    return tagPrefix ? `${tagPrefix} ${summary}` : summary;
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

    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings?.embeddingSource || 'multilingual-e5-small';
    const strategy = getStrategy(source);

    const embeddings = await processInBatches(validMemories, 5, async (m) => {
        const text = formatForEmbedding(m.summary, m.tags, settings);
        return strategy.getDocumentEmbedding(text);
    });

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

    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings?.embeddingSource || 'multilingual-e5-small';
    const strategy = getStrategy(source);

    const embeddings = await processInBatches(validEvents, 5, async (e) => {
        const text = formatForEmbedding(e.summary, e.tags, settings);
        return strategy.getDocumentEmbedding(text);
    });

    let count = 0;
    for (let i = 0; i < validEvents.length; i++) {
        if (embeddings[i]) {
            validEvents[i].embedding = embeddings[i];
            validEvents[i].embedding_tags = validEvents[i].tags || ['NONE'];
            count++;
        }
    }

    return count;
}

// =============================================================================
// Re-exports for backward compatibility
// =============================================================================

export { TRANSFORMERS_MODELS, cosineSimilarity };
