import { describe, expect, it } from 'vitest';

const _DEFAULT_CONSTANTS = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
const _DEFAULT_SETTINGS = {
    vectorSimilarityThreshold: 0.5,
    alpha: 0.7,
    combinedBoostWeight: 15,
};

describe('Access-Reinforced Decay (hitDamping)', () => {
    it('should return hitDamping=1.0 when retrieval_hits is 0 or missing', async () => {
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
            { message_ids: [10], importance: 3, retrieval_hits: 0 },
            null,
            200,
            constants,
            settings
        );
        const withHits = calculateScore(
            { message_ids: [10], importance: 3, retrieval_hits: 10 },
            null,
            200,
            constants,
            settings
        );
        expect(withHits.base).toBeGreaterThan(noHits.base);
    });
});

describe('Frequency Factor (mentions boost)', () => {
    it('should return frequencyFactor=1.0 when mentions is 1 or missing', async () => {
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

        const noMentions = calculateScore({ message_ids: [10], importance: 3 }, null, 100, constants, settings);
        const withMentions = calculateScore(
            { message_ids: [10], importance: 3, mentions: 10 },
            null,
            100,
            constants,
            settings
        );
        const expectedRatio = withMentions.frequencyFactor / noMentions.frequencyFactor;
        expect(withMentions.total / noMentions.total).toBeCloseTo(expectedRatio, 2);
    });
});

describe('Reflection decay', () => {
    it('should apply decay to reflections beyond threshold', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };

        const reflection = { type: 'reflection', message_ids: [100], importance: 4 };
        const scoreBeforeThreshold = calculateScore(reflection, null, 500, constants, settings);
        const scoreAfterThreshold = calculateScore(reflection, null, 1000, constants, settings);

        expect(scoreBeforeThreshold.total).toBeGreaterThan(scoreAfterThreshold.total);
    });

    it('should not apply decay to non-reflection memories', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5, reflectionDecayThreshold: 500 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.7, combinedBoostWeight: 15 };

        const eventMemory = { type: 'event', importance: 5, message_ids: [0] };
        const reflectionMemory = { type: 'reflection', importance: 5, message_ids: [0] };

        const eventResult = calculateScore(eventMemory, null, 1000, constants, settings, 0);
        const reflectionResult = calculateScore(reflectionMemory, null, 1000, constants, settings, 0);

        expect(reflectionResult.total).toBeLessThan(eventResult.total);
    });

    it('should cap reflection decay at minimum factor of 0.25', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5, reflectionDecayThreshold: 500 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.7, combinedBoostWeight: 15 };

        const reflection = { type: 'reflection', importance: 5, message_ids: [0] };
        const result = calculateScore(reflection, null, 2000, constants, settings, 0);

        expect(result.total).toBeGreaterThanOrEqual(0.25);
    });

    it('should not apply decay when within threshold', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5, reflectionDecayThreshold: 500 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.7, combinedBoostWeight: 15 };

        const reflection = { type: 'reflection', importance: 5, message_ids: [600] };
        const result = calculateScore(reflection, null, 1000, constants, settings, 0);

        expect(result.total).toBeCloseTo(2.25, 0);
    });
});

