/**
 * Tests for src/embeddings.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import {
    cosineSimilarity,
    isEmbeddingsEnabled,
    getEmbedding,
    generateEmbeddingsForMemories,
    clearEmbeddingCache,
} from '../src/embeddings.js';
import { extensionName } from '../src/constants.js';

describe('embeddings', () => {
    let mockConsole;

    beforeEach(() => {
        mockConsole = {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        setDeps({
            console: mockConsole,
            getExtensionSettings: () => ({
                [extensionName]: {
                    embeddingSource: 'ollama',
                    ollamaUrl: 'http://localhost:11434',
                    embeddingModel: 'nomic-embed-text',
                    debugMode: false,
                }
            }),
        });
    });

    afterEach(() => {
        resetDeps();
        clearEmbeddingCache();
    });

    describe('cosineSimilarity', () => {
        it('returns 1 for identical vectors', () => {
            const vec = [1, 2, 3, 4, 5];
            expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 5);
        });

        it('returns -1 for opposite vectors', () => {
            const vecA = [1, 0, 0];
            const vecB = [-1, 0, 0];
            expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(-1, 5);
        });

        it('returns 0 for orthogonal vectors', () => {
            const vecA = [1, 0, 0];
            const vecB = [0, 1, 0];
            expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0, 5);
        });

        it('returns 0 for null vectors', () => {
            expect(cosineSimilarity(null, [1, 2, 3])).toBe(0);
            expect(cosineSimilarity([1, 2, 3], null)).toBe(0);
            expect(cosineSimilarity(null, null)).toBe(0);
        });

        it('returns 0 for vectors of different lengths', () => {
            expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
        });

        it('returns 0 for empty vectors', () => {
            expect(cosineSimilarity([], [])).toBe(0);
        });

        it('returns 0 for zero vectors', () => {
            expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
        });

        it('calculates correct similarity for arbitrary vectors', () => {
            const vecA = [1, 2, 3];
            const vecB = [4, 5, 6];
            // dot = 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
            // |A| = sqrt(1 + 4 + 9) = sqrt(14)
            // |B| = sqrt(16 + 25 + 36) = sqrt(77)
            // cos = 32 / (sqrt(14) * sqrt(77)) = 32 / sqrt(1078)
            const expected = 32 / Math.sqrt(14 * 77);
            expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(expected, 5);
        });

        it('is commutative', () => {
            const vecA = [1, 3, -5, 7];
            const vecB = [2, -4, 6, 8];
            expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(cosineSimilarity(vecB, vecA), 10);
        });
    });

    describe('isEmbeddingsEnabled', () => {
        it('returns true when both ollamaUrl and embeddingModel are set', () => {
            expect(isEmbeddingsEnabled()).toBe(true);
        });

        it('returns false when ollamaUrl is missing', () => {
            setDeps({
                getExtensionSettings: () => ({
                    [extensionName]: { embeddingSource: 'ollama', embeddingModel: 'model' }
                }),
            });
            expect(isEmbeddingsEnabled()).toBe(false);
        });

        it('returns false when embeddingModel is missing', () => {
            setDeps({
                getExtensionSettings: () => ({
                    [extensionName]: { embeddingSource: 'ollama', ollamaUrl: 'http://localhost' }
                }),
            });
            expect(isEmbeddingsEnabled()).toBe(false);
        });

        it('returns true for Transformers.js models by default', () => {
            setDeps({
                getExtensionSettings: () => ({}),
            });
            expect(isEmbeddingsEnabled()).toBe(true);
        });

        it('returns false for empty ollama strings', () => {
            setDeps({
                getExtensionSettings: () => ({
                    [extensionName]: { embeddingSource: 'ollama', ollamaUrl: '', embeddingModel: '' }
                }),
            });
            expect(isEmbeddingsEnabled()).toBe(false);
        });
    });

    describe('getEmbedding', () => {
        it('returns null when ollama not configured', async () => {
            setDeps({
                getExtensionSettings: () => ({ [extensionName]: { embeddingSource: 'ollama' } }),
            });
            const result = await getEmbedding('test text');
            expect(result).toBeNull();
        });

        it('returns null for empty text', async () => {
            const result = await getEmbedding('');
            expect(result).toBeNull();
        });

        it('returns null for whitespace-only text', async () => {
            const result = await getEmbedding('   \n\t  ');
            expect(result).toBeNull();
        });

        it('calls Ollama API with correct parameters', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ embedding: [0.1, 0.2, 0.3] }),
            });
            setDeps({
                console: mockConsole,
                getExtensionSettings: () => ({
                    [extensionName]: {
                        embeddingSource: 'ollama',
                        ollamaUrl: 'http://localhost:11434',
                        embeddingModel: 'nomic-embed-text',
                        debugMode: false,
                    }
                }),
                fetch: mockFetch,
            });

            const result = await getEmbedding('test text');

            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:11434/api/embeddings',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'nomic-embed-text',
                        prompt: 'test text',
                    }),
                }
            );
            expect(result).toEqual([0.1, 0.2, 0.3]);
        });

        it('strips trailing slashes from URL', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ embedding: [0.1] }),
            });
            setDeps({
                console: mockConsole,
                getExtensionSettings: () => ({
                    [extensionName]: {
                        embeddingSource: 'ollama',
                        ollamaUrl: 'http://localhost:11434///',
                        embeddingModel: 'model',
                        debugMode: false,
                    }
                }),
                fetch: mockFetch,
            });

            await getEmbedding('test');

            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:11434/api/embeddings',
                expect.any(Object)
            );
        });

        it('returns null on non-OK response', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
            });
            setDeps({
                console: mockConsole,
                getExtensionSettings: () => ({
                    [extensionName]: {
                        embeddingSource: 'ollama',
                        ollamaUrl: 'http://localhost:11434',
                        embeddingModel: 'model',
                        debugMode: false,
                    }
                }),
                fetch: mockFetch,
            });

            const result = await getEmbedding('test');
            expect(result).toBeNull();
        });

        it('returns null on fetch error', async () => {
            const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
            setDeps({
                console: mockConsole,
                getExtensionSettings: () => ({
                    [extensionName]: {
                        embeddingSource: 'ollama',
                        ollamaUrl: 'http://localhost:11434',
                        embeddingModel: 'model',
                        debugMode: false,
                    }
                }),
                fetch: mockFetch,
            });

            const result = await getEmbedding('test');
            expect(result).toBeNull();
        });

        it('trims whitespace from input text', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ embedding: [0.1] }),
            });
            setDeps({
                console: mockConsole,
                getExtensionSettings: () => ({
                    [extensionName]: {
                        embeddingSource: 'ollama',
                        ollamaUrl: 'http://localhost:11434',
                        embeddingModel: 'model',
                        debugMode: false,
                    }
                }),
                fetch: mockFetch,
            });

            await getEmbedding('  test text  ');

            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    body: JSON.stringify({ model: 'model', prompt: 'test text' }),
                })
            );
        });
    });

    describe('generateEmbeddingsForMemories', () => {
        it('returns 0 when ollama not enabled', async () => {
            setDeps({
                getExtensionSettings: () => ({ [extensionName]: { embeddingSource: 'ollama' } }),
            });

            const memories = [{ id: '1', summary: 'Test' }];
            const count = await generateEmbeddingsForMemories(memories);
            expect(count).toBe(0);
        });

        it('skips memories that already have embeddings', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ embedding: [0.1] }),
            });
            setDeps({
                console: mockConsole,
                getExtensionSettings: () => ({
                    [extensionName]: {
                        embeddingSource: 'ollama',
                        ollamaUrl: 'http://localhost:11434',
                        embeddingModel: 'model',
                        debugMode: false,
                    }
                }),
                fetch: mockFetch,
            });

            const memories = [
                { id: '1', summary: 'Test 1', embedding: [0.5, 0.5] },
                { id: '2', summary: 'Test 2' },
            ];
            const count = await generateEmbeddingsForMemories(memories);

            expect(count).toBe(1);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('skips memories without summary', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ embedding: [0.1] }),
            });
            setDeps({
                console: mockConsole,
                getExtensionSettings: () => ({
                    [extensionName]: {
                        embeddingSource: 'ollama',
                        ollamaUrl: 'http://localhost:11434',
                        embeddingModel: 'model',
                        debugMode: false,
                    }
                }),
                fetch: mockFetch,
            });

            const memories = [
                { id: '1' }, // no summary
                { id: '2', summary: 'Has summary' },
            ];
            const count = await generateEmbeddingsForMemories(memories);

            expect(count).toBe(1);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('adds embeddings to memories in place', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ embedding: [0.1, 0.2, 0.3] }),
            });
            setDeps({
                console: mockConsole,
                getExtensionSettings: () => ({
                    [extensionName]: {
                        embeddingSource: 'ollama',
                        ollamaUrl: 'http://localhost:11434',
                        embeddingModel: 'model',
                        debugMode: false,
                    }
                }),
                fetch: mockFetch,
            });

            const memories = [{ id: '1', summary: 'Test' }];
            await generateEmbeddingsForMemories(memories);

            expect(memories[0].embedding).toEqual([0.1, 0.2, 0.3]);
        });

        it('counts only successful embeddings', async () => {
            let callCount = 0;
            const mockFetch = vi.fn().mockImplementation(() => {
                callCount++;
                if (callCount === 2) {
                    return Promise.resolve({ ok: false, status: 500 });
                }
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ embedding: [0.1] }),
                });
            });
            setDeps({
                console: mockConsole,
                getExtensionSettings: () => ({
                    [extensionName]: {
                        embeddingSource: 'ollama',
                        ollamaUrl: 'http://localhost:11434',
                        embeddingModel: 'model',
                        debugMode: false,
                    }
                }),
                fetch: mockFetch,
            });

            const memories = [
                { id: '1', summary: 'Test 1' },
                { id: '2', summary: 'Test 2' }, // This will fail
                { id: '3', summary: 'Test 3' },
            ];
            const count = await generateEmbeddingsForMemories(memories);

            expect(count).toBe(2);
            expect(memories[0].embedding).toBeDefined();
            expect(memories[1].embedding).toBeUndefined();
            expect(memories[2].embedding).toBeDefined();
        });
    });
});
