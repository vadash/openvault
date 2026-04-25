/**
 * Base class for embedding strategies.
 * Subclasses must implement all required methods.
 */

export class EmbeddingStrategy {
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
     * Insert items into external vector storage (storage-backed strategies only).
     * @param {Array<{hash: number, text: string}>} _items - Items to insert
     * @param {Object} _options - Options
     * @returns {Promise<boolean>} True if successful, false if not supported
     */
    async insertItems(_items, _options = {}) {
        return false;
    }

    /**
     * Search items in external vector storage (storage-backed strategies only).
     * @param {string} _query - Search text
     * @param {number} _topK - Number of results
     * @param {number} _threshold - Similarity threshold
     * @param {Object} _options - Options
     * @returns {Promise<Array<{id: string, hash: number, text: string}>|null>} Results or null if not supported
     */
    async searchItems(_query, _topK, _threshold, _options = {}) {
        return null;
    }

    /**
     * Delete items from external vector storage.
     * @param {number[]} _hashes - Hashes to delete
     * @param {Object} _options - Options
     * @returns {Promise<boolean>}
     */
    async deleteItems(_hashes, _options = {}) {
        return false;
    }

    /**
     * Purge entire collection from external storage.
     * @param {Object} _options - Options
     * @returns {Promise<boolean>}
     */
    async purgeCollection(_options = {}) {
        return false;
    }

    /**
     * Whether this strategy uses external vector storage (vs local embeddings).
     * @returns {boolean}
     */
    usesExternalStorage() {
        return false;
    }
}