describe('Transient decay multiplier', () => {
    const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
    const baseSettings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };

    it('should apply transient multiplier for transient memories', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { importance: 3, is_transient: true, message_ids: [50], retrieval_hits: 0 };
        const settings = { ...baseSettings, transientDecayMultiplier: 5.0 };

        const transientScore = calculateScore(memory, null, 100, constants, settings);
        const normalMemory = { ...memory, is_transient: false };
        const normalScore = calculateScore(normalMemory, null, 100, constants, settings);

        expect(transientScore.base).toBeLessThan(normalScore.base);
    });

    it('should not apply multiplier for non-transient memories', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { importance: 3, is_transient: false, message_ids: [50], retrieval_hits: 0 };
        const settings = { ...baseSettings, transientDecayMultiplier: 5.0 };

        const result = calculateScore(memory, null, 100, constants, settings);
        const expectedLambda = 0.05 / (3 * 3);
        const expectedBase = 3 * Math.exp(-expectedLambda * 50);

        expect(result.base).toBeCloseTo(expectedBase, 5);
    });

    it('should default multiplier to 5.0 when not provided', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const transientMemory = { importance: 3, is_transient: true, message_ids: [50], retrieval_hits: 0 };
        const normalMemory = { importance: 3, is_transient: false, message_ids: [50], retrieval_hits: 0 };

        const transientScore = calculateScore(transientMemory, null, 100, constants, baseSettings);
        const normalScore = calculateScore(normalMemory, null, 100, constants, baseSettings);

        expect(transientScore.base).toBeLessThan(normalScore.base);
    });

    it.each([
        { distance: 30 },
        { distance: 50 },
        { distance: 70 },
    ])('should correctly decay transient memories at distance $distance', async ({ distance }) => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const settings = { ...baseSettings, transientDecayMultiplier: 5.0 };

        const normalMemory = { importance: 3, is_transient: false, message_ids: [0], retrieval_hits: 0 };
        const transientMemory = { importance: 3, is_transient: true, message_ids: [0], retrieval_hits: 0 };

        const normalResult = calculateScore(normalMemory, null, distance, constants, settings);
        const transientResult = calculateScore(transientMemory, null, distance, constants, settings);

        expect(transientResult.base).toBeLessThan(normalResult.base);
        expect(transientResult.base).toBeGreaterThan(0);
    });
});

describe('calculateScore - settings clamping defense', () => {
    const BASE_CONSTANTS = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5, reflectionDecayThreshold: 750 };

    function makeMemory(overrides = {}) {
        return {
            id: 'test-1',
            summary: 'A test memory about something important',
            importance: 3,
            message_ids: [50],
            tokens: ['test', 'memori'],
            ...overrides,
        };
    }

    it('should not produce NaN when vectorSimilarityThreshold is 1.0', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = makeMemory({ embedding: [1, 0, 0] });
        const settings = {
            vectorSimilarityThreshold: 1.0,
            alpha: 0.7,
            combinedBoostWeight: 15,
            transientDecayMultiplier: 5.0,
        };
        const breakdown = calculateScore(memory, [1, 0, 0], 100, BASE_CONSTANTS, settings, 0);
        expect(Number.isFinite(breakdown.total)).toBe(true);
    });

    it('should not produce NaN when vectorSimilarityThreshold is negative', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = makeMemory({ embedding: [1, 0, 0] });
        const settings = {
            vectorSimilarityThreshold: -0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
            transientDecayMultiplier: 5.0,
        };
        const breakdown = calculateScore(memory, [1, 0, 0], 100, BASE_CONSTANTS, settings, 0);
        expect(Number.isFinite(breakdown.total)).toBe(true);
    });

    it('should not produce Infinity when transientDecayMultiplier is negative', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = makeMemory({ is_transient: true });
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
            transientDecayMultiplier: -5.0,
        };
        const breakdown = calculateScore(memory, null, 100, BASE_CONSTANTS, settings, 0);
        expect(Number.isFinite(breakdown.total)).toBe(true);
    });

    it('should not produce Infinity when alpha is extreme', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = makeMemory({ embedding: [1, 0, 0] });
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 999,
            combinedBoostWeight: 15,
            transientDecayMultiplier: 5.0,
        };
        const breakdown = calculateScore(memory, [1, 0, 0], 100, BASE_CONSTANTS, settings, 0);
        expect(Number.isFinite(breakdown.total)).toBe(true);
    });

    it('should not produce NaN when alpha is NaN', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = makeMemory();
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: NaN,
            combinedBoostWeight: 15,
            transientDecayMultiplier: 5.0,
        };
        const breakdown = calculateScore(memory, null, 100, BASE_CONSTANTS, settings, 0);
        expect(Number.isFinite(breakdown.total)).toBe(true);
    });

    it('should not produce Infinity when forgetfulnessBaseLambda is negative', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = makeMemory({ importance: 1, message_ids: [10] });
        const constants = { ...BASE_CONSTANTS, BASE_LAMBDA: -0.05 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        const breakdown = calculateScore(memory, null, 1000, constants, settings, 0);
        expect(Number.isFinite(breakdown.total)).toBe(true);
    });
});

