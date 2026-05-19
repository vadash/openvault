import { EMBEDDING_SOURCES, extensionName } from './constants.js';
import { getDeps } from './deps.js';
import { record } from './perf/store.js';
import { getSessionSignal } from './state.js';
import { cdnImport } from './utils/cdn.js';
import { hasEmbedding, setEmbedding } from './utils/embedding-codec.js';
import { logDebug, logError, logInfo } from './utils/logging.js';

// =============================================================================
// Transformers.js Models Configuration
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

// =============================================================================
// Transformers.js Pipeline Management
// =============================================================================

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

// Cached pipeline state
let cachedPipeline = null;
let cachedModelKey = null;
let cachedDevice = null;
let loadingPromise = null;
let statusCallback = null;

/**
 * Set the status callback for embedding loading updates
 * @param {Function} callback - Status callback function
 */
export function setEmbeddingStatusCallback(callback) {
    statusCallback = callback;
}

function updateStatus(status) {
    if (statusCallback) {
        statusCallback(status);
    }
    logDebug(`Embedding status: ${status}`);
}

async function loadPipeline(modelKey) {
    const modelConfig = TRANSFORMERS_MODELS[modelKey];
    if (!modelConfig) {
        throw new Error(`Unknown model: ${modelKey}`);
    }

    if (cachedPipeline && cachedModelKey === modelKey) {
        return cachedPipeline;
    }

    if (loadingPromise && cachedModelKey === modelKey) {
        return loadingPromise;
    }

    if (cachedModelKey !== modelKey) {
        cachedPipeline = null;
    }
    cachedModelKey = modelKey;

    updateStatus(`Loading ${modelKey}...`);

    loadingPromise = (async () => {
        try {
            const useWebGPU = await isWebGPUAvailable();

            // Check if model requires WebGPU
            if (modelConfig.requiresWebGPU && !useWebGPU) {
                throw new Error(`${modelKey} requires WebGPU which is not available`);
            }

            const device = useWebGPU ? 'webgpu' : 'wasm';
            const dtype = useWebGPU ? modelConfig.dtypeWebGPU : modelConfig.dtypeWASM;

            logDebug(`Loading ${modelKey} with ${device} (${dtype})`);

            const { pipeline } = await cdnImport('@huggingface/transformers');

            let lastReportedPct = 0;
            const pipe = await pipeline('feature-extraction', modelConfig.name, {
                device,
                dtype,
                progress_callback: (progress) => {
                    if (progress.status === 'progress' && progress.total) {
                        const pct = Math.round((progress.loaded / progress.total) * 100);
                        if (pct >= lastReportedPct + 25) {
                            lastReportedPct = Math.floor(pct / 25) * 25;
                            updateStatus(`Loading ${modelKey}: ${lastReportedPct}%`);
                        }
                    }
                },
            });

            cachedPipeline = pipe;
            cachedDevice = device;
            const deviceLabel = useWebGPU ? 'WebGPU' : 'WASM';
            updateStatus(`${modelKey} (${deviceLabel}) ✓`);
            return pipe;
        } catch (error) {
            updateStatus(`Failed to load ${modelKey}`);
            cachedPipeline = null;
            cachedDevice = null;
            loadingPromise = null;
            throw error;
        }
    })();

    return loadingPromise;
}

/**
 * Reset the cached pipeline (useful for model switches or error recovery)
 * @returns {Promise<void>}
 */
export async function resetPipeline() {
    cachedPipeline = null;
    cachedModelKey = null;
    cachedDevice = null;
    loadingPromise = null;
}

// =============================================================================
// Ollama Embedding Functions
// =============================================================================

/**
 * Test Ollama connection by fetching model list
 * @param {string} url - Ollama base URL (e.g., 'http://localhost:11434')
 * @returns {Promise<boolean>} True if connection successful
 * @throws {Error} If HTTP error or network error occurs
 */
export async function testOllamaConnection(url) {
    const cleanUrl = url.replace(/\/+$/, '');
    const response = await getDeps().fetch(`${cleanUrl}/api/tags`, {
        method: 'GET',
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return true;
}

async function getOllamaEmbedding(text, url, model, signal) {
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
            modelName: model,
            textSnippet: text?.slice(0, 100),
        });
        return null;
    }
}

// =============================================================================
// Local Transformers.js Embedding Functions
// =============================================================================

async function getTransformersEmbedding(text, modelKey, prefix, { signal } = {}) {
    if (!text || text.trim().length === 0) {
        return null;
    }

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
        const pipe = await loadPipeline(modelKey);
        const input = prefix ? `${prefix}${text.trim()}` : text.trim();
        const output = await pipe(input, { pooling: 'mean', normalize: true, signal });
        return output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        logError('Transformers embedding failed', error, {
            modelName: modelKey,
            textSnippet: text?.slice(0, 100),
        });
        return null;
    }
}

// =============================================================================
// Public API - Embedding Functions
// =============================================================================

/**
 * Get the optimal chunk size for the currently configured embedding model
 * @returns {number} Optimal chunk size in characters
 */
export function getOptimalChunkSize() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;

    // For Transformers models, get from model config
    if (TRANSFORMERS_MODELS[source]) {
        return TRANSFORMERS_MODELS[source].optimalChunkSize || 1000;
    }

    // For Ollama, use a safe default
    if (source === EMBEDDING_SOURCES.OLLAMA) {
        return 800;
    }

    // Fallback default
    return 1000;
}

/**
 * Get current embedding model status
 * @returns {string} Current status
 */
