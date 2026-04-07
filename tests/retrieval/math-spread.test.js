// @ts-check
/* global describe, expect, it */
import { describe, expect, it } from 'vitest';

/**
 * Tests that scoreMemories and calculateScore work correctly with large iterables.
 *
 * Background: The original code used `Math.max(...idfMap.values())` and
 * `Math.max(...rawBM25Scores, 1e-9)` which can throw RangeError when the
 * spread exceeds the JS engine's argument limit (~65K-100K depending on engine).
 * The fix replaces these with safe iteration patterns.
 *
 * These tests verify correctness with large inputs. A direct RangeError
 * reproduction depends on the engine's argument limit and may not fail in
 * all Node.js versions, but the fix is necessary for browser runtimes.
 */

describe('scoreMemories - safe max over large iterables', () => {
    it('correctly scores with idfMap having 100K entries', async () => {
        const { calculateIDF, scoreMemories } = await import('../../src/retrieval/math.js');

        // Build a corpus with ~100K unique terms across 200 memories
        const memories = [];
        for (let i = 0; i < 200; i++) {
            const parts = [];
            for (let j = 0; j < 500; j++) {
                parts.push(`unique_term_${i}_${j}`);
            }
            memories.push({ summary: parts.join(' '), id: String(i) });
        }

        // Verify large idfMap
        const tokenizedMap = new Map();
        for (let i = 0; i < memories.length; i++) {
            const tokens = memories[i].summary.toLowerCase().match(/[\p{L}0-9_]+/gu) || [];
            tokenizedMap.set(i, tokens);
        }
        const { idfMap } = calculateIDF(memories, tokenizedMap);
        expect(idfMap.size).toBeGreaterThanOrEqual(90000);

        // Should not throw and should return valid scored results
        const result = await scoreMemories(
            memories,
            null,
            1,
            { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
            { alpha: 0.7, combinedBoostWeight: 15, vectorSimilarityThreshold: 0.5 },
            'unique_term_0_0 unique_term_1_1',
            [],
            [],
            null
        );
        expect(result).toHaveLength(memories.length);
        expect(result[0].score).toBeGreaterThan(0);
        expect(result[0].memory).toBeDefined();
    });

    it('correctly scores with 100K memories (large rawBM25Scores)', async () => {
        const { scoreMemories } = await import('../../src/retrieval/math.js');

        // 100K memories -> rawBM25Scores array has 100K entries
        // Math.max(...rawBM25Scores) would exceed the JS argument limit
        const memories = Array.from({ length: 100_000 }, (_, i) => ({
            summary: `memory about topic_${i} with details`,
            id: String(i),
        }));

        const result = await scoreMemories(
            memories,
            null,
            1,
            { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
            { alpha: 0.7, combinedBoostWeight: 15, vectorSimilarityThreshold: 0.5 },
            'topic_0 topic_1 topic_2',
            [],
            [],
            null
        );
        expect(result).toHaveLength(100_000);
        // Spot-check: all results should have valid scores
        for (const r of result) {
            expect(typeof r.score).toBe('number');
            expect(Number.isFinite(r.score)).toBe(true);
        }
    }, 60000);
});

describe('calculateScore - safe max over message_ids', () => {
    it('handles single-element message_ids', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const result = calculateScore(
            { importance: 3, message_ids: [50] },
            null,
            100,
            { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
            { alpha: 0.7, combinedBoostWeight: 15, vectorSimilarityThreshold: 0.5 },
            0
        );
        expect(result).toBeDefined();
        expect(result.distance).toBe(50);
    });

    it('handles multi-element message_ids', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const result = calculateScore(
            { importance: 3, message_ids: [10, 50, 90] },
            null,
            100,
            { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
            { alpha: 0.7, combinedBoostWeight: 15, vectorSimilarityThreshold: 0.5 },
            0
        );
        expect(result).toBeDefined();
        expect(result.distance).toBe(10); // 100 - max(10, 50, 90) = 10
    });
});
