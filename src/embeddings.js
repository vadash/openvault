/**
 * OpenVault Embeddings - Re-export Wrapper
 *
 * This file is kept for backward compatibility with existing imports.
 * All functionality has been decomposed into modular files under src/embeddings/.
 */

// Base strategy
export { EmbeddingStrategy } from './embeddings/base-strategy.js';
// Batch operations
export {
    backfillAllEmbeddings,
    enrichEventsWithEmbeddings,
    generateEmbeddingsForMemories,
    processInBatches,
} from './embeddings/batch.js';
// Cache
export { clearEmbeddingCache, getDocumentEmbedding, getQueryEmbedding } from './embeddings/cache.js';
// Registry and helpers
export {
    _getAvailableSources,
    getEmbeddingStatus,
    getOptimalChunkSize,
    getStrategy,
    isEmbeddingsEnabled,
    setEmbeddingStatusCallback,
    setGlobalStatusCallback,
} from './embeddings/registry.js';
export { OllamaStrategy, testOllamaConnection } from './embeddings/strategies/ollama.js';
export { StVectorStrategy } from './embeddings/strategies/st-vector.js';
// Strategy classes and configs
export { isWebGPUAvailable, TRANSFORMERS_MODELS, TransformersStrategy } from './embeddings/strategies/transformers.js';
