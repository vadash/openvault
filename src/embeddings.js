/**
 * OpenVault Embeddings
 *
 * Local vector embeddings via Transformers.js or Ollama for semantic similarity search.
 * Supports multiple embedding models with lazy loading.
 */

import { extensionName } from './constants.js';
import { getDeps } from './deps.js';
import { record } from './perf/store.js';
import { getSessionSignal } from './state.js';
import { hasEmbedding, setEmbedding, markStSynced } from './utils/embedding-codec.js';
import { logDebug, logError, logInfo } from './utils/logging.js';

// =============================================================================
// ST Vector Storage ID Prefix Utilities
// =============================================================================

/**
 * Prefix marker for embedding OpenVault IDs in ST Vector text fields.
 * Format: [OV_ID:entity_id] Actual summary text...
 */
const OV_ID_PREFIX_START = '[OV_ID:';
const OV_ID_PREFIX_END = '] ';

/**
 * Create text with embedded OpenVault ID for ST Vector Storage.
 * @param {string} id - OpenVault entity ID (e.g., "event_123", "Alice")
 * @param {string} text - Summary text
 * @returns {string} Text with ID prefix
 */
function createTextWithId(id, text) {
    return `${OV_ID_PREFIX_START}${id}${OV_ID_PREFIX_END}${text}`;
}

/**
 * Extract OpenVault ID from ST Vector text field.
 * @param {string} text - Text that may contain ID prefix
 * @returns {{id: string|null, text: string}} Extracted ID and clean text
 */
function extractIdFromText(text) {
    if (!text || !text.startsWith(OV_ID_PREFIX_START)) {
        return { id: null, text: text || '' };
    }
    const endIdx = text.indexOf(OV_ID_PREFIX_END);
    if (endIdx === -1) {
        return { id: null, text };
    }
    const id = text.slice(OV_ID_PREFIX_START.length, endIdx);
    const cleanText = text.slice(endIdx + OV_ID_PREFIX_END.length);
    return { id, text: cleanText };
}

/**
 * Generate a 53-bit numeric hash from string for ST Vector hash field.
 * Uses Cyrb53 algorithm to avoid collisions - with 53-bit output, collision
 * probability is negligible even with millions of items (unlike djb2's 32-bit).
 * ST requires numeric hashes for its Vectra backend.
 * @param {string} str - String to hash
 * @param {number} [seed=0] - Optional seed for different hash sequences
 * @returns {number} 53-bit numeric hash (safe JavaScript integer)
 */
function hashStringToNumber(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed,
        h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return Math.abs(4294967296 * (2097151 & h2) + (h1 >>> 0));
}

// =============================================================================
// Strategy Classes (from src/embeddings/strategies.js)
// =============================================================================

// =============================================================================
// Base Strategy Interface
// =============================================================================

/**
 * Base class for embedding strategies.
 * Subclasses must implement all required methods.
 */
class EmbeddingStrategy {
    /**
     * Get the unique identifier for this strategy
     * @returns {string} Strategy identifier
     */
    getId() {
        throw new Error('getId() must be implemented by subclass');
    }

    /**
     * Check if this strategy is configured and ready to use
     * @returns {boolean} True if strategy is enabled
     */
    isEnabled() {
        throw new Error('isEnabled() must be implemented by subclass');
    }

    /**
     * Get human-readable status description
     * @returns {string} Status description
     */
    getStatus() {
        throw new Error('getStatus() must be implemented by subclass');
    }

    /**
     * Get embedding vector for text
     * @param {string} text - Text to embed
     * @param {Object} options - Options
     * @param {AbortSignal} options.signal - AbortSignal
     * @returns {Promise<Float32Array|null>} Embedding vector or null if unavailable
     */
    async getEmbedding(_text, _options = {}) {
        throw new Error('getEmbedding() must be implemented by subclass');
    }

    /**
     * Get query embedding (with query-side prefix for asymmetric search)
     * @param {string} text - Query text
     * @param {Object} options - Options
     * @param {AbortSignal} options.signal - AbortSignal
     * @returns {Promise<Float32Array|null>} Embedding vector or null
     */
    async getQueryEmbedding(_text, _options = {}) {
        throw new Error('getQueryEmbedding() must be implemented by subclass');
    }

