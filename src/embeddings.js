/**
 * OpenVault Embeddings
 *
 * Local vector embeddings via Ollama for semantic similarity search.
 * Provides graceful fallback when Ollama is not configured.
 */

import { getDeps } from './deps.js';
import { log } from './utils.js';
import { extensionName } from './constants.js';

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

/**
 * Check if embeddings are configured and available
 * @returns {boolean} True if Ollama URL and model are configured
 */
export function isEmbeddingsEnabled() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    return !!(settings?.ollamaUrl && settings?.embeddingModel);
}

/**
 * Get embedding for text via Ollama
 * @param {string} text - Text to embed
 * @returns {Promise<number[]|null>} Embedding vector or null if unavailable
 */
export async function getEmbedding(text) {
    const settings = getDeps().getExtensionSettings()[extensionName];

    if (!settings?.ollamaUrl || !settings?.embeddingModel) {
        return null;
    }

    if (!text || text.trim().length === 0) {
        return null;
    }

    try {
        const url = settings.ollamaUrl.replace(/\/+$/, ''); // Remove trailing slashes
        const response = await getDeps().fetch(`${url}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: settings.embeddingModel,
                prompt: text.trim(),
            }),
        });

        if (!response.ok) {
            log(`Ollama embedding request failed: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json();
        return data.embedding || null;
    } catch (error) {
        log(`Embedding error: ${error.message}`);
        return null;
    }
}

/**
 * Generate embeddings for multiple memories that don't have them yet
 * @param {Object[]} memories - Memories to embed
 * @returns {Promise<number>} Number of memories successfully embedded
 */
export async function generateEmbeddingsForMemories(memories) {
    if (!isEmbeddingsEnabled()) {
        return 0;
    }

    // Filter to valid memories: have summary, no embedding yet
    const validMemories = memories.filter(m => m.summary && !m.embedding);

    if (validMemories.length === 0) {
        return 0;
    }

    // Process in batches of 5 (safe for Ollama local instances)
    const embeddings = await processInBatches(validMemories, 5, m => getEmbedding(m.summary));

    // Assign results back to memory objects
    let count = 0;
    for (let i = 0; i < validMemories.length; i++) {
        if (embeddings[i]) {
            validMemories[i].embedding = embeddings[i];
            count++;
        }
    }

    return count;
}
