import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRANSFORMERS_MODELS } from '../../src/embeddings.js';

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

describe('generateEmbeddingsForMemories', () => {
    let _originalGetDeps;

    beforeEach(async () => {
        // Import and save original getDeps
        const depsModule = await import('../../src/deps.js');
        _originalGetDeps = depsModule.getDeps;

        // Mock getDeps to return enabled settings
        const mockDeps = {
            getExtensionSettings: vi.fn(() => ({
                openvault: {
                    embeddingSource: 'multilingual-e5-small',
                    embeddingQueryPrefix: 'query: ',
                    embeddingDocPrefix: 'passage: ',
                },
            })),
        };
        vi.spyOn(depsModule, 'getDeps').mockReturnValue(mockDeps);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('generateEmbeddingsForMemories stores embedding as Base64 via setEmbedding', async () => {
        const { hasEmbedding, getEmbedding } = await import('../../src/utils/embedding-codec.js');
        const { generateEmbeddingsForMemories, getStrategy } = await import('../../src/embeddings.js');

        const memories = [{ summary: 'Test memory', id: 'test1' }];

        // Spy on the strategy's getDocumentEmbedding method
        const strategy = getStrategy('multilingual-e5-small');
        const getDocEmbSpy = vi.spyOn(strategy, 'getDocumentEmbedding').mockResolvedValue([0.1, 0.2, 0.3]);

        const count = await generateEmbeddingsForMemories(memories);

        expect(getDocEmbSpy).toHaveBeenCalledWith(
            'Test memory',
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
        expect(count).toBe(1);
        expect(hasEmbedding(memories[0])).toBe(true);
        expect(memories[0].embedding).toBeUndefined(); // no legacy key
        expect(memories[0].embedding_b64).toBeTypeOf('string');
        const decoded = getEmbedding(memories[0]);
        expect(decoded[0]).toBeCloseTo(0.1, 5);
    });
});

describe('getQueryEmbedding abort signal', () => {
    beforeEach(async () => {
        const depsModule = await import('../../src/deps.js');
        vi.spyOn(depsModule, 'getDeps').mockReturnValue({
            getExtensionSettings: vi.fn(() => ({
                openvault: {
                    embeddingSource: 'ollama',
                    ollamaUrl: 'http://test:11434',
                    embeddingModel: 'test-model',
                },
            })),
            fetch: vi.fn(async () => ({
                ok: true,
                json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
            })),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('throws AbortError with pre-aborted signal', async () => {
        const { getQueryEmbedding, clearEmbeddingCache } = await import('../../src/embeddings.js');
        clearEmbeddingCache();
        const ctrl = new AbortController();
        ctrl.abort();

        await expect(getQueryEmbedding('test', { signal: ctrl.signal })).rejects.toThrow(
            expect.objectContaining({ name: 'AbortError' })
        );
    });

    it('throws AbortError with pre-aborted signal on getDocumentEmbedding', async () => {
        const { getDocumentEmbedding, clearEmbeddingCache } = await import('../../src/embeddings.js');
        clearEmbeddingCache();
        const ctrl = new AbortController();
        ctrl.abort();

        await expect(getDocumentEmbedding('test', { signal: ctrl.signal })).rejects.toThrow(
            expect.objectContaining({ name: 'AbortError' })
        );
    });
});

describe('OllamaStrategy abort signal', () => {
    it('passes signal to fetch', async () => {
        const fetchSpy = vi.fn(async () => ({
            ok: true,
            json: async () => ({ embedding: [0.1, 0.2] }),
        }));

        const depsModule = await import('../../src/deps.js');
        vi.spyOn(depsModule, 'getDeps').mockReturnValue({
            getExtensionSettings: vi.fn(() => ({
                openvault: {
                    embeddingSource: 'ollama',
                    ollamaUrl: 'http://test:11434',
                    embeddingModel: 'test-model',
                },
            })),
            fetch: fetchSpy,
        });

        const { getStrategy } = await import('../../src/embeddings.js');
        const strategy = getStrategy('ollama');
        const ctrl = new AbortController();
        await strategy.getEmbedding('test text', {
            signal: ctrl.signal,
            url: 'http://test:11434',
            model: 'test-model',
        });

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const fetchOptions = fetchSpy.mock.calls[0][1];
        expect(fetchOptions.signal).toBe(ctrl.signal);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });
});

describe('enrichEventsWithEmbeddings abort signal', () => {
    beforeEach(async () => {
        const depsModule = await import('../../src/deps.js');
        vi.spyOn(depsModule, 'getDeps').mockReturnValue({
            getExtensionSettings: vi.fn(() => ({
                openvault: {
                    embeddingSource: 'ollama',
                    ollamaUrl: 'http://test:11434',
                    embeddingModel: 'test-model',
                },
            })),
            fetch: vi.fn(async () => ({
                ok: true,
                json: async () => ({ embedding: [0.1, 0.2] }),
            })),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('throws AbortError when signal is pre-aborted', async () => {
        const { enrichEventsWithEmbeddings } = await import('../../src/embeddings.js');
        const ctrl = new AbortController();
        ctrl.abort();

        await expect(enrichEventsWithEmbeddings([{ summary: 'test' }], { signal: ctrl.signal })).rejects.toThrow(
            expect.objectContaining({ name: 'AbortError' })
        );
    });
});

describe('OllamaStrategy with injected params', () => {
    it('uses injected url and model instead of getDeps', async () => {
        const fetchSpy = vi.fn(async () => ({
            ok: true,
            json: async () => ({ embedding: [0.1, 0.2] }),
        }));

        const depsModule = await import('../../src/deps.js');
        vi.spyOn(depsModule, 'getDeps').mockReturnValue({ fetch: fetchSpy });

        const { getStrategy } = await import('../../src/embeddings.js');
        const strategy = getStrategy('ollama');
        const result = await strategy.getEmbedding('test text', {
            url: 'http://injected:11434',
            model: 'injected-model',
        });

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const fetchUrl = fetchSpy.mock.calls[0][0];
        expect(fetchUrl).toBe('http://injected:11434/api/embeddings');
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.model).toBe('injected-model');
        expect(result).toBeInstanceOf(Float32Array);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });
});

describe('testOllamaConnection', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns true on successful connection', async () => {
        global.fetch = vi.fn(() => Promise.resolve({ ok: true }));
        const { testOllamaConnection } = await import('../../src/embeddings.js');

        const result = await testOllamaConnection('http://localhost:11434');

        expect(result).toBe(true);
        expect(fetch).toHaveBeenCalledWith(
            'http://localhost:11434/api/tags',
            expect.objectContaining({ method: 'GET' })
        );
    });

    it('throws on HTTP error response', async () => {
        global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));
        const { testOllamaConnection } = await import('../../src/embeddings.js');

        await expect(testOllamaConnection('http://localhost:11434')).rejects.toThrow('HTTP 500');
    });

    it('throws on network error', async () => {
        global.fetch = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));
        const { testOllamaConnection } = await import('../../src/embeddings.js');

        await expect(testOllamaConnection('http://localhost:11434')).rejects.toThrow('ECONNREFUSED');
    });
});