    /**
     * Get document embedding (with doc-side prefix for asymmetric search)
     * @param {string} text - Document text
     * @param {Object} options - Options
     * @param {AbortSignal} options.signal - AbortSignal
     * @returns {Promise<Float32Array|null>} Embedding vector or null
     */
    async getDocumentEmbedding(_text, _options = {}) {
        throw new Error('getDocumentEmbedding() must be implemented by subclass');
    }

    /**
     * Reset any cached state (e.g., loaded models)
     * @returns {Promise<void>}
     */
    async reset() {
        // Default: no-op
    }

    /**
     * Check if this strategy uses external storage (ST Vector Storage)
     * @returns {boolean} True if strategy delegates storage to external system
     */
    usesExternalStorage() {
        return false;
    }

    /**
     * Insert items into external vector storage
     * @param {Object[]} items - Items to insert [{ id, summary, type? }]
     * @param {Object} options - Options
     * @param {AbortSignal} options.signal - AbortSignal
     * @returns {Promise<boolean>} True if successful
     */
    async insertItems(_items, _options = {}) {
        return false;
    }

    /**
     * Search for similar items in external vector storage
     * @param {string} queryText - Query text
     * @param {number} topK - Number of results
     * @param {number} threshold - Similarity threshold
     * @param {Object} options - Options
     * @param {AbortSignal} options.signal - AbortSignal
     * @returns {Promise<{id: string, text: string, score?: number}[]|null>} Search results or null
     */
    async searchItems(_queryText, _topK, _threshold, _options = {}) {
        return null;
    }

    /**
     * Delete items from external vector storage
     * @param {string[]} ids - Item IDs to delete
     * @param {Object} options - Options
     * @param {AbortSignal} options.signal - AbortSignal
     * @returns {Promise<boolean>} True if successful
     */
    async deleteItems(_ids, _options = {}) {
        return false;
    }

    /**
     * Purge entire collection from external vector storage
     * @param {Object} options - Options
     * @param {AbortSignal} options.signal - AbortSignal
     * @returns {Promise<boolean>} True if successful
     */
    async purgeCollection(_options = {}) {
        return false;
    }
}

// =============================================================================
// Transformers.js Strategy
// =============================================================================

const TRANSFORMERS_MODELS = {
    'multilingual-e5-small': {
        name: 'Xenova/multilingual-e5-small',
        dtypeWebGPU: 'fp16',
        dtypeWASM: 'q8',
        dimensions: 384,
        description: '384d · 118M params · 100+ langs · MTEB: 55.8',
        optimalChunkSize: 250, // Cyrillic-safe: 250 × ~1.5 tok/char ≈ 375 tokens (within 512 limit)
    },
    'bge-small-en-v1.5': {
        name: 'Xenova/bge-small-en-v1.5',
        dtypeWebGPU: 'q4f16',
        dtypeWASM: 'q8',
        dimensions: 384,
        description: '384d · 133MB · English · MTEB: 62.17 · SOTA RAG',
        optimalChunkSize: 500, // chars, conservative for 512 tokens
    },
    'embeddinggemma-300m': {
        name: 'onnx-community/embeddinggemma-300m-ONNX',
        dtypeWebGPU: 'q4', // fp16 not supported; q4 is fast and compact
        dtypeWASM: null, // Not supported on WASM - requires WebGPU
        dimensions: 768,
        description: '768d · 300M params · 100+ langs · MTEB: 61.2 · WebGPU only',
        requiresWebGPU: true,
        optimalChunkSize: 1800, // ~512 tokens for Cyrillic text
    },
};

let webGPUSupported = null;

async function isWebGPUAvailable() {
    if (webGPUSupported !== null) {
        return webGPUSupported;
    }

    try {
        // Use globalThis.navigator?.gpu for safest access across all environments
        const gpu = globalThis.navigator?.gpu;
        if (!gpu) {
            logDebug('WebGPU: not available in this context');
            webGPUSupported = false;
            return false;
        }
        const adapter = await gpu.requestAdapter();
        webGPUSupported = !!adapter;
        logDebug(`WebGPU ${webGPUSupported ? 'available' : 'adapter request failed'}`);
        return webGPUSupported;
    } catch (error) {
        logDebug(`WebGPU detection error: ${error.message}`);
        webGPUSupported = false;
        return false;
    }
}

class TransformersStrategy extends EmbeddingStrategy {
    #cachedPipeline = null;
    #cachedModelId = null;
    #cachedDevice = null;
    #loadingPromise = null;
    #statusCallback = null;
    #currentModelKey = null;

