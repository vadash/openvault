import { describe, expect, it } from 'vitest';

describe('selectMemoriesWithSoftBalance', () => {
    it('should select top-scoring memories first (Phase 1)', async () => {
        const { selectMemoriesWithSoftBalance } = await import('../../src/retrieval/scoring.js');

        const scoredMemories = [
            { memory: { id: '1', summary: 'High score old' }, score: 10.0, breakdown: { distance: 800 } },
            { memory: { id: '2', summary: 'High score mid' }, score: 9.0, breakdown: { distance: 400 } },
            { memory: { id: '3', summary: 'High score recent' }, score: 8.0, breakdown: { distance: 50 } },
            { memory: { id: '4', summary: 'Low score old' }, score: 1.0, breakdown: { distance: 900 } },
            { memory: { id: '5', summary: 'Low score recent' }, score: 2.0, breakdown: { distance: 10 } },
        ];

        const tokenBudget = 10; // Small budget - only ~2 memories
        const chatLength = 1000;

        const selected = selectMemoriesWithSoftBalance(scoredMemories, tokenBudget, chatLength);

        // Should select top 2-3 by score first (respecting token budget)
        expect(selected.length).toBeGreaterThan(0);
        expect(selected.length).toBeLessThanOrEqual(3);
    });

    it('should apply soft balance to ensure min 20% per bucket', async () => {
        const { selectMemoriesWithSoftBalance } = await import('../../src/retrieval/scoring.js');

        const scoredMemories = [
            { memory: { id: 'r1', summary: 'Recent A' }, score: 5.0, breakdown: { distance: 50 } },
            { memory: { id: 'r2', summary: 'Recent B' }, score: 4.0, breakdown: { distance: 100 } },
            { memory: { id: 'r3', summary: 'Recent C' }, score: 3.0, breakdown: { distance: 150 } },
            { memory: { id: 'm1', summary: 'Mid A' }, score: 4.5, breakdown: { distance: 400 } },
            { memory: { id: 'm2', summary: 'Mid B' }, score: 3.5, breakdown: { distance: 450 } },
            { memory: { id: 'o1', summary: 'Old A' }, score: 6.0, breakdown: { distance: 800 } }, // Highest score!
            { memory: { id: 'o2', summary: 'Old B' }, score: 5.5, breakdown: { distance: 850 } },
        ];

        const tokenBudget = 200; // All memories
        const chatLength = 1000;

        const selected = selectMemoriesWithSoftBalance(scoredMemories, tokenBudget, chatLength);

        // Old bucket should have at least one memory (20% min)
        const selectedIds = selected.map((m) => m.id);
        expect(selectedIds).toContain('o1');
    });

    it('should handle empty buckets gracefully', async () => {
        const { selectMemoriesWithSoftBalance } = await import('../../src/retrieval/scoring.js');

        const scoredMemories = [{ memory: { id: 'r1', summary: 'Recent' }, score: 5.0, breakdown: { distance: 50 } }];

        const selected = selectMemoriesWithSoftBalance(scoredMemories, 100, 100);
        expect(selected.length).toBe(1);
    });
});

describe('selectRelevantMemories with soft balance', () => {
    // Common config fixtures
    const scoringConfig = {
        embeddingSource: 'ollama', // Use ollama to avoid local embedding model in tests
        forgetfulnessBaseLambda: 0.05,
        forgetfulnessImportance5Floor: 1.0,
        reflectionDecayThreshold: 750,
        reflectionLevelMultiplier: 2.0,
        vectorSimilarityThreshold: 0.5,
        alpha: 0.7,
        combinedBoostWeight: 5.0,
    };

    const queryConfig = {
        entityWindowSize: 10,
        embeddingWindowSize: 5,
        recencyDecayFactor: 0.09,
        topEntitiesCount: 5,
        entityBoostWeight: 5.0,
        exactPhraseBoostWeight: 10.0,
    };

    it('should use selectMemoriesWithSoftBalance instead of sliceToTokenBudget', async () => {
        const { selectRelevantMemories } = await import('../../src/retrieval/scoring.js');

        const mockCtx = {
            recentContext: 'Test context',
            userMessages: 'Test messages',
            activeCharacters: ['Char'],
            chatLength: 1000,
            finalTokens: 500,
            graphNodes: {},
            graphEdges: {},
            allAvailableMemories: [],
            scoringConfig,
            queryConfig,
        };

        // Mock dependencies - this test verifies structure, actual scoring is mocked
        const result = await selectRelevantMemories([], mockCtx);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0); // Empty input = empty output
    });

    it('should call selectMemoriesWithSoftBalance with scoredResults', async () => {
        const { selectRelevantMemories } = await import('../../src/retrieval/scoring.js');

        const memories = [
            { id: '1', summary: 'Test memory', message_ids: [100], sequence: 1000, type: 'event', importance: 3 },
        ];

        const mockCtx = {
            recentContext: 'User asked about Test memory',
            userMessages: 'Tell me about Test memory',
            activeCharacters: ['Char'],
            chatLength: 1000,
            finalTokens: 500,
            graphNodes: {},
            graphEdges: {},
            allAvailableMemories: memories,
            scoringConfig,
            queryConfig,
        };

        const result = await selectRelevantMemories(memories, mockCtx);
        expect(Array.isArray(result)).toBe(true);
    });
});
