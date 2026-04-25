/**
 * Embedding Strategy Registry
 *
 * Central registry for all embedding strategies.
 * Provides strategy lookup and helper functions.
 */

import { EMBEDDING_SOURCES, extensionName } from '../constants.js';
import { getDeps } from '../deps.js';
import { OllamaStrategy } from './strategies/ollama.js';
import { StVectorStrategy } from './strategies/st-vector.js';
import { TRANSFORMERS_MODELS, TransformersStrategy } from './strategies/transformers.js';

// =============================================================================
// Strategy Registry
// =============================================================================

const strategies = {
    'multilingual-e5-small': new TransformersStrategy(),
    'bge-small-en-v1.5': new TransformersStrategy(),
    'embeddinggemma-300m': new TransformersStrategy(),
    [EMBEDDING_SOURCES.OLLAMA]: new OllamaStrategy(),
    [EMBEDDING_SOURCES.ST_VECTOR]: new StVectorStrategy(),
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
export function _getAvailableSources() {
    return Object.keys(strategies);
}

/**
 * Set the status callback for all strategies
 * @param {Function} callback - Status callback
 */
export function setGlobalStatusCallback(callback) {
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

/**
 * Set callback for embedding status updates
 * @param {Function} callback - Function(status: string) to call on status change
 */
export function setEmbeddingStatusCallback(callback) {
    setGlobalStatusCallback(callback);
}
