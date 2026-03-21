import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('ST sync flag helpers', () => {
    it('markStSynced sets flag, isStSynced reads it', async () => {
        const { markStSynced, isStSynced } = await import('../src/utils/embedding-codec.js');
        const obj = {};
        expect(isStSynced(obj)).toBe(false);
        markStSynced(obj);
        expect(isStSynced(obj)).toBe(true);
    });

    it('clearStSynced removes flag', async () => {
        const { markStSynced, isStSynced, clearStSynced } = await import('../src/utils/embedding-codec.js');
        const obj = {};
        markStSynced(obj);
        clearStSynced(obj);
        expect(isStSynced(obj)).toBe(false);
    });

    it('deleteEmbedding also clears _st_synced', async () => {
        const { markStSynced, isStSynced, deleteEmbedding, setEmbedding } = await import('../src/utils/embedding-codec.js');
        const obj = {};
        setEmbedding(obj, new Float32Array([1, 2, 3]));
        markStSynced(obj);
        deleteEmbedding(obj);
        expect(isStSynced(obj)).toBe(false);
    });

    it('isStSynced returns false for null/undefined', async () => {
        const { isStSynced } = await import('../src/utils/embedding-codec.js');
        expect(isStSynced(null)).toBe(false);
        expect(isStSynced(undefined)).toBe(false);
    });
});

describe('cyrb53 hash', () => {
    it('returns a positive integer for any string', async () => {
        const { cyrb53 } = await import('../src/utils/embedding-codec.js');
        const hash = cyrb53('hello world');
        expect(typeof hash).toBe('number');
        expect(Number.isInteger(hash)).toBe(true);
        expect(hash).toBeGreaterThan(0);
    });

    it('returns deterministic results', async () => {
        const { cyrb53 } = await import('../src/utils/embedding-codec.js');
        expect(cyrb53('test input')).toBe(cyrb53('test input'));
    });

    it('returns different hashes for different inputs', async () => {
        const { cyrb53 } = await import('../src/utils/embedding-codec.js');
        expect(cyrb53('alice')).not.toBe(cyrb53('bob'));
    });

    it('handles empty string', async () => {
        const { cyrb53 } = await import('../src/utils/embedding-codec.js');
        const hash = cyrb53('');
        expect(typeof hash).toBe('number');
    });

    it('handles unicode/cyrillic text', async () => {
        const { cyrb53 } = await import('../src/utils/embedding-codec.js');
        const hash = cyrb53('Привет мир');
        expect(typeof hash).toBe('number');
        expect(Number.isInteger(hash)).toBe(true);
    });
});

describe('rankToProxyScore', () => {
    it('returns 1.0 for rank 0 (best match)', async () => {
        const { rankToProxyScore } = await import('../src/retrieval/math.js');
        expect(rankToProxyScore(0, 10)).toBe(1.0);
    });

    it('returns 0.5 for last rank', async () => {
        const { rankToProxyScore } = await import('../src/retrieval/math.js');
        expect(rankToProxyScore(9, 10)).toBe(0.5);
    });

    it('returns 1.0 when totalResults is 1', async () => {
        const { rankToProxyScore } = await import('../src/retrieval/math.js');
        expect(rankToProxyScore(0, 1)).toBe(1.0);
    });

    it('returns 1.0 when totalResults is 0', async () => {
        const { rankToProxyScore } = await import('../src/retrieval/math.js');
        expect(rankToProxyScore(0, 0)).toBe(1.0);
    });

    it('returns linearly interpolated values', async () => {
        const { rankToProxyScore } = await import('../src/retrieval/math.js');
        // Rank 4 of 9 total (0-indexed): 1.0 - (4/8) * 0.5 = 0.75
        expect(rankToProxyScore(4, 9)).toBe(0.75);
    });
});

describe('ST storage helpers', () => {
    let mockFetch;
    let depsModule;

    beforeEach(async () => {
        depsModule = await import('../src/deps.js');
        mockFetch = vi.fn().mockResolvedValue({ ok: true });
        vi.spyOn(depsModule, 'getDeps').mockReturnValue({
            fetch: mockFetch,
            getContext: () => ({ chatId: 'chat_123' }),
            getExtensionSettings: () => ({
                openvault: { embeddingSource: 'st_vector' },
            }),
            console: {
                log: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            },
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('syncItemsToST sends POST to /api/vector/insert with correct payload', async () => {
        const { syncItemsToST } = await import('../src/utils/data.js');
        const items = [
            { hash: 12345, text: '[OV_ID:event_1] Memory text' },
        ];
        await syncItemsToST(items, 'chat_123');

        expect(mockFetch).toHaveBeenCalledWith(
            '/api/vector/insert',
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('"collectionId"'),
            })
        );
    });

    it('deleteItemsFromST sends POST to /api/vector/delete', async () => {
        const { deleteItemsFromST } = await import('../src/utils/data.js');
        await deleteItemsFromST([12345, 67890], 'chat_123');

        expect(mockFetch).toHaveBeenCalledWith(
            '/api/vector/delete',
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('"hashes"'),
            })
        );
    });

    it('purgeSTCollection sends POST to /api/vector/purge', async () => {
        const { purgeSTCollection } = await import('../src/utils/data.js');
        await purgeSTCollection('chat_123');

        expect(mockFetch).toHaveBeenCalledWith(
            '/api/vector/purge',
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('"collectionId"'),
            })
        );
    });

    it('querySTVector sends POST to /api/vector/query and returns results', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                hashes: [111, 222],
                metadata: [
                    { hash: 111, text: '[OV_ID:event_1] Text 1', index: 0 },
                    { hash: 222, text: '[OV_ID:event_2] Text 2', index: 1 },
                ],
            }),
        });

        const { querySTVector } = await import('../src/utils/data.js');
        const results = await querySTVector('search query', 10, 0.5, 'chat_123');

        expect(results).toHaveLength(2);
        expect(results[0].id).toBe('event_1');
        expect(results[1].id).toBe('event_2');
    });

    it('querySTVector extracts ID from OV_ID prefix', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                hashes: [111],
                metadata: [
                    { hash: 111, text: '[OV_ID:ref_42] Reflection text', index: 0 },
                ],
            }),
        });

        const { querySTVector } = await import('../src/utils/data.js');
        const results = await querySTVector('test', 5, 0.5, 'chat_123');
        expect(results[0].id).toBe('ref_42');
    });

    it('querySTVector returns empty array on fetch failure', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 404 });

        const { querySTVector } = await import('../src/utils/data.js');
        const results = await querySTVector('test', 5, 0.5, 'chat_123');
        expect(results).toEqual([]);
    });
});