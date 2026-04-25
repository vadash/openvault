/**
 * SillyTavern Vector Storage Strategy
 *
 * Delegates embedding generation and storage to SillyTavern's built-in
 * vector storage API. No local embeddings are generated.
 */

import { EMBEDDING_SOURCES } from '../../constants.js';
import { EmbeddingStrategy } from '../base-strategy.js';

/**
 * ST Vector Storage strategy implementation.
 * Delegates all embedding operations to SillyTavern's vector storage API.
 */
export class StVectorStrategy extends EmbeddingStrategy {
    getId() {
        return EMBEDDING_SOURCES.ST_VECTOR;
    }

    isEnabled() {
        // ST Vector Storage is always considered available if selected
        return true;
    }

    getStatus() {
        return 'ST Vector Storage';
    }

    // No local embeddings — ST handles embedding generation
    async getQueryEmbedding(_text, _options = {}) {
        return null;
    }

    async getDocumentEmbedding(_text, _options = {}) {
        return null;
    }

    usesExternalStorage() {
        return true;
    }

    async insertItems(items, _options = {}) {
        const { syncItemsToST } = await import('../../services/st-vector.js');
        const { getCurrentChatId } = await import('../../store/chat-data.js');
        const chatId = getCurrentChatId() || 'default';
        return syncItemsToST(items, chatId);
    }

    async searchItems(query, topK, threshold, _options = {}) {
        const { querySTVector } = await import('../../services/st-vector.js');
        const { getCurrentChatId } = await import('../../store/chat-data.js');
        const chatId = getCurrentChatId() || 'default';
        return querySTVector(query, topK, threshold, chatId);
    }

    async deleteItems(hashes, _options = {}) {
        const { deleteItemsFromST } = await import('../../services/st-vector.js');
        const { getCurrentChatId } = await import('../../store/chat-data.js');
        const chatId = getCurrentChatId() || 'default';
        return deleteItemsFromST(hashes, chatId);
    }

    async purgeCollection(_options = {}) {
        const { purgeSTCollection } = await import('../../services/st-vector.js');
        const { getCurrentChatId } = await import('../../store/chat-data.js');
        const chatId = getCurrentChatId() || 'default';
        return purgeSTCollection(chatId);
    }
}
