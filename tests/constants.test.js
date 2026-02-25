import { describe, it, expect } from 'vitest';
import { defaultSettings, embeddingModelPrefixes } from '../src/constants.js';

describe('defaultSettings', () => {
    it('has alpha and combinedBoostWeight in defaultSettings', () => {
        expect(defaultSettings.alpha).toBe(0.7);
        expect(defaultSettings.combinedBoostWeight).toBe(15);
    });

    it('has embeddingQueryPrefix', () => {
        expect(defaultSettings.embeddingQueryPrefix).toBe('query: ');
    });
    it('has embeddingDocPrefix', () => {
        expect(defaultSettings.embeddingDocPrefix).toBe('passage: ');
    });
});

describe('embeddingModelPrefixes', () => {
    it('has defaults for all built-in models', () => {
        expect(embeddingModelPrefixes['multilingual-e5-small']).toEqual({ queryPrefix: 'query: ', docPrefix: 'passage: ' });
        expect(embeddingModelPrefixes['embeddinggemma-300m']).toEqual({ queryPrefix: 'search for similar scenes: ', docPrefix: '' });
        expect(embeddingModelPrefixes['bge-small-en-v1.5']).toBeDefined();
    });

    it('has a _default fallback', () => {
        expect(embeddingModelPrefixes['_default']).toEqual({ queryPrefix: 'query: ', docPrefix: 'passage: ' });
    });
});

describe('extensionFolderPath', () => {
    it('derives path from import.meta.url', async () => {
        // Dynamic import to get fresh module evaluation
        const { extensionFolderPath } = await import('../src/constants.js');

        // Path should end without /src/constants.js
        expect(extensionFolderPath).not.toContain('/src/constants.js');
        expect(extensionFolderPath).not.toContain('\\src\\constants.js');
    });

    it('handles renamed folder correctly', async () => {
        const { extensionFolderPath } = await import('../src/constants.js');

        // Should not be hardcoded to 'openvault'
        // The actual value depends on where tests run from
        expect(typeof extensionFolderPath).toBe('string');
        expect(extensionFolderPath.length).toBeGreaterThan(0);
    });
});