describe('calculateScore - boundary behavior', () => {
    it('BM25 bonus capped at (1-alpha) * weight, vector bonus uses alpha * weight', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { importance: 3, message_ids: [50], embedding: [1, 0, 0] };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.7, combinedBoostWeight: 15 };

        const result = calculateScore(memory, [1, 0, 0], 100, constants, settings, 1.0);
        expect(result.bm25Bonus).toBeCloseTo(4.5, 1);
        expect(result.bm25Bonus).toBeLessThanOrEqual(4.6);

        const resultVector = calculateScore({ ...memory, message_ids: [100] }, [1, 0, 0], 100, constants, settings, 0);
        expect(resultVector.vectorBonus).toBeCloseTo(10.5, 1);
    });

    it('respects vector similarity threshold', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { importance: 3, message_ids: [100], embedding: [1, 0] };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.7, combinedBoostWeight: 15 };

        const result = calculateScore(memory, [0, 1], 100, constants, settings, 0);
        expect(result.vectorBonus).toBe(0);
    });

    it('importance-5 uses soft floor of 1.0', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { importance: 5, message_ids: [10], embedding: null };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.7, combinedBoostWeight: 15 };

        const result = calculateScore(memory, null, 1000, constants, settings, 0);
        expect(result.baseAfterFloor).toBeGreaterThanOrEqual(1.0);
        expect(result.baseAfterFloor).toBeLessThan(5.0);
    });

    it('should not produce Infinity when vectorSimilarityThreshold is 0.99-1.0', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { importance: 3, message_ids: [100], embedding: [1, 0, 0] };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };

        for (const threshold of [0.99, 1.0]) {
            const settings = { vectorSimilarityThreshold: threshold, alpha: 0.7, combinedBoostWeight: 15 };
            const result = calculateScore(memory, [1, 0, 0], 100, constants, settings, 0);
            expect(Number.isFinite(result.vectorBonus)).toBe(true);
            expect(Number.isFinite(result.total)).toBe(true);
        }
    });
});

describe('BM25 with exact phrase boost behavior', () => {
    it('should apply additional boost for memories with exact phrase matches', async () => {
        const { scoreMemories } = await import('../../src/retrieval/math.js');

        const memories = [
            {
                id: '1',
                summary: 'She wore the burgundy lingerie set to bed',
                tokens: ['burgundi', 'lingeri', 'set'],
                message_ids: [100],
                importance: 3,
            },
            {
                id: '2',
                summary: 'He grabbed the key set from the table',
                tokens: ['key', 'set', 'tabl'],
                message_ids: [100],
                importance: 3,
            },
        ];

        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };

        const queryTokens = ['lingerie set', 'lingerie set', 'lingeri', 'set'];
        const scored = await scoreMemories(memories, null, 200, constants, settings, queryTokens);

        expect(scored[0].memory.id).toBe('1');
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

        const tokenizedCandidates = await Promise.all(candidates.map(async (m, i) => [i, await tokenize(m.summary)]));
        const tokenizedHidden = await Promise.all(
            hidden.map(async (m, i) => [i + candidates.length, await tokenize(m.summary)])
        );

        const { idfMap: expandedIdf } = calculateIDF(
            [...candidates, ...hidden],
            new Map([...tokenizedCandidates, ...tokenizedHidden])
        );
        const { idfMap: candidatesOnlyIdf } = calculateIDF(candidates, new Map(tokenizedCandidates));

        const knightExpandedIdf = expandedIdf.get('knight') ?? 0;
        const knightCandidatesOnlyIdf = candidatesOnlyIdf.get('knight') ?? 0;

        expect(knightExpandedIdf).toBeGreaterThan(0);
        expect(knightCandidatesOnlyIdf).toBeGreaterThan(0);
        expect(knightExpandedIdf).toBeLessThan(knightCandidatesOnlyIdf);
    });
});

