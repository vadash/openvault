/**
 * Embedding Cache
 *
 * LRU cache for embedding results to avoid redundant API calls.
 * Maximum cache size prevents unbounded memory growth during long sessions.
 */

import { extensionName } from '../constants.js';
import { getDeps } from '../deps.js';
import { getSessionSignal } from '../state.js';
import { getStrategy } from './registry.js';

// LRU cache for embedding results
const MAX_CACHE_SIZE = 500;
const embeddingCache = new Map();

/**
 * Clear the embedding cache. Useful for testing or when settings change.
 */
export function clearEmbeddingCache() {
    embeddingCache.clear();
}

/**
 * Get query embedding (with query prefix applied by strategy)
 * @param {string} text - Query text
 * @param {Object} options - Options
 * @param {AbortSignal} options.signal - AbortSignal
 * @returns {Promise<Float32Array|null>} Embedding vector
 */
export async function getQueryEmbedding(text, { signal } = {}) {
    signal ??= getSessionSignal();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!text) return null;

    // Check cache (query prefix is applied inside strategy, so cache on raw text + 'q:' prefix)
    const cacheKey = `q:${text}`;
    if (embeddingCache.has(cacheKey)) {
        const value = embeddingCache.get(cacheKey);
        embeddingCache.delete(cacheKey);
        embeddingCache.set(cacheKey, value);
        return value;
    }

    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;
    const strategy = getStrategy(source);
    const result = await strategy.getQueryEmbedding(text, {
        signal,
        prefix: settings.embeddingQueryPrefix,
        url: settings.ollamaUrl,
        model: settings.embeddingModel,
    });

    if (embeddingCache.size >= MAX_CACHE_SIZE) {
        const firstKey = embeddingCache.keys().next().value;
        if (firstKey !== undefined) embeddingCache.delete(firstKey);
    }
    embeddingCache.set(cacheKey, result);
    return result;
}

/**
 * Get document embedding (with doc prefix applied by strategy)
 * @param {string} summary - Memory summary text
 * @param {Object} options - Options
 * @param {AbortSignal} options.signal - AbortSignal
 * @returns {Promise<Float32Array|null>} Embedding vector
 */
export async function getDocumentEmbedding(summary, { signal } = {}) {
    signal ??= getSessionSignal();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!summary) return null;

    const cacheKey = `d:${summary}`;
    if (embeddingCache.has(cacheKey)) {
        const value = embeddingCache.get(cacheKey);
        embeddingCache.delete(cacheKey);
        embeddingCache.set(cacheKey, value);
        return value;
    }

    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;
    const strategy = getStrategy(source);
    const result = await strategy.getDocumentEmbedding(summary, {
        signal,
        prefix: settings.embeddingDocPrefix,
        url: settings.ollamaUrl,
        model: settings.embeddingModel,
    });

    if (embeddingCache.size >= MAX_CACHE_SIZE) {
        const firstKey = embeddingCache.keys().next().value;
        if (firstKey !== undefined) embeddingCache.delete(firstKey);
    }
    embeddingCache.set(cacheKey, result);
    return result;
}