export function getEmbeddingStatus() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;

    if (TRANSFORMERS_MODELS[source]) {
        const _modelConfig = TRANSFORMERS_MODELS[source];
        const shortName = source.split('-').slice(0, 2).join('-');

        if (cachedPipeline && cachedModelKey === source) {
            const deviceLabel = cachedDevice === 'webgpu' ? 'WebGPU' : 'WASM';
            return `${shortName} (${deviceLabel}) ✓`;
        }

        if (loadingPromise && cachedModelKey === source) {
            return `Loading ${shortName}...`;
        }

        return `${shortName}`;
    }

    if (source === EMBEDDING_SOURCES.OLLAMA) {
        const { ollamaUrl, embeddingModel } = settings;
        if (ollamaUrl && embeddingModel) {
            return `Ollama: ${embeddingModel}`;
        }
        return 'Ollama: Not configured';
    }

    return 'Unknown';
}

/**
 * Check if embeddings are configured and available
 * @returns {boolean} True if embedding source is configured
 */
export function isEmbeddingsEnabled() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;

    if (TRANSFORMERS_MODELS[source]) {
        return true;
    }

    if (source === EMBEDDING_SOURCES.OLLAMA) {
        const { ollamaUrl, embeddingModel } = settings;
        return !!(ollamaUrl && embeddingModel);
    }

    return false;
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
 * Get query embedding (with query prefix applied)
 * @param {string} text - Query text
 * @param {Object} options - Options
 * @param {AbortSignal} options.signal - AbortSignal
 * @returns {Promise<Float32Array|null>} Embedding vector
 */
export async function getQueryEmbedding(text, { signal } = {}) {
    signal ??= getSessionSignal();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!text) return null;

    // Check cache (query prefix is applied, so cache on raw text + 'q:' prefix)
    const cacheKey = `q:${text}`;
    if (embeddingCache.has(cacheKey)) {
        const value = embeddingCache.get(cacheKey);
        embeddingCache.delete(cacheKey);
        embeddingCache.set(cacheKey, value);
        return value;
    }

    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;
    let result;

    if (TRANSFORMERS_MODELS[source]) {
        result = await getTransformersEmbedding(text, source, settings.embeddingQueryPrefix, { signal });
    } else if (source === EMBEDDING_SOURCES.OLLAMA) {
        const { ollamaUrl, embeddingModel } = settings;
        const prefixedText = settings.embeddingQueryPrefix ? `${settings.embeddingQueryPrefix}${text}` : text;
        result = await getOllamaEmbedding(prefixedText, ollamaUrl, embeddingModel, signal);
    } else {
        result = null;
    }

    if (result && embeddingCache.size >= MAX_CACHE_SIZE) {
        const firstKey = embeddingCache.keys().next().value;
        if (firstKey !== undefined) embeddingCache.delete(firstKey);
    }
    if (result) embeddingCache.set(cacheKey, result);
    return result;
}

/**
 * Get document embedding (with doc prefix applied)
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
    let result;

    if (TRANSFORMERS_MODELS[source]) {
        result = await getTransformersEmbedding(summary, source, settings.embeddingDocPrefix, { signal });
    } else if (source === EMBEDDING_SOURCES.OLLAMA) {
        const { ollamaUrl, embeddingModel } = settings;
        const prefixedText = settings.embeddingDocPrefix ? `${settings.embeddingDocPrefix}${summary}` : summary;
        result = await getOllamaEmbedding(prefixedText, ollamaUrl, embeddingModel, signal);
    } else {
        result = null;
    }

    if (result && embeddingCache.size >= MAX_CACHE_SIZE) {
        const firstKey = embeddingCache.keys().next().value;
        if (firstKey !== undefined) embeddingCache.delete(firstKey);
    }
    if (result) embeddingCache.set(cacheKey, result);
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

    const embeddings = await processInBatches(validMemories, 5, async (m) => {
        if (TRANSFORMERS_MODELS[source]) {
            return getTransformersEmbedding(m.summary, source, settings.embeddingDocPrefix, { signal });
        } else if (source === EMBEDDING_SOURCES.OLLAMA) {
            const { ollamaUrl, embeddingModel } = settings;
            const prefixedText = settings.embeddingDocPrefix ? `${settings.embeddingDocPrefix}${m.summary}` : m.summary;
            return getOllamaEmbedding(prefixedText, ollamaUrl, embeddingModel, signal);
        }
        return null;
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

    const embeddings = await processInBatches(validEvents, 5, async (e) => {
        if (settings?.debugMode) {
            logDebug(`Embedding doc: "${e.summary}"`);
        }
        if (TRANSFORMERS_MODELS[source]) {
            return getTransformersEmbedding(e.summary, source, settings.embeddingDocPrefix, { signal });
        } else if (source === EMBEDDING_SOURCES.OLLAMA) {
            const { ollamaUrl, embeddingModel } = settings;
            const prefixedText = settings.embeddingDocPrefix ? `${settings.embeddingDocPrefix}${e.summary}` : e.summary;
            return getOllamaEmbedding(prefixedText, ollamaUrl, embeddingModel, signal);
        }
        return null;
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
    const { getOpenVaultData, saveOpenVaultData } = await import('./store/chat-data.js');
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
                const text = `${n.type}: ${n.name} - ${n.description}`;
                if (TRANSFORMERS_MODELS[source]) {
                    return getTransformersEmbedding(text, source, settings.embeddingDocPrefix, { signal });
                } else if (source === EMBEDDING_SOURCES.OLLAMA) {
                    const { ollamaUrl, embeddingModel } = settings;
                    const prefixedText = settings.embeddingDocPrefix ? `${settings.embeddingDocPrefix}${text}` : text;
                    return getOllamaEmbedding(prefixedText, ollamaUrl, embeddingModel, signal);
                }
                return null;
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

export { TRANSFORMERS_MODELS };
