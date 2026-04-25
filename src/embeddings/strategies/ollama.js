/**
 * Ollama Embedding Strategy
 *
 * Remote embeddings via Ollama HTTP API.
 * Supports any embedding model hosted by Ollama.
 */

import { EMBEDDING_SOURCES, extensionName } from '../../constants.js';
import { getDeps } from '../../deps.js';
import { logDebug, logError } from '../../utils/logging.js';
import { EmbeddingStrategy } from '../base-strategy.js';

/**
 * Ollama embedding strategy implementation.
 */
export class OllamaStrategy extends EmbeddingStrategy {
    getId() {
        return EMBEDDING_SOURCES.OLLAMA;
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

    async getEmbedding(text, { signal, url, model } = {}) {
        // url/model injected by wrapper for testing

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

    async getQueryEmbedding(text, options = {}) {
        return this.getEmbedding(text, options);
    }

    async getDocumentEmbedding(text, options = {}) {
        return this.getEmbedding(text, options);
    }
}

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