    constructor() {
        super();
        this.#currentModelKey = 'multilingual-e5-small';
    }

    getId() {
        return 'transformers';
    }

    setModelKey(modelKey) {
        this.#currentModelKey = modelKey;
    }

    getModelKey() {
        return this.#currentModelKey;
    }

    setStatusCallback(callback) {
        this.#statusCallback = callback;
    }

    isEnabled() {
        return !!TRANSFORMERS_MODELS[this.#currentModelKey];
    }

    getStatus() {
        const modelConfig = TRANSFORMERS_MODELS[this.#currentModelKey];
        if (!modelConfig) {
            return 'Unknown model';
        }

        const shortName = this.#currentModelKey.split('-').slice(0, 2).join('-');

        if (this.#cachedPipeline && this.#cachedModelId === this.#currentModelKey) {
            const deviceLabel = this.#cachedDevice === 'webgpu' ? 'WebGPU' : 'WASM';
            return `${shortName} (${deviceLabel}) ✓`;
        }

        if (this.#loadingPromise && this.#cachedModelId === this.#currentModelKey) {
            return `Loading ${shortName}...`;
        }

        return `${shortName}`;
    }

    async #loadPipeline(modelKey) {
        const modelConfig = TRANSFORMERS_MODELS[modelKey];
        if (!modelConfig) {
            throw new Error(`Unknown model: ${modelKey}`);
        }

        if (this.#cachedPipeline && this.#cachedModelId === modelKey) {
            return this.#cachedPipeline;
        }

        if (this.#loadingPromise && this.#cachedModelId === modelKey) {
            return this.#loadingPromise;
        }

        if (this.#cachedModelId !== modelKey) {
            this.#cachedPipeline = null;
        }
        this.#cachedModelId = modelKey;

        this.#updateStatus(`Loading ${modelKey}...`);

        this.#loadingPromise = (async () => {
            try {
                const useWebGPU = await isWebGPUAvailable();

                // Check if model requires WebGPU
                if (modelConfig.requiresWebGPU && !useWebGPU) {
                    throw new Error(`${modelKey} requires WebGPU which is not available`);
                }

                const device = useWebGPU ? 'webgpu' : 'wasm';
                const dtype = useWebGPU ? modelConfig.dtypeWebGPU : modelConfig.dtypeWASM;

                logDebug(`Loading ${modelKey} with ${device} (${dtype})`);

                const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1');

                let lastReportedPct = 0;
                const pipe = await pipeline('feature-extraction', modelConfig.name, {
                    device,
                    dtype,
                    progress_callback: (progress) => {
                        if (progress.status === 'progress' && progress.total) {
                            const pct = Math.round((progress.loaded / progress.total) * 100);
                            if (pct >= lastReportedPct + 25) {
                                lastReportedPct = Math.floor(pct / 25) * 25;
                                this.#updateStatus(`Loading ${modelKey}: ${lastReportedPct}%`);
                            }
                        }
                    },
                });

                this.#cachedPipeline = pipe;
                this.#cachedDevice = device;
                const deviceLabel = useWebGPU ? 'WebGPU' : 'WASM';
                this.#updateStatus(`${modelKey} (${deviceLabel}) ✓`);
                return pipe;
            } catch (error) {
                this.#updateStatus(`Failed to load ${modelKey}`);
                this.#cachedPipeline = null;
                this.#cachedDevice = null;
                this.#loadingPromise = null;
                throw error;
            }
        })();

        return this.#loadingPromise;
    }

    #updateStatus(status) {
        if (this.#statusCallback) {
            this.#statusCallback(status);
        }
        logDebug(`Embedding status: ${status}`);
    }

    async #embed(text, prefix, { signal } = {}) {
        if (!text || text.trim().length === 0) {
            return null;
        }

        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        try {
            const pipe = await this.#loadPipeline(this.#currentModelKey);
            const input = prefix ? `${prefix}${text.trim()}` : text.trim();
            const output = await pipe(input, { pooling: 'mean', normalize: true, signal });
            return output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            logError('Transformers embedding failed', error, {
                modelName: this.#currentModelKey,
                textSnippet: text?.slice(0, 100),
            });
            return null;
        }
    }

    async getQueryEmbedding(text, { signal } = {}) {
        const settings = getDeps().getExtensionSettings()[extensionName];
        const prefix = settings.embeddingQueryPrefix;
        return this.#embed(text, prefix, { signal });
    }

    async getDocumentEmbedding(text, { signal } = {}) {
        const settings = getDeps().getExtensionSettings()[extensionName];
        const prefix = settings.embeddingDocPrefix;
        return this.#embed(text, prefix, { signal });
    }

    async reset() {
        this.#cachedPipeline = null;
        this.#cachedModelId = null;
        this.#cachedDevice = null;
        this.#loadingPromise = null;
    }
}

