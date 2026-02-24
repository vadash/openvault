/**
 * Tests for embedding strategy asymmetric methods (getQueryEmbedding / getDocumentEmbedding)
 */
import { describe, it, expect } from 'vitest';
import { TransformersStrategy, OllamaStrategy } from '../../src/embeddings/strategies.js';

describe('TransformersStrategy', () => {
    const strategy = new TransformersStrategy();

    it('has getQueryEmbedding method', () => {
        expect(typeof strategy.getQueryEmbedding).toBe('function');
    });

    it('has getDocumentEmbedding method', () => {
        expect(typeof strategy.getDocumentEmbedding).toBe('function');
    });
});

describe('OllamaStrategy', () => {
    const ollamaStrategy = new OllamaStrategy();

    it('has getQueryEmbedding method', () => {
        expect(typeof ollamaStrategy.getQueryEmbedding).toBe('function');
    });

    it('has getDocumentEmbedding method', () => {
        expect(typeof ollamaStrategy.getDocumentEmbedding).toBe('function');
    });
});
