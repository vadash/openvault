import { describe, expect, it } from 'vitest';

describe('Access-Reinforced Decay (hitDamping)', () => {
    it('should return hitDamping=1.0 when retrieval_hits is 0', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { message_ids: [10], importance: 3, retrieval_hits: 0 };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };
        const result = calculateScore(memory, null, 100, constants, settings);
        expect(result.hitDamping).toBeCloseTo(1.0);
    });

    it('should return hitDamping=1.0 when retrieval_hits is missing', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { message_ids: [10], importance: 3 };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };
        const result = calculateScore(memory, null, 100, constants, settings);
        expect(result.hitDamping).toBeCloseTo(1.0);
    });

    it('should dampen decay for 5 retrieval_hits (hitDamping ≈ 0.67)', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { message_ids: [10], importance: 3, retrieval_hits: 5 };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };
        const result = calculateScore(memory, null, 100, constants, settings);
        // 1 / (1 + 5 * 0.1) = 1/1.5 ≈ 0.667
        expect(result.hitDamping).toBeCloseTo(1 / 1.5, 2);
    });

    it('should cap hitDamping at 0.5 for very high retrieval_hits', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { message_ids: [10], importance: 3, retrieval_hits: 100 };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };
        const result = calculateScore(memory, null, 100, constants, settings);
        expect(result.hitDamping).toBeCloseTo(0.5);
    });

    it('should produce higher base score with hits than without at same distance', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };

        const noHits = calculateScore(
            { message_ids: [10], importance: 3, retrieval_hits: 0 }, null, 200, constants, settings
        );
        const withHits = calculateScore(
            { message_ids: [10], importance: 3, retrieval_hits: 10 }, null, 200, constants, settings
        );
        expect(withHits.base).toBeGreaterThan(noHits.base);
    });
});

describe('calculateIDF with expanded corpus', () => {
    it('should calculate lower IDF for common terms when hidden memories included', async () => {
        const { tokenize, calculateIDF } = await import('../../src/retrieval/math.js');

        const candidates = [{ summary: 'The brave knight fought' }, { summary: 'The kingdom is at peace' }];
        const hidden = [
            { summary: 'The brave knight visited the castle' },
            { summary: 'The brave knight met the king' },
            { summary: 'The king declared war' },
        ];

        // Tokenize all memories
        const tokenizedCandidates = candidates.map((m, i) => [i, tokenize(m.summary)]);
        const tokenizedHidden = hidden.map((m, i) => [i + candidates.length, tokenize(m.summary)]);

        // Calculate IDF with expanded corpus (candidates + hidden)
        const { idfMap: expandedIdf } = calculateIDF(
            [...candidates, ...hidden],
            new Map([...tokenizedCandidates, ...tokenizedHidden])
        );

        // Calculate IDF with candidates only
        const { idfMap: candidatesOnlyIdf } = calculateIDF(candidates, new Map(tokenizedCandidates));

        // "knight" appears in 3/5 = 60% of expanded corpus vs 1/2 = 50% of candidates only
        // Expanded corpus should have LOWER IDF for "knight" (more common in broader context)
        const knightExpandedIdf = expandedIdf.get('knight') ?? 0;
        const knightCandidatesOnlyIdf = candidatesOnlyIdf.get('knight') ?? 0;

        // Both should exist and expanded should be lower
        expect(knightExpandedIdf).toBeGreaterThan(0);
        expect(knightCandidatesOnlyIdf).toBeGreaterThan(0);
        expect(knightExpandedIdf).toBeLessThan(knightCandidatesOnlyIdf);
    });

    it('should handle empty hidden memories array', async () => {
        const { tokenize, calculateIDF } = await import('../../src/retrieval/math.js');

        const candidates = [{ summary: 'Suzy fought bravely' }, { summary: 'The kingdom is at peace' }];

        const tokenized = new Map(candidates.map((m, i) => [i, tokenize(m.summary)]));
        const { idfMap } = calculateIDF(candidates, tokenized);

        expect(idfMap.size).toBeGreaterThan(0);
    });
});

describe('Frequency Factor (mentions boost)', () => {
    it('should return frequencyFactor=1.0 when mentions is 1 (default)', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { message_ids: [10], importance: 3, mentions: 1 };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };
        const result = calculateScore(memory, null, 100, constants, settings);
        expect(result.frequencyFactor).toBeCloseTo(1.0);
    });

    it('should return frequencyFactor=1.0 when mentions is missing', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { message_ids: [10], importance: 3 };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };
        const result = calculateScore(memory, null, 100, constants, settings);
        expect(result.frequencyFactor).toBeCloseTo(1.0);
    });

    it('should boost score for mentions=10 (frequencyFactor ≈ 1.115)', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { message_ids: [10], importance: 3, mentions: 10 };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };
        const result = calculateScore(memory, null, 100, constants, settings);
        // 1 + Math.log(10) * 0.05 ≈ 1.115
        expect(result.frequencyFactor).toBeCloseTo(1 + Math.log(10) * 0.05, 2);
    });

    it('should boost score for mentions=50 (frequencyFactor ≈ 1.196)', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { message_ids: [10], importance: 3, mentions: 50 };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };
        const result = calculateScore(memory, null, 100, constants, settings);
        expect(result.frequencyFactor).toBeCloseTo(1 + Math.log(50) * 0.05, 2);
    });

    it('should multiply total by frequencyFactor', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };

        const noMentions = calculateScore(
            { message_ids: [10], importance: 3 }, null, 100, constants, settings
        );
        const withMentions = calculateScore(
            { message_ids: [10], importance: 3, mentions: 10 }, null, 100, constants, settings
        );
        // Total should be proportionally higher by frequencyFactor
        const expectedRatio = withMentions.frequencyFactor / noMentions.frequencyFactor;
        expect(withMentions.total / noMentions.total).toBeCloseTo(expectedRatio, 2);
    });
});
