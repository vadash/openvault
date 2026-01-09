/**
 * OpenVault Embedding Strategies
 *
 * Strategy pattern for embedding providers (Transformers.js, Ollama, etc.)
 * Allows easy addition of new providers without modifying core logic.
 */

import { getDeps } from '../deps.js';
import { log } from '../utils.js';
import { extensionName } from '../constants.js';

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
     * @returns {Promise<number[]|null>} Embedding vector or null if unavailable
     */
    async getEmbedding(_text) {
        throw new Error('getEmbedding() must be implemented by subclass');
    }

    /**
     * Reset any cached state (e.g., loaded models)
     * @returns {Promise<void>}
     */
    async reset() {
        // Default: no-op
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
        optimalChunkSize: 500,  // chars, conservative for 512 tokens
    },
    'bge-small-en-v1.5': {
        name: 'Xenova/bge-small-en-v1.5',
        dtypeWebGPU: 'q4f16',
        dtypeWASM: 'q8',
        dimensions: 384,
        description: '384d · 133MB · English · MTEB: 62.17 · SOTA RAG',
        optimalChunkSize: 500,  // chars, conservative for 512 tokens
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
            log('WebGPU: not available in this context');
            webGPUSupported = false;
            return false;
        }
        const adapter = await gpu.requestAdapter();
        webGPUSupported = !!adapter;
        log(`WebGPU ${webGPUSupported ? 'available' : 'adapter request failed'}`);
        return webGPUSupported;
    } catch (error) {
        log(`WebGPU detection error: ${error.message}`);
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

                log(`Loading ${modelKey} with ${device} (${dtype})`);

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
        log(`Embedding status: ${status}`);
    }

    async getEmbedding(text) {
        if (!text || text.trim().length === 0) {
            return null;
        }

        try {
            const pipe = await this.#loadPipeline(this.#currentModelKey);
            const output = await pipe(text.trim(), { pooling: 'mean', normalize: true });
            return Array.from(output.data);
        } catch (error) {
            log(`Transformers embedding error: ${error?.message || error || 'unknown'}`);
            return null;
        }
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

    async getEmbedding(text) {
        const { url, model } = this.#getSettings();

        if (!url || !model) {
            return null;
        }

        if (!text || text.trim().length === 0) {
            return null;
        }

        try {
            const cleanUrl = url.replace(/\/+$/, '');
            const response = await getDeps().fetch(`${cleanUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: model,
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
}

// =============================================================================
// Strategy Registry
// =============================================================================

const strategies = {
    'multilingual-e5-small': new TransformersStrategy(),
    'bge-small-en-v1.5': new TransformersStrategy(),
    'embeddinggemma-300m': new TransformersStrategy(),
    'ollama': new OllamaStrategy(),
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
export function getStrategy(source) {
    return strategies[source] || strategies['multilingual-e5-small'];
}

/**
 * Get all available source keys
 * @returns {string[]} Array of source keys
 */
export function getAvailableSources() {
    return Object.keys(strategies);
}

/**
 * Set the status callback for all strategies
 * @param {Function} callback - Status callback
 */
export function setGlobalStatusCallback(callback) {
    Object.values(strategies).forEach(strategy => {
        if (strategy.setStatusCallback) {
            strategy.setStatusCallback(callback);
        }
    });
}

/**
 * Get the optimal chunk size for the currently configured embedding strategy
 * @returns {number} Optimal chunk size in characters
 */
export function getOptimalChunkSize() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings?.embeddingSource || 'multilingual-e5-small';

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

export { TransformersStrategy, OllamaStrategy };
export { TRANSFORMERS_MODELS };