describe('Debug cache propagation', () => {
    it('cacheScoringDetails includes hitDamping and frequencyFactor in scores', async () => {
        const { cacheScoringDetails, getCachedScoringDetails } = await import('../../src/retrieval/debug-cache.js');
        const scoredResults = [
            {
                memory: { id: 'test1', summary: 'Test event' },
                score: 2.5,
                breakdown: {
                    base: 2.0,
                    baseAfterFloor: 2.0,
                    recencyPenalty: 0,
                    vectorSimilarity: 0.6,
                    vectorBonus: 0.3,
                    bm25Score: 0.4,
                    bm25Bonus: 0.2,
                    total: 2.5,
                    distance: 50,
                    importance: 3,
                    hitDamping: 0.67,
                    frequencyFactor: 1.115,
                },
            },
        ];
        cacheScoringDetails(scoredResults, ['test1']);
        const cached = getCachedScoringDetails();
        expect(cached[0].scores.hitDamping).toBeCloseTo(0.67);
        expect(cached[0].scores.frequencyFactor).toBeCloseTo(1.115);
    });
});

describe('calculateScore - fingerprint resolution', () => {
    it('uses message_fingerprints over message_ids for distance calculation', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const chatFingerprintMap = new Map([['fp_45', 45]]);

        const memory = {
            importance: 3,
            message_ids: [90],
            message_fingerprints: ['fp_45'],
        };

        const result = calculateScore(
            memory,
            null,
            50,
            { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
            { alpha: 0.7, combinedBoostWeight: 15, vectorSimilarityThreshold: 0.5 },
            0,
            chatFingerprintMap
        );

        expect(result.distance).toBe(5);
    });

    it('falls back to message_ids when no fingerprints available', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { importance: 3, message_ids: [40] };

        const result = calculateScore(
            memory,
            null,
            50,
            { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
            { alpha: 0.7, combinedBoostWeight: 15, vectorSimilarityThreshold: 0.5 },
            0,
            null
        );

        expect(result.distance).toBe(10);
    });

    it('uses max fingerprint position when multiple fingerprints', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const chatFingerprintMap = new Map([
            ['fp_10', 10],
            ['fp_42', 42],
        ]);

        const memory = {
            importance: 3,
            message_ids: [99],
            message_fingerprints: ['fp_10', 'fp_42'],
        };

        const result = calculateScore(
            memory,
            null,
            50,
            { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
            { alpha: 0.7, combinedBoostWeight: 15, vectorSimilarityThreshold: 0.5 },
            0,
            chatFingerprintMap
        );

        expect(result.distance).toBe(8);
    });
});

describe('calculateScore - slow-pass vector override clamping', () => {
    const BASE_CONSTANTS = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5, reflectionDecayThreshold: 750 };

    it('should not produce NaN in the two-pass vector re-scoring path', async () => {
        const { scoreMemories } = await import('../../src/retrieval/math.js');
        const memories = [
            {
                id: 'm1',
                summary: 'A memory about a forest',
                importance: 3,
                message_ids: [50],
                tokens: ['memori', 'forest'],
                embedding: new Float32Array([1, 0, 0]),
            },
            {
                id: 'm2',
                summary: 'A memory about the ocean',
                importance: 3,
                message_ids: [60],
                tokens: ['memori', 'ocean'],
                embedding: new Float32Array([0, 1, 0]),
            },
        ];

        const settings = {
            vectorSimilarityThreshold: 0.999,
            alpha: 0.7,
            combinedBoostWeight: 15,
            transientDecayMultiplier: 5.0,
        };

        const result = await scoreMemories(
            memories,
            new Float32Array([1, 0, 0]),
            100,
            BASE_CONSTANTS,
            settings,
            'forest'
        );
        for (const scored of result) {
            expect(Number.isFinite(scored.score)).toBe(true);
            expect(Number.isFinite(scored.breakdown.vectorBonus)).toBe(true);
        }
    });
});

