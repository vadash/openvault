/**
 * OpenVault Embeddings
 *
 * Local vector embeddings via Transformers.js or Ollama for semantic similarity search.
 * Supports multiple embedding models with lazy loading.
 */

import { getDeps } from './deps.js';
import { log } from './utils.js';
import { extensionName } from './constants.js';

// Model configuration
const TRANSFORMERS_MODELS = {
    'multilingual-e5-small': {
        name: 'Xenova/multilingual-e5-small',
        size: '~470MB',
        dimensions: 384,
    },
    'paraphrase-multilingual-MiniLM-L12-v2': {
        name: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        size: '~470MB',
        dimensions: 384,
    },
    'all-MiniLM-L6-v2': {
        name: 'Xenova/all-MiniLM-L6-v2',
        size: '~25MB',
        dimensions: 384,
    },
    'bge-small-en-v1.5': {
        name: 'Xenova/bge-small-en-v1.5',
        size: '~130MB',
        dimensions: 384,
    },
};

// Cached pipeline and state
let cachedPipeline = null;
let cachedModelId = null;
let loadingPromise = null;

// Status callback for UI updates
let statusCallback = null;

/**
 * Set callback for embedding status updates
 * @param {Function} callback - Function(status: string) to call on status change
 */
export function setEmbeddingStatusCallback(callback) {
    statusCallback = callback;
}

/**
 * Update embedding status in UI
 * @param {string} status - Status message
 */
function updateStatus(status) {
    if (statusCallback) {
        statusCallback(status);
    }
    log(`Embedding status: ${status}`);
}

/**
 * Get current embedding model status
 * @returns {string} Current status
 */
export function getEmbeddingStatus() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings?.embeddingSource || 'multilingual-e5-small';

    if (source === 'ollama') {
        if (settings?.ollamaUrl && settings?.embeddingModel) {
            return `Ollama: ${settings.embeddingModel}`;
        }
        return 'Ollama: Not configured';
    }

    const modelConfig = TRANSFORMERS_MODELS[source];
    if (!modelConfig) {
        return 'Unknown model';
    }

    if (cachedPipeline && cachedModelId === source) {
        return `${source} (${modelConfig.size}) ✓`;
    }

    if (loadingPromise && cachedModelId === source) {
        return `Loading ${source}...`;
    }

    return `${source} (${modelConfig.size})`;
}

/**
 * Load Transformers.js pipeline with progress tracking
 * @param {string} modelKey - Model key from TRANSFORMERS_MODELS
 * @returns {Promise<Object>} Pipeline object
 */
async function loadTransformersPipeline(modelKey) {
    const modelConfig = TRANSFORMERS_MODELS[modelKey];
    if (!modelConfig) {
        throw new Error(`Unknown model: ${modelKey}`);
    }

    // Return cached pipeline if same model
    if (cachedPipeline && cachedModelId === modelKey) {
        return cachedPipeline;
    }

    // Wait for existing load if in progress for same model
    if (loadingPromise && cachedModelId === modelKey) {
        return loadingPromise;
    }

    // Clear old cache if switching models
    if (cachedModelId !== modelKey) {
        cachedPipeline = null;
    }
    cachedModelId = modelKey;

    updateStatus(`Loading ${modelKey}...`);

    loadingPromise = (async () => {
        try {
            // Dynamic import of Transformers.js
            const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1');

            const pipe = await pipeline('feature-extraction', modelConfig.name, {
                progress_callback: (progress) => {
                    if (progress.status === 'progress' && progress.total) {
                        const pct = Math.round((progress.loaded / progress.total) * 100);
                        updateStatus(`Loading ${modelKey}: ${pct}%`);
                    }
                },
            });

            cachedPipeline = pipe;
            updateStatus(`${modelKey} (${modelConfig.size}) ✓`);
            return pipe;
        } catch (error) {
            updateStatus(`Failed to load ${modelKey}`);
            cachedPipeline = null;
            loadingPromise = null;
            throw error;
        }
    })();

    return loadingPromise;
}

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
 * @returns {boolean} True if embedding source is configured
 */
export function isEmbeddingsEnabled() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings?.embeddingSource || 'multilingual-e5-small';

    if (source === 'ollama') {
        return !!(settings?.ollamaUrl && settings?.embeddingModel);
    }

    // Transformers.js models are always available
    return !!TRANSFORMERS_MODELS[source];
}

/**
 * Get embedding for text via Transformers.js
 * @param {string} text - Text to embed
 * @returns {Promise<number[]|null>} Embedding vector or null if unavailable
 */
async function getTransformersEmbedding(text) {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings?.embeddingSource || 'multilingual-e5-small';

    if (!text || text.trim().length === 0) {
        return null;
    }

    try {
        const pipe = await loadTransformersPipeline(source);
        const output = await pipe(text.trim(), { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    } catch (error) {
        log(`Transformers embedding error: ${error.message}`);
        return null;
    }
}

/**
 * Get embedding for text via Ollama
 * @param {string} text - Text to embed
 * @returns {Promise<number[]|null>} Embedding vector or null if unavailable
 */
async function getOllamaEmbedding(text) {
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
        log(`Ollama embedding error: ${error.message}`);
        return null;
    }
}

/**
 * Get embedding for text using configured source
 * @param {string} text - Text to embed
 * @returns {Promise<number[]|null>} Embedding vector or null if unavailable
 */
export async function getEmbedding(text) {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings?.embeddingSource || 'multilingual-e5-small';

    if (source === 'ollama') {
        return getOllamaEmbedding(text);
    }

    return getTransformersEmbedding(text);
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

    // Process in batches of 5
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
