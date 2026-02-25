/**
 * Tests for src/retrieval/math.js
 * Tests the pure mathematical functions for scoring.
 */
import { describe, expect, it } from 'vitest';
import { calculateScore, cosineSimilarity, scoreMemories, tokenize } from '../src/retrieval/math.js';

describe('math.js - alpha-blend scoring', () => {
    it('BM25 bonus is capped at (1-alpha) * combinedBoostWeight', () => {
        // Note: calculateScore expects pre-normalized BM25 [0,1] when using alpha-blend
        // This test verifies that even with normalized BM25 = 1.0, the bonus is capped
        const memory = { importance: 3, message_ids: [50], embedding: [1, 0, 0] };
        const contextEmbedding = [1, 0, 0]; // perfect similarity
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        // Pass normalized BM25 = 1.0 (max possible)
        const result = calculateScore(memory, contextEmbedding, 100, constants, settings, 1.0);
        // BM25 bonus should be at most (1 - 0.7) * 15 = 4.5
        // Use toBeCloseTo to account for floating point precision
        expect(result.bm25Bonus).toBeCloseTo(4.5, 1);
        expect(result.bm25Bonus).toBeLessThanOrEqual(4.6); // Safety margin
    });

    it('vector bonus uses alpha * combinedBoostWeight', () => {
        const memory = { importance: 3, message_ids: [100], embedding: [1, 0, 0] };
        const contextEmbedding = [1, 0, 0]; // sim = 1.0
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        const result = calculateScore(memory, contextEmbedding, 100, constants, settings, 0);
        // Vector bonus = alpha * weight * normalizedSim = 0.7 * 15 * 1.0 = 10.5
        expect(result.vectorBonus).toBeCloseTo(10.5, 1);
    });

    it('scoreMemories normalizes BM25 scores across batch', () => {
        const memories = [
            { summary: 'dragon attacked village', importance: 3, message_ids: [90] },
            { summary: 'dragon fled to mountain', importance: 3, message_ids: [80] },
            { summary: 'peaceful day in town', importance: 3, message_ids: [70] },
        ];
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        const results = scoreMemories(memories, null, 100, constants, settings, ['dragon']);
        // The memory with highest BM25 gets normalizedBM25 = 1.0
        // But its bonus is capped at (1 - 0.7) * 15 = 4.5
        for (const r of results) {
            expect(r.breakdown.bm25Bonus).toBeLessThanOrEqual(4.5 + 0.01);
        }
    });

    it('gracefully handles all-zero BM25 scores', () => {
        const memories = [{ summary: 'no match here', importance: 3, message_ids: [90] }];
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        const results = scoreMemories(memories, null, 100, constants, settings, ['zzzzz']);
        expect(results[0].breakdown.bm25Bonus).toBe(0);
    });

    it('uses legacy settings as fallback when alpha not provided', () => {
        const memory = { importance: 3, message_ids: [100], embedding: [1, 0, 0] };
        const contextEmbedding = [1, 0, 0];
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            vectorSimilarityWeight: 15,
            keywordMatchWeight: 3.0,
            // No alpha or combinedBoostWeight - should fall back to legacy behavior
        };
        const result = calculateScore(memory, contextEmbedding, 100, constants, settings, 0);
        // With default alpha=0.7 and combinedBoostWeight=15
        expect(result.vectorBonus).toBeCloseTo(10.5, 1);
    });

    it('respects vectorSimilarityThreshold in alpha-blend scoring', () => {
        // To test threshold, use orthogonal vectors (similarity = 0)
        const memory = { importance: 3, message_ids: [100], embedding: [1, 0] };
        const contextEmbedding = [0, 1]; // sim = 0 (orthogonal vectors)
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        const result = calculateScore(memory, contextEmbedding, 100, constants, settings, 0);
        // Similarity 0 < threshold 0.5, so no bonus
        expect(result.vectorBonus).toBe(0);
    });
});