describe('cosineSimilarity - short and long vectors', () => {
    it('Float32Array orthogonal vectors (short)', async () => {
        const { cosineSimilarity } = await import('../../src/retrieval/math.js');
        const result = cosineSimilarity(new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0]));
        expect(result).toBeCloseTo(0, 10);
    });

    it('identical Float32Array vectors (short)', async () => {
        const { cosineSimilarity } = await import('../../src/retrieval/math.js');
        const a = new Float32Array([0.5, 0.5, 0.5]);
        expect(cosineSimilarity(a, a)).toBeCloseTo(1.0, 10);
    });

    it('produces identical results on 384-dim vs naive reference', async () => {
        const { cosineSimilarity } = await import('../../src/retrieval/math.js');
        const a = new Float32Array(384);
        const b = new Float32Array(384);
        for (let i = 0; i < 384; i++) {
            a[i] = Math.sin(i * 0.1);
            b[i] = Math.cos(i * 0.1);
        }
        let dot = 0,
            na = 0,
            nb = 0;
        for (let i = 0; i < 384; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        const expected = dot / (Math.sqrt(na) * Math.sqrt(nb));
        expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 10);
    });
});

describe('math.js - tokenization', () => {
    it('filters post-stem runt tokens (< 3 chars) and stop words', async () => {
        const { tokenize } = await import('../../src/retrieval/math.js');
        const tokens = await tokenize('the dragon and the princess');
        expect(tokens).not.toContain('the');
        expect(tokens).not.toContain('and');
        expect(tokens).toContain('dragon');
        expect(tokens).toContain('princess');
        for (const t of tokens) {
            expect(t.length).toBeGreaterThanOrEqual(3);
        }
    });

    it('handles Russian stemming', async () => {
        const { tokenize } = await import('../../src/retrieval/math.js');
        const tokens = await tokenize('драконы дракону');
        expect(tokens).toContain('дракон');
    });
});

describe('scoreMemories - dynamic character stopwords', () => {
    it('filters character names from BM25 tokens when characterNames provided', async () => {
        const { scoreMemories } = await import('../../src/retrieval/math.js');
        const memories = [
            { importance: 3, message_ids: [10], embedding: null, summary: 'Suzy walked to the park with her dog' },
            { importance: 3, message_ids: [30], embedding: null, summary: 'Suzy cooked pasta for dinner tonight' },
        ];

        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.7, combinedBoostWeight: 15 };

        const resultWith = await scoreMemories(memories, null, 50, constants, settings, 'suzy park dog', ['suzy']);
        const resultWithout = await scoreMemories(memories, null, 50, constants, settings, 'suzy park dog', []);

        const parkMemoryWith = resultWith.find((r) => r.memory.summary.includes('park'));
        const pastaMemoryWith = resultWith.find((r) => r.memory.summary.includes('pasta'));
        const parkMemoryWithout = resultWithout.find((r) => r.memory.summary.includes('park'));
        const pastaMemoryWithout = resultWithout.find((r) => r.memory.summary.includes('pasta'));

        const gapWith = parkMemoryWith.score - pastaMemoryWith.score;
        const gapWithout = parkMemoryWithout.score - pastaMemoryWithout.score;
        expect(gapWith).toBeGreaterThan(gapWithout);
    });
});
