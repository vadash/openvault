import { describe, expect, it } from 'vitest';
import { TRANSFORMERS_MODELS } from '../src/embeddings.js';

describe('TRANSFORMERS_MODELS config', () => {
    it('multilingual-e5-small has Cyrillic-safe chunk size', () => {
        const config = TRANSFORMERS_MODELS['multilingual-e5-small'];
        // 250 chars × ~1.5 tokens/Cyrillic char ≈ 375 tokens (within 512 limit)
        expect(config.optimalChunkSize).toBeLessThanOrEqual(250);
    });

    it('embeddinggemma-300m retains large chunk size', () => {
        const config = TRANSFORMERS_MODELS['embeddinggemma-300m'];
        expect(config.optimalChunkSize).toBe(1800);
    });
});
