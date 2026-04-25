/**
 * Transformers.js Embedding Strategy
 *
 * Local in-browser embeddings via HuggingFace Transformers.js.
 * Supports WebGPU acceleration and multiple model configurations.
 */

import { cdnImport } from '../../utils/cdn.js';
import { logDebug, logError } from '../../utils/logging.js';
import { EmbeddingStrategy } from '../base-strategy.js';

// =============================================================================
// Model Configurations
// =============================================================================

export const TRANSFORMERS_MODELS = {
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
// WebGPU Detection
// =============================================================================

let webGPUSupported = null;

export async function isWebGPUAvailable() {
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

// =============================================================================
// Transformers Strategy Class
// =============================================================================

export class TransformersStrategy extends EmbeddingStrategy {
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

    async getQueryEmbedding(text, { signal, prefix = '' } = {}) {
        return this.#embed(text, prefix, { signal });
    }

    async getDocumentEmbedding(text, { signal, prefix = '' } = {}) {
        return this.#embed(text, prefix, { signal });
    }

    async reset() {
        this.#cachedPipeline = null;
        this.#cachedModelId = null;
        this.#cachedDevice = null;
        this.#loadingPromise = null;
    }
}
