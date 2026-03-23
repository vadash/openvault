import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extensionName, MEMORIES_KEY, METADATA_KEY } from '../../src/constants.js';
import { resetDeps, setDeps } from '../../src/deps.js';
import {
    deleteCurrentChatEmbeddings,
    getStVectorFingerprint,
    invalidateStaleEmbeddings,
    stampStVectorFingerprint,
} from '../../src/embeddings/migration.js';

describe('migration', () => {
    let mockConsole;
    let mockContext;

    beforeEach(() => {
        mockConsole = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        mockContext = { chatMetadata: {}, chatId: 'test-chat-123' };
        setDeps({
            console: mockConsole,
            getContext: () => mockContext,
            getExtensionSettings: () => ({
                [extensionName]: {
                    enabled: true,
                    debugMode: true,
                    requestLogging: false,
                },
            }),
            Date: { now: () => 1000000 },
        });
    });

    afterEach(() => resetDeps());

    describe('invalidateStaleEmbeddings', () => {
        it('stamps model ID on empty chat and returns 0', async () => {
            const data = { memories: [], graph: { nodes: {}, edges: {} }, communities: {} };
            const result = await invalidateStaleEmbeddings(data, 'multilingual-e5-small');
            expect(result).toBe(0);
            expect(data.embedding_model_id).toBe('multilingual-e5-small');
        });

        it('returns 0 when model matches', async () => {
            const data = {
                embedding_model_id: 'multilingual-e5-small',
                memories: [{ id: '1', embedding_b64: 'abc' }],
                graph: { nodes: {}, edges: {} },
                communities: {},
            };
            const result = await invalidateStaleEmbeddings(data, 'multilingual-e5-small');
            expect(result).toBe(0);
            expect(data.memories[0].embedding_b64).toBe('abc');
        });

        it('wipes all embeddings on model mismatch', async () => {
            const data = {
                embedding_model_id: 'multilingual-e5-small',
                memories: [
                    { id: '1', embedding_b64: 'abc' },
                    { id: '2', embedding_b64: 'def' },
                    { id: '3' }, // no embedding
                ],
                graph: {
                    nodes: {
                        alice: { name: 'Alice', embedding_b64: 'ghi' },
                        bob: { name: 'Bob' },
                    },
                    edges: {},
                },
                communities: {
                    C0: { title: 'Group', embedding_b64: 'jkl' },
                    C1: { title: 'Other' },
                },
            };
            const result = await invalidateStaleEmbeddings(data, 'bge-small-en-v1.5');
            expect(result).toBe(4); // 2 memories + 1 node + 1 community
            expect(data.embedding_model_id).toBe('bge-small-en-v1.5');
            expect(data.memories[0].embedding_b64).toBeUndefined();
            expect(data.memories[1].embedding_b64).toBeUndefined();
            expect(data.graph.nodes.alice.embedding_b64).toBeUndefined();
            expect(data.communities.C0.embedding_b64).toBeUndefined();
        });

        it('treats legacy chat (no tag but has embeddings) as mismatch', async () => {
            const data = {
                memories: [{ id: '1', embedding_b64: 'abc' }],
                graph: { nodes: {}, edges: {} },
                communities: {},
            };
            // No embedding_model_id set
            const result = await invalidateStaleEmbeddings(data, 'bge-small-en-v1.5');
            expect(result).toBe(1);
            expect(data.embedding_model_id).toBe('bge-small-en-v1.5');
            expect(data.memories[0].embedding_b64).toBeUndefined();
        });

        it('handles missing graph and communities gracefully', async () => {
            const data = {
                embedding_model_id: 'old-model',
                memories: [{ id: '1', embedding_b64: 'abc' }],
            };
            const result = await invalidateStaleEmbeddings(data, 'new-model');
            expect(result).toBe(1);
            expect(data.embedding_model_id).toBe('new-model');
        });

        it('also wipes legacy embedding arrays (not just embedding_b64)', async () => {
            const data = {
                embedding_model_id: 'old-model',
                memories: [{ id: '1', embedding: [1, 2, 3] }],
                graph: { nodes: {}, edges: {} },
                communities: {},
            };
            const result = await invalidateStaleEmbeddings(data, 'new-model');
            expect(result).toBe(1);
            expect(data.memories[0].embedding).toBeUndefined();
            expect(data.memories[0].embedding_b64).toBeUndefined();
        });
    });

    describe('invalidateStaleEmbeddings — ST Vector fingerprint', () => {
        /** Helper: set deps with ST vector settings */
        function setStVectorDeps(stSource, stModel) {
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: {
                        enabled: true,
                        debugMode: true,
                        requestLogging: false,
                        embeddingSource: 'st_vector',
                    },
                    vectors: {
                        source: stSource,
                        [`${stSource}_model`]: stModel,
                    },
                }),
                Date: { now: () => 1000000 },
                fetch: vi.fn().mockResolvedValue({ ok: true }),
            });
        }

        it('stamps ST fingerprint on empty chat', async () => {
            setStVectorDeps('openrouter', 'text-embedding-3-large');
            const data = { memories: [], graph: { nodes: {}, edges: {} }, communities: {} };
            const result = await invalidateStaleEmbeddings(data, 'st_vector');
            expect(result).toBe(0);
            expect(data.embedding_model_id).toBe('st_vector');
            expect(data.st_vector_source).toBe('openrouter');
            expect(data.st_vector_model).toBe('text-embedding-3-large');
        });

        it('returns 0 when ST source and model match', async () => {
            setStVectorDeps('openrouter', 'text-embedding-3-large');
            const data = {
                embedding_model_id: 'st_vector',
                st_vector_source: 'openrouter',
                st_vector_model: 'text-embedding-3-large',
                memories: [{ id: '1', _st_synced: true, summary: 'test' }],
                graph: { nodes: {}, edges: {} },
                communities: {},
            };
            const result = await invalidateStaleEmbeddings(data, 'st_vector');
            expect(result).toBe(0);
            expect(data.memories[0]._st_synced).toBe(true);
        });

        it('clears sync flags when ST source changes', async () => {
            setStVectorDeps('ollama', 'nomic-embed-text');
            const data = {
                embedding_model_id: 'st_vector',
                st_vector_source: 'openrouter',
                st_vector_model: 'text-embedding-3-large',
                memories: [
                    { id: '1', _st_synced: true, summary: 'mem1' },
                    { id: '2', _st_synced: true, summary: 'mem2' },
                    { id: '3', summary: 'not synced' },
                ],
                graph: {
                    nodes: { alice: { name: 'Alice', _st_synced: true } },
                    edges: {},
                },
                communities: {
                    C0: { title: 'Group', summary: 'comm', _st_synced: true },
                },
            };
            const result = await invalidateStaleEmbeddings(data, 'st_vector');
            expect(result).toBe(4); // 2 memories + 1 node + 1 community
            // Sync flags cleared
            expect(data.memories[0]._st_synced).toBeUndefined();
            expect(data.memories[1]._st_synced).toBeUndefined();
            expect(data.graph.nodes.alice._st_synced).toBeUndefined();
            expect(data.communities.C0._st_synced).toBeUndefined();
            // Fingerprint updated
            expect(data.st_vector_source).toBe('ollama');
            expect(data.st_vector_model).toBe('nomic-embed-text');
            // Model ID unchanged
            expect(data.embedding_model_id).toBe('st_vector');
        });

        it('clears sync flags when ST model changes (same source)', async () => {
            setStVectorDeps('openrouter', 'nomic-embed-text-v1.5');
            const data = {
                embedding_model_id: 'st_vector',
                st_vector_source: 'openrouter',
                st_vector_model: 'text-embedding-3-large',
                memories: [{ id: '1', _st_synced: true, summary: 'test' }],
                graph: { nodes: {}, edges: {} },
                communities: {},
            };
            const result = await invalidateStaleEmbeddings(data, 'st_vector');
            expect(result).toBe(1);
            expect(data.memories[0]._st_synced).toBeUndefined();
            expect(data.st_vector_source).toBe('openrouter');
            expect(data.st_vector_model).toBe('nomic-embed-text-v1.5');
        });

        it('treats legacy ST data (no fingerprint, has synced items) as mismatch', async () => {
            setStVectorDeps('openrouter', 'text-embedding-3-large');
            const data = {
                embedding_model_id: 'st_vector',
                // No st_vector_source / st_vector_model
                memories: [{ id: '1', _st_synced: true, summary: 'legacy' }],
                graph: { nodes: {}, edges: {} },
                communities: {},
            };
            const result = await invalidateStaleEmbeddings(data, 'st_vector');
            expect(result).toBe(1);
            expect(data.memories[0]._st_synced).toBeUndefined();
            expect(data.st_vector_source).toBe('openrouter');
            expect(data.st_vector_model).toBe('text-embedding-3-large');
        });

        it('does not treat missing fingerprint as mismatch when no items synced', async () => {
            setStVectorDeps('openrouter', 'text-embedding-3-large');
            const data = {
                embedding_model_id: 'st_vector',
                // No fingerprint, no synced items
                memories: [{ id: '1', summary: 'not synced yet' }],
                graph: { nodes: {}, edges: {} },
                communities: {},
            };
            const result = await invalidateStaleEmbeddings(data, 'st_vector');
            expect(result).toBe(0);
        });

        it('clears ST fingerprint when switching from st_vector to local model', async () => {
            const data = {
                embedding_model_id: 'st_vector',
                st_vector_source: 'openrouter',
                st_vector_model: 'text-embedding-3-large',
                memories: [{ id: '1', _st_synced: true, summary: 'test' }],
                graph: { nodes: {}, edges: {} },
                communities: {},
            };
            const result = await invalidateStaleEmbeddings(data, 'multilingual-e5-small');
            expect(result).toBe(1); // 1 synced item cleared
            expect(data.embedding_model_id).toBe('multilingual-e5-small');
            expect(data.st_vector_source).toBeUndefined();
            expect(data.st_vector_model).toBeUndefined();
            expect(data.memories[0]._st_synced).toBeUndefined();
        });

        it('stamps ST fingerprint when switching from local to st_vector', async () => {
            setStVectorDeps('openrouter', 'text-embedding-3-large');
            const data = {
                embedding_model_id: 'multilingual-e5-small',
                memories: [{ id: '1', embedding_b64: 'abc' }],
                graph: { nodes: {}, edges: {} },
                communities: {},
            };
            const result = await invalidateStaleEmbeddings(data, 'st_vector');
            expect(result).toBe(1); // 1 local embedding wiped
            expect(data.embedding_model_id).toBe('st_vector');
            expect(data.st_vector_source).toBe('openrouter');
            expect(data.st_vector_model).toBe('text-embedding-3-large');
            expect(data.memories[0].embedding_b64).toBeUndefined();
        });
    });

    describe('getStVectorFingerprint', () => {
        it('returns current ST vector source and model', () => {
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { embeddingSource: 'st_vector' },
                    vectors: {
                        source: 'openrouter',
                        openrouter_model: 'text-embedding-3-large',
                    },
                }),
                Date: { now: () => 1000000 },
            });
            const fp = getStVectorFingerprint();
            expect(fp.source).toBe('openrouter');
            expect(fp.model).toBe('text-embedding-3-large');
        });

        it('returns empty model for transformers source', () => {
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { embeddingSource: 'st_vector' },
                    vectors: { source: 'transformers' },
                }),
                Date: { now: () => 1000000 },
            });
            const fp = getStVectorFingerprint();
            expect(fp.source).toBe('transformers');
            expect(fp.model).toBe('');
        });
    });

    describe('stampStVectorFingerprint', () => {
        it('stamps source and model onto data', () => {
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { embeddingSource: 'st_vector' },
                    vectors: {
                        source: 'ollama',
                        ollama_model: 'nomic-embed-text',
                    },
                }),
                Date: { now: () => 1000000 },
            });
            const data = { memories: [] };
            stampStVectorFingerprint(data);
            expect(data.st_vector_source).toBe('ollama');
            expect(data.st_vector_model).toBe('nomic-embed-text');
        });

        it('is a no-op for null data', () => {
            stampStVectorFingerprint(null);
            // Should not throw
        });
    });

    describe('deleteCurrentChatEmbeddings', () => {
        it('deletes embeddings from all memories', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [{ id: '1', embedding: [1, 2] }, { id: '2', embedding: [3, 4] }, { id: '3' }],
            };
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: true },
                }),
                saveChatConditional: vi.fn().mockResolvedValue(undefined),
            });
            const count = await deleteCurrentChatEmbeddings();
            expect(count).toBe(2);
            expect(mockContext.chatMetadata[METADATA_KEY][MEMORIES_KEY][0].embedding).toBeUndefined();
        });
    });
});