// =============================================================================
// Ollama Strategy
// =============================================================================

class OllamaStrategy extends EmbeddingStrategy {
    getId() {
        return 'ollama';
    }

    #getSettings() {
        const settings = getDeps().getExtensionSettings()[extensionName];
        return {
            url: settings?.ollamaUrl,
            model: settings?.embeddingModel,
        };
    }

    isEnabled() {
        const { url, model } = this.#getSettings();
        return !!(url && model);
    }

    getStatus() {
        const { url, model } = this.#getSettings();
        if (url && model) {
            return `Ollama: ${model}`;
        }
        return 'Ollama: Not configured';
    }

    async getEmbedding(text, { signal } = {}) {
        const { url, model } = this.#getSettings();

        if (!url || !model) {
            return null;
        }

        if (!text || text.trim().length === 0) {
            return null;
        }

        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        try {
            const cleanUrl = url.replace(/\/+$/, '');
            const response = await getDeps().fetch(`${cleanUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: model,
                    prompt: text.trim(),
                }),
                signal,
            });

            if (!response.ok) {
                logDebug(`Ollama embedding request failed: ${response.status} ${response.statusText}`);
                return null;
            }

            const data = await response.json();
            return data.embedding ? new Float32Array(data.embedding) : null;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            logError('Ollama embedding failed', error, {
                modelName: this.#getSettings().model,
                textSnippet: text?.slice(0, 100),
            });
            return null;
        }
    }

    async getQueryEmbedding(text, { signal } = {}) {
        return this.getEmbedding(text, { signal });
    }

    async getDocumentEmbedding(text, { signal } = {}) {
        return this.getEmbedding(text, { signal });
    }
}

// =============================================================================
// ST Vector Storage Strategy
// =============================================================================

class StVectorStrategy extends EmbeddingStrategy {
    getId() {
        return 'st-vectors';
    }

    isEnabled() {
        const settings = getDeps().getExtensionSettings()?.vectors;
        return !!(settings?.source);
    }

    getStatus() {
        const settings = getDeps().getExtensionSettings()?.vectors;
        const source = settings?.source || 'not configured';
        const model = settings?.[`${source}_model`] || '';
        return `ST: ${source}${model ? ` / ${model}` : ''}`;
    }

    usesExternalStorage() {
        return true;
    }

    async getQueryEmbedding() {
        return null;
    }

    async getDocumentEmbedding() {
        return null;
    }

    #getSource() {
        const settings = getDeps().getExtensionSettings()?.vectors;
        return settings?.source || 'transformers';
    }

    async #getCollectionId() {
        const { getCurrentChatId } = await import('./utils/data.js');
        const chatId = getCurrentChatId() || 'default';
        const source = this.#getSource();
        return `openvault-${chatId}-${source}`;
    }

    async insertItems(items, { signal } = {}) {
        try {
            const source = this.#getSource();
            const settings = getDeps().getExtensionSettings()?.vectors;
            const model = settings?.[`${source}_model`];

            // Build items with ID prefix in text
            const itemsForSt = items.map((item) => ({
                hash: hashStringToNumber(item.id),
                text: createTextWithId(item.id, item.summary),
                index: 0,
            }));

            const body = {
                collectionId: await this.#getCollectionId(),
                source,
                items: itemsForSt,
            };

            if (model) {
                body.model = model;
            }

            const response = await getDeps().fetch('/api/vector/insert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal,
            });
            return response.ok;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            logError('ST Vector insert failed', error);
            return false;
        }
    }

    async searchItems(queryText, topK, threshold, { signal } = {}) {
        try {
            const source = this.#getSource();
            const settings = getDeps().getExtensionSettings()?.vectors;
            const model = settings?.[`${source}_model`];

            const body = {
                collectionId: await this.#getCollectionId(),
                source,
                searchText: queryText,
                topK,
                threshold,
            };

            if (model) {
                body.model = model;
            }

            const response = await getDeps().fetch('/api/vector/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal,
            });

            if (!response.ok) {
                return [];
            }

            const data = await response.json();

            // Extract IDs from text prefix, fall back to hash
            return data.hashes.map((hash, i) => {
                const rawText = data.metadata[i]?.text || '';
                const { id, text } = extractIdFromText(rawText);
                return {
                    id: id || String(hash),
                    text,
                    score: data.scores?.[i],
                };
            });
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            logError('ST Vector search failed', error);
            return [];
        }
    }

    async deleteItems(ids, { signal } = {}) {
        try {
            const numericHashes = ids.map((id) => hashStringToNumber(id));

            const source = this.#getSource();
            const settings = getDeps().getExtensionSettings()?.vectors;
            const model = settings?.[`${source}_model`];

            const body = {
                collectionId: await this.#getCollectionId(),
                source,
                hashes: numericHashes,
            };

            if (model) {
                body.model = model;
            }

            const response = await getDeps().fetch('/api/vector/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal,
            });
            return response.ok;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            logError('ST Vector delete failed', error);
            return false;
        }
    }

    async purgeCollection({ signal } = {}) {
        try {
            const response = await getDeps().fetch('/api/vector/purge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    collectionId: await this.#getCollectionId(),
                }),
                signal,
            });
            return response.ok;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            logError('ST Vector purge failed', error);
            return false;
        }
    }
}

// =============================================================================
// Strategy Registry
// =============================================================================

const strategies = {
    'multilingual-e5-small': new TransformersStrategy(),
    'bge-small-en-v1.5': new TransformersStrategy(),
    'embeddinggemma-300m': new TransformersStrategy(),
    ollama: new OllamaStrategy(),
    'st-vectors': new StVectorStrategy(),
};

// Configure model-specific transformers strategies
strategies['multilingual-e5-small'].setModelKey('multilingual-e5-small');
strategies['bge-small-en-v1.5'].setModelKey('bge-small-en-v1.5');
strategies['embeddinggemma-300m'].setModelKey('embeddinggemma-300m');

/**
 * Get the strategy for a given source key
 * @param {string} source - Source key (e.g., 'ollama', 'multilingual-e5-small')
 * @returns {EmbeddingStrategy} Strategy instance
 */
function getStrategy(source) {
    return strategies[source] || strategies['multilingual-e5-small'];
}

/**
 * Get all available source keys
 * @returns {string[]} Array of source keys
 */
function _getAvailableSources() {
    return Object.keys(strategies);
}

/**
 * Set the status callback for all strategies
 * @param {Function} callback - Status callback
 */
function setGlobalStatusCallback(callback) {
    Object.values(strategies).forEach((strategy) => {
        if (strategy.setStatusCallback) {
            strategy.setStatusCallback(callback);
        }
    });
}

/**
 * Get the optimal chunk size for the currently configured embedding strategy
 * @returns {number} Optimal chunk size in characters
 */
function getOptimalChunkSize() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;

    // For Transformers models, get from model config
    if (TRANSFORMERS_MODELS[source]) {
        return TRANSFORMERS_MODELS[source].optimalChunkSize || 1000;
    }

    // For Ollama, use a safe default
    if (source === 'ollama') {
        return 800;
    }

    // Fallback default
    return 1000;
}

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
    const source = settings.embeddingSource;
    const strategy = getStrategy(source);
    return strategy.getStatus();
}

/**
 * Check if embeddings are configured and available
 * @returns {boolean} True if embedding source is configured
 */
export function isEmbeddingsEnabled() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;
    const strategy = getStrategy(source);
    return strategy.isEnabled();
}

// LRU cache for embedding results to avoid redundant API calls
// Maximum cache size prevents unbounded memory growth during long sessions
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
    const result = await strategy.getQueryEmbedding(text, { signal });

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
    const result = await strategy.getDocumentEmbedding(summary, { signal });

    if (embeddingCache.size >= MAX_CACHE_SIZE) {
        const firstKey = embeddingCache.keys().next().value;
        if (firstKey !== undefined) embeddingCache.delete(firstKey);
    }
    embeddingCache.set(cacheKey, result);
    return result;
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

// =============================================================================
// Batch Operations
// =============================================================================

/**
 * Generate embeddings for multiple memories that don't have them yet
 * @param {Object[]} memories - Memories to embed
 * @param {Object} options - Options
 * @param {AbortSignal} options.signal - AbortSignal
 * @returns {Promise<number>} Number of memories successfully embedded
 */
export async function generateEmbeddingsForMemories(memories, { signal } = {}) {
    signal ??= getSessionSignal();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!isEmbeddingsEnabled()) {
        return 0;
    }

    const validMemories = memories.filter((m) => m.summary && !hasEmbedding(m));

    if (validMemories.length === 0) {
        return 0;
    }

    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;
    const strategy = getStrategy(source);

    const embeddings = await processInBatches(validMemories, 5, async (m) => {
        return strategy.getDocumentEmbedding(m.summary, { signal });
    });

    let count = 0;
    for (let i = 0; i < validMemories.length; i++) {
        if (embeddings[i]) {
            setEmbedding(validMemories[i], embeddings[i]);
            count++;
        }
    }

    return count;
}

/**
 * Enrich events with embeddings (mutates events in place)
 * @param {Object[]} events - Events to enrich with embeddings
 * @param {Object} options - Options
 * @param {AbortSignal} options.signal - AbortSignal
 * @returns {Promise<number>} Number of events successfully embedded
 */
export async function enrichEventsWithEmbeddings(events, { signal } = {}) {
    signal ??= getSessionSignal();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!isEmbeddingsEnabled()) {
        return 0;
    }

    const validEvents = events.filter((e) => e.summary && !hasEmbedding(e));

    if (validEvents.length === 0) {
        return 0;
    }

    logDebug(`Generating embeddings for ${validEvents.length} events`);

    const t0 = performance.now();
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;
    const strategy = getStrategy(source);

    const embeddings = await processInBatches(validEvents, 5, async (e) => {
        if (settings?.debugMode) {
            logDebug(`Embedding doc: "${e.summary}"`);
        }
        return strategy.getDocumentEmbedding(e.summary, { signal });
    });

    let count = 0;
    for (let i = 0; i < validEvents.length; i++) {
        if (embeddings[i]) {
            setEmbedding(validEvents[i], embeddings[i]);
            count++;
        }
    }

    record('embedding_generation', performance.now() - t0, `${validEvents.length} embeddings via ${source}`);
    return count;
}

// =============================================================================
// Comprehensive Backfill
// =============================================================================

/**
 * Backfill ALL embedding types: memories, graph nodes, and communities.
 * Used by the UI button and auto-triggered after embedding model invalidation.
 * @param {Object} options - Options
 * @param {AbortSignal} options.signal - AbortSignal
 * @param {boolean} options.silent - If true, suppress toasts (for auto-trigger)
 * @returns {Promise<{memories: number, nodes: number, communities: number, total: number, skipped: boolean}>}
 */
export async function backfillAllEmbeddings({ signal, silent = false } = {}) {
    signal ??= getSessionSignal();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const { MEMORIES_KEY } = await import('./constants.js');
    const { getOpenVaultData, saveOpenVaultData } = await import('./utils/data.js');
    const { setStatus } = await import('./ui/status.js');
    const { showToast } = await import('./utils/dom.js');

    if (!isEmbeddingsEnabled()) {
        if (!silent) showToast('warning', 'Configure embedding source first');
        return { memories: 0, nodes: 0, communities: 0, total: 0, skipped: false };
    }

    const data = getOpenVaultData();
    if (!data) {
        if (!silent) showToast('warning', 'No chat data available');
        return { memories: 0, nodes: 0, communities: 0, total: 0, skipped: false };
    }

    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;
    const strategy = getStrategy(source);

    // Handle external storage strategies (ST Vector Storage)
    if (strategy.usesExternalStorage()) {
        // Filter to items that need syncing (not already marked with _st_synced)
        const memories = (data[MEMORIES_KEY] || []).filter((m) => m.summary && !hasEmbedding(m));
        const nodes = Object.values(data.graph?.nodes || {}).filter((n) => !hasEmbedding(n));
        const communities = Object.values(data.communities || {}).filter((c) => c.summary && !hasEmbedding(c));
        const totalNeeded = memories.length + nodes.length + communities.length;

        if (totalNeeded === 0) {
            return { memories: 0, nodes: 0, communities: 0, total: 0, skipped: true };
        }

        if (!silent) showToast('info', `Syncing ${totalNeeded} items to ST Vector Storage...`);
        setStatus('extracting');

        try {
            const memoryItems = memories.map((m) => ({
                id: m.id,
                summary: m.summary,
                targetObject: m,
            }));

            const nodeItems = nodes.map((n) => ({
                id: n.name,
                summary: `${n.type}: ${n.name} - ${n.description}`,
                targetObject: n,
            }));

            const communityItems = Object.entries(data.communities || {})
                .filter(([_, c]) => c.summary && !hasEmbedding(c))
                .map(([key, c]) => ({
                    id: key,
                    summary: c.summary,
                    targetObject: c,
                }));

            const allItems = [...memoryItems, ...nodeItems, ...communityItems];

            // CRITICAL: Batch inserts to prevent network timeouts
            // Use batch size of 100 (conservative for API limits)
            const BATCH_SIZE = 100;
            let successCount = 0;

            for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
                const batch = allItems.slice(i, i + BATCH_SIZE);
                const success = await strategy.insertItems(
                    batch.map((item) => ({ id: item.id, summary: item.summary }))
                );

                if (success) {
                    // Mark batch items as synced
                    for (const item of batch) {
                        markStSynced(item.targetObject);
                    }
                    successCount += batch.length;
                }

                // Yield to main thread between batches
                if (i + BATCH_SIZE < allItems.length) {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }

            if (successCount > 0) {
                await saveOpenVaultData();
                logInfo(
                    `ST Vector sync complete: ${successCount} items synced in ${Math.ceil(allItems.length / BATCH_SIZE)} batches`
                );
            }

            return {
                memories: memoryItems.length,
                nodes: nodeItems.length,
                communities: communityItems.length,
                total: successCount,
                skipped: false,
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            logError('ST Vector sync error', error);
            if (!silent) showToast('error', `ST Vector sync failed: ${error.message}`);
            return { memories: 0, nodes: 0, communities: 0, total: 0, skipped: false };
        } finally {
            setStatus('ready');
        }
    }

    // Local embedding strategies (Transformers, Ollama)

    // Count what needs embedding
    const memories = (data[MEMORIES_KEY] || []).filter((m) => m.summary && !hasEmbedding(m));
    const nodes = Object.values(data.graph?.nodes || {}).filter((n) => !hasEmbedding(n));
    const communities = Object.values(data.communities || {}).filter((c) => c.summary && !hasEmbedding(c));
    const totalNeeded = memories.length + nodes.length + communities.length;

    if (totalNeeded === 0) {
        return { memories: 0, nodes: 0, communities: 0, total: 0, skipped: true };
    }

    if (!silent) showToast('info', `Generating ${totalNeeded} embeddings...`);
    setStatus('extracting');

    try {
        // 1. Memory embeddings
        const memoryCount = await generateEmbeddingsForMemories(memories, { signal });

        // 2. Graph node embeddings
        let nodeCount = 0;
        if (nodes.length > 0) {
            const nodeEmbeddings = await processInBatches(nodes, 5, async (n) => {
                return strategy.getDocumentEmbedding(`${n.type}: ${n.name} - ${n.description}`, { signal });
            });
            for (let i = 0; i < nodes.length; i++) {
                if (nodeEmbeddings[i]) {
                    setEmbedding(nodes[i], nodeEmbeddings[i]);
                    nodeCount++;
                }
            }
        }

        // 3. Community embeddings
        let communityCount = 0;
        if (communities.length > 0) {
            const communityEmbeddings = await processInBatches(communities, 5, async (c) => {
                return getQueryEmbedding(c.summary, { signal });
            });
            for (let i = 0; i < communities.length; i++) {
                if (communityEmbeddings[i]) {
                    setEmbedding(communities[i], communityEmbeddings[i]);
                    communityCount++;
                }
            }
        }

        const total = memoryCount + nodeCount + communityCount;
        if (total > 0) {
            await saveOpenVaultData();
            logInfo(`Backfill complete: ${memoryCount} memories, ${nodeCount} nodes, ${communityCount} communities`);
        }

        return { memories: memoryCount, nodes: nodeCount, communities: communityCount, total, skipped: false };
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        logError('Backfill embeddings error', error);
        if (!silent) showToast('error', `Embedding generation failed: ${error.message}`);
        return { memories: 0, nodes: 0, communities: 0, total: 0, skipped: false };
    } finally {
        setStatus('ready');
    }
}

// =============================================================================
// Exports
// =============================================================================

export { getStrategy };
export { TRANSFORMERS_MODELS };
export { getOptimalChunkSize };
export { extractIdFromText, hashStringToNumber };