describe('math.js - IDF-aware entity boost', () => {
    it('reduces relative boost for corpus-common vs corpus-rare entities', () => {
        // Create 20 memories: 10 with "suzi" (common), 10 with "dragon" (rare, only in 1)
        const memories = [
            // "suzi" appears in 10 memories (common)
            ...Array.from({ length: 10 }, (_, i) => ({
                summary: `Suzy did thing ${i}`,
                importance: 3,
                message_ids: [i * 10],
            })),
            // "dragon" appears in only 1 memory (rare)
            { summary: 'dragon attacked village', importance: 3, message_ids: [95] },
            // 9 other memories
            ...Array.from({ length: 9 }, (_, i) => ({
                summary: `peaceful day number ${i}`,
                importance: 3,
                message_ids: [i * 10 + 1],
            })),
        ];

        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };

        // Query with "suzi" repeated 15 times AND "dragon" repeated 15 times
        const queryTokens = [...Array(15).fill('suzi'), ...Array(15).fill('dragon')];
        const results = scoreMemories(memories, null, 100, constants, settings, queryTokens);

        // Find the dragon memory and a suzy memory
        const dragonMemory = results.find((r) => r.memory.summary.includes('dragon'));
        const suzyMemory = results.find((r) => r.memory.summary.includes('Suzy'));

        // Both should get some BM25 bonus, but dragon should rank higher
        // because "dragon" is rare (1/21 docs) vs "suzi" (10/21 docs)
        expect(dragonMemory).toBeDefined();
        expect(suzyMemory).toBeDefined();

        // The dragon memory should appear before suzy memories in results
        // (higher score due to higher IDF for the rare term)
        const dragonIndex = results.indexOf(dragonMemory);
        const suzyIndex = results.indexOf(suzyMemory);
        expect(dragonIndex).toBeLessThan(suzyIndex);
    });

    it('preserves strong boost for corpus-rare entity tokens', () => {
        // 10 memories, only 1 containing "dragon"
        const memories = [
            { summary: 'dragon attacked village', importance: 3, message_ids: [90] },
            ...Array.from({ length: 9 }, (_, i) => ({
                summary: `peaceful day number ${i}`,
                importance: 3,
                message_ids: [i * 10],
            })),
        ];
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        // Query with "dragon" repeated 15 times
        const queryTokens = Array(15).fill('dragon');
        const results = scoreMemories(memories, null, 100, constants, settings, queryTokens);

        // "dragon" is rare (1/10 docs), IDF is high → BM25 bonus should be significant
        const dragonMemory = results.find((r) => r.memory.summary.includes('dragon'));
        expect(dragonMemory.breakdown.bm25Bonus).toBeGreaterThan(3.0);
    });

    it('handles empty query tokens gracefully', () => {
        const memories = [{ summary: 'test memory', importance: 3, message_ids: [10] }];
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        const results = scoreMemories(memories, null, 100, constants, settings, []);
        expect(results[0].breakdown.bm25Bonus).toBe(0);
        expect(results[0].breakdown.bm25Score).toBe(0);
    });

    it('handles null/undefined query tokens', () => {
        const memories = [{ summary: 'test memory', importance: 3, message_ids: [10] }];
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        const results1 = scoreMemories(memories, null, 100, constants, settings, null);
        expect(results1[0].breakdown.bm25Bonus).toBe(0);

        const results2 = scoreMemories(memories, null, 100, constants, settings, undefined);
        expect(results2[0].breakdown.bm25Bonus).toBe(0);
    });
});

describe('math.js - tokenization', () => {
    it('filters post-stem runt tokens (< 3 chars after stemming)', () => {
        // "боюсь" (5 chars) stems to "бо" (2 chars) via Russian Snowball
        const tokens = tokenize('боюсь страшно');
        // "бо" should be filtered out, "страшн" (stem of страшно) should remain
        for (const t of tokens) {
            expect(t.length).toBeGreaterThanOrEqual(3);
        }
    });

    it('filters stop words', () => {
        const tokens = tokenize('the dragon and the princess');
        // "the" and "and" should be filtered out
        expect(tokens).not.toContain('the');
        expect(tokens).not.toContain('and');
        expect(tokens).toContain('dragon');
        expect(tokens).toContain('princess');
    });
});
