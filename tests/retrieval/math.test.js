import { describe, expect, it } from 'vitest';

// Default constants reused across scoring tests
const DEFAULT_CONSTANTS = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
const DEFAULT_SETTINGS = {
    vectorSimilarityThreshold: 0.5,
    alpha: 0.7,
    combinedBoostWeight: 15,
};

describe('calculateScore - parameterized alpha-blend', () => {
    const SCORE_CASES = [
        {
            name: 'BM25 bonus capped at (1-alpha) * weight',
            memory: { importance: 3, message_ids: [50], embedding: [1, 0, 0] },
            contextEmbedding: [1, 0, 0],
            chatPosition: 100,
            settings: { alpha: 0.7, combinedBoostWeight: 15 },
            normalizedBm25: 1.0,
            expect: { field: 'bm25Bonus', closeTo: 4.5, precision: 1 },
        },
        {
            name: 'vector bonus uses alpha * weight',
            memory: { importance: 3, message_ids: [100], embedding: [1, 0, 0] },
            contextEmbedding: [1, 0, 0],
            chatPosition: 100,
            settings: { alpha: 0.7, combinedBoostWeight: 15 },
            normalizedBm25: 0,
            expect: { field: 'vectorBonus', closeTo: 10.5, precision: 1 },
        },
        {
            name: 'respects vector similarity threshold',
            memory: { importance: 3, message_ids: [100], embedding: [1, 0] },
            contextEmbedding: [0, 1], // sim = 0 (orthogonal)
            chatPosition: 100,
            settings: { vectorSimilarityThreshold: 0.5, alpha: 0.7, combinedBoostWeight: 15 },
            normalizedBm25: 0,
            expect: { field: 'vectorBonus', toBe: 0 },
        },
        {
            name: 'importance-5 uses soft floor of 1.0',
            memory: { importance: 5, message_ids: [10], embedding: null },
            contextEmbedding: null,
            chatPosition: 1000, // distance 990
            settings: {},
            normalizedBm25: 0,
            expect: [
                { field: 'baseAfterFloor', gte: 1.0 },
                { field: 'baseAfterFloor', lt: 5.0 },
            ],
        },
    ];

    it.each(SCORE_CASES)('$name', async ({
        memory,
        contextEmbedding,
        chatPosition,
        settings,
        normalizedBm25,
        expect: exp,
    }) => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
        const result = calculateScore(
            memory,
            contextEmbedding,
            chatPosition,
            DEFAULT_CONSTANTS,
            mergedSettings,
            normalizedBm25
        );

        const expectations = Array.isArray(exp) ? exp : [exp];
        for (const e of expectations) {
            if (e.closeTo !== undefined) {
                expect(result[e.field]).toBeCloseTo(e.closeTo, e.precision);
            }
            if (e.toBe !== undefined) {
                expect(result[e.field]).toBe(e.toBe);
            }
            if (e.gte !== undefined) {
                expect(result[e.field]).toBeGreaterThanOrEqual(e.gte);
            }
            if (e.lt !== undefined) {
                expect(result[e.field]).toBeLessThan(e.lt);
            }
        }
    });
});

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
        const tokenizedCandidates = await Promise.all(candidates.map(async (m, i) => [i, await tokenize(m.summary)]));
        const tokenizedHidden = await Promise.all(
            hidden.map(async (m, i) => [i + candidates.length, await tokenize(m.summary)])
        );

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

        const tokenized = new Map(await Promise.all(candidates.map(async (m, i) => [i, await tokenize(m.summary)])));
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

        const noMentions = calculateScore({ message_ids: [10], importance: 3 }, null, 100, constants, settings);
        const withMentions = calculateScore(
            { message_ids: [10], importance: 3, mentions: 10 },
            null,
            100,
            constants,
            settings
        );
        // Total should be proportionally higher by frequencyFactor
        const expectedRatio = withMentions.frequencyFactor / noMentions.frequencyFactor;
        expect(withMentions.total / noMentions.total).toBeCloseTo(expectedRatio, 2);
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

describe('hasExactPhrase', () => {
    it('should return true when phrase exists in memory summary', async () => {
        const { hasExactPhrase } = await import('../../src/retrieval/math.js');

        const memory = { summary: 'The King Aldric ruled wisely for decades' };
        const result = hasExactPhrase('King Aldric', memory);
        expect(result).toBe(true);
    });

    it('should be case-insensitive', async () => {
        const { hasExactPhrase } = await import('../../src/retrieval/math.js');

        const memory = { summary: 'KING ALDRIC ruled the kingdom' };
        expect(hasExactPhrase('king aldrIC', memory)).toBe(true);
    });

    it('should normalize whitespace', async () => {
        const { hasExactPhrase } = await import('../../src/retrieval/math.js');

        const memory = { summary: 'The  King   Aldric  arrived' }; // extra spaces
        expect(hasExactPhrase('King Aldric', memory)).toBe(true);
    });

    it('should return false for partial matches', async () => {
        const { hasExactPhrase } = await import('../../src/retrieval/math.js');

        const memory = { summary: 'The King ruled alone' };
        expect(hasExactPhrase('King Aldric', memory)).toBe(false); // "Aldric" missing
    });

    it('should return false for word-order mismatches', async () => {
        const { hasExactPhrase } = await import('../../src/retrieval/math.js');

        const memory = { summary: 'Aldric the King arrived' };
        expect(hasExactPhrase('King Aldric', memory)).toBe(false);
    });

    it('should handle punctuation by stripping it', async () => {
        const { hasExactPhrase } = await import('../../src/retrieval/math.js');

        const memory = { summary: 'King Aldric, Jr. was crowned' };
        expect(hasExactPhrase('King Aldric', memory)).toBe(true);
    });
});

describe('BM25 with exact phrase tokens', () => {
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

        const contextEmbedding = null;
        const chatLength = 200;
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };

        // Query tokens: "бордовый комплект белья" as exact phrase + stems
        // This simulates user typing about the burgundy lingerie set
        const queryTokens = [
            'lingerie set',
            'lingerie set', // Layer 0 (10x would be 10, using 2 for test)
            'lingeri',
            'set', // Layer 1 stems
        ];

        const scored = await scoreMemories(memories, contextEmbedding, chatLength, constants, settings, queryTokens);

        // Memory 1 should score higher due to exact phrase "lingerie set" appearing
        expect(scored.length).toBe(2);
        expect(scored[0].memory.id).toBe('1'); // Higher score due to exact phrase match
    });

    it('should treat exact phrases as separate scoring dimension from stems', async () => {
        const { scoreMemories } = await import('../../src/retrieval/math.js');

        const memories = [
            {
                id: '1',
                summary: 'The King Aldric ruled wisely',
                tokens: ['king', 'aldr', 'rule', 'wis'],
                message_ids: [100],
                importance: 3,
            },
            {
                id: '2',
                summary: 'Aldric was a great ruler',
                tokens: ['aldr', 'great', 'ruler'],
                message_ids: [100],
                importance: 3,
            },
        ];

        const contextEmbedding = null;
        const chatLength = 200;
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };

        // Query with both exact phrase "King Aldric" and stems
        const queryTokens = [
            'King Aldric', // Layer 0: exact phrase
            'king',
            'aldr', // Layer 1: stems
        ];

        const scored = await scoreMemories(memories, contextEmbedding, chatLength, constants, settings, queryTokens);

        // Memory 1 should score higher due to exact phrase match
        expect(scored[0].memory.id).toBe('1');
        expect(scored[0].score).toBeGreaterThan(scored[1].score);
    });

    it('should handle query with only stem tokens (no exact phrases)', async () => {
        const { scoreMemories } = await import('../../src/retrieval/math.js');

        const memories = [
            {
                id: '1',
                summary: 'The brave knight fought',
                tokens: ['brave', 'knight', 'fought'],
                message_ids: [100],
                importance: 3,
            },
            {
                id: '2',
                summary: 'The kingdom is at peace',
                tokens: ['kingdom', 'peace'],
                message_ids: [100],
                importance: 3,
            },
        ];

        const contextEmbedding = null;
        const chatLength = 200;
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };

        // Query with only stems (no spaces = no exact phrases)
        const queryTokens = ['knight', 'fought'];

        const scored = await scoreMemories(memories, contextEmbedding, chatLength, constants, settings, queryTokens);

        expect(scored.length).toBe(2);
        expect(scored[0].memory.id).toBe('1'); // Memory 1 matches the stems
    });
});

describe('Reflection decay', () => {
    it('should apply decay to reflections beyond threshold', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');

        const constants = {
            BASE_LAMBDA: 0.05,
            IMPORTANCE_5_FLOOR: 1.0,
            reflectionDecayThreshold: 750,
        };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };

        const reflection = {
            type: 'reflection',
            message_ids: [100],
            importance: 4,
        };

        // Reflection at distance 500 (before threshold) should score higher than at distance 1000 (past threshold)
        const scoreBeforeThreshold = calculateScore(reflection, null, 500, constants, settings);
        const scoreAfterThreshold = calculateScore(reflection, null, 1000, constants, settings);

        expect(scoreBeforeThreshold.total).toBeGreaterThan(scoreAfterThreshold.total);
    });
});

describe('Transient decay multiplier', () => {
    const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
    const baseSettings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };

    it('should apply transient multiplier for transient memories', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');

        const memory = {
            importance: 3,
            is_transient: true,
            message_ids: [50],
            retrieval_hits: 0,
        };
        const settings = { ...baseSettings, transientDecayMultiplier: 5.0 };

        const transientScore = calculateScore(memory, null, 100, constants, settings);

        // Same memory without is_transient should have higher score
        const normalMemory = { ...memory, is_transient: false };
        const normalScore = calculateScore(normalMemory, null, 100, constants, settings);

        expect(transientScore.base).toBeLessThan(normalScore.base);
    });

    it('should not apply multiplier for non-transient memories', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');

        const memory = {
            importance: 3,
            is_transient: false,
            message_ids: [50],
            retrieval_hits: 0,
        };
        const settings = { ...baseSettings, transientDecayMultiplier: 5.0 };

        const result = calculateScore(memory, null, 100, constants, settings);
        // Score should be standard calculation without multiplier
        const expectedLambda = 0.05 / (3 * 3); // baseLambda / importance^2
        const expectedBase = 3 * Math.exp(-expectedLambda * 50);

        expect(result.base).toBeCloseTo(expectedBase, 5);
    });

    it('should default multiplier to 5.0 when not provided', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');

        const transientMemory = {
            importance: 3,
            is_transient: true,
            message_ids: [50],
            retrieval_hits: 0,
        };
        const normalMemory = {
            importance: 3,
            is_transient: false,
            message_ids: [50],
            retrieval_hits: 0,
        };
        // settings WITHOUT transientDecayMultiplier
        const settings = baseSettings;

        const transientScore = calculateScore(transientMemory, null, 100, constants, settings);
        const normalScore = calculateScore(normalMemory, null, 100, constants, settings);

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

describe('calculateScore - fingerprint resolution', () => {
    it('uses message_fingerprints over message_ids for distance calculation', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');

        const chatFingerprintMap = new Map([['fp_45', 45]]);

        // Memory created at chat length 100 with message_ids=[90] (now stale after deletion)
        // But message_fingerprints point to a message that is now at index 45
        const memory = {
            importance: 3,
            message_ids: [90], // stale — original index
            message_fingerprints: ['fp_45'], // current fingerprint
        };

        const result = calculateScore(
            memory,
            null,
            50, // current chat length (after 50 messages deleted)
            { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
            { alpha: 0.7, combinedBoostWeight: 15, vectorSimilarityThreshold: 0.5 },
            0,
            chatFingerprintMap
        );

        // With stale message_ids: distance = max(0, 50 - 90) = 0 (broken — appears brand new)
        // With fingerprints: distance = max(0, 50 - 45) = 5 (correct)
        expect(result.distance).toBe(5);
    });

    it('falls back to message_ids when no fingerprints available', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');

        const memory = {
            importance: 3,
            message_ids: [40],
            // no message_fingerprints
        };

        const result = calculateScore(
            memory,
            null,
            50,
            { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
            { alpha: 0.7, combinedBoostWeight: 15, vectorSimilarityThreshold: 0.5 },
            0,
            null
        );

        expect(result).toBeDefined();
        expect(result.distance).toBe(10); // 50 - 40
    });

    it('falls back to message_ids when chatFingerprintMap is null', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');

        const memory = {
            importance: 3,
            message_ids: [40],
            message_fingerprints: ['fp_40'],
        };

        const result = calculateScore(
            memory,
            null,
            50,
            { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
            { alpha: 0.7, combinedBoostWeight: 15, vectorSimilarityThreshold: 0.5 },
            0,
            null // no map — should fall back to message_ids
        );

        expect(result).toBeDefined();
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
            message_ids: [99], // stale
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

        // Should use max fingerprint position: 42
        expect(result.distance).toBe(8); // 50 - 42
    });
});

describe('calculateScore - threshold edge cases', () => {
    it('should not produce Infinity when vectorSimilarityThreshold is 0.99', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = {
            importance: 3,
            message_ids: [100],
            embedding: [1, 0, 0], // Will produce cosine similarity of 1.0 with identical context
        };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.99, alpha: 0.7, combinedBoostWeight: 15 };
        const contextEmbedding = [1, 0, 0]; // Identical vectors
        const result = calculateScore(memory, contextEmbedding, 100, constants, settings, 0);
        expect(Number.isFinite(result.vectorBonus)).toBe(true);
        expect(Number.isFinite(result.total)).toBe(true);
    });

    it('should not produce Infinity when vectorSimilarityThreshold is 1.0', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = {
            importance: 3,
            message_ids: [100],
            embedding: [1, 0, 0],
        };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 1.0, alpha: 0.7, combinedBoostWeight: 15 };
        const contextEmbedding = [1, 0, 0];
        const result = calculateScore(memory, contextEmbedding, 100, constants, settings, 0);
        expect(Number.isFinite(result.vectorBonus)).toBe(true);
        expect(Number.isFinite(result.total)).toBe(true);
    });
});

// Large iterable handling
// Tests that scoreMemories and calculateScore work correctly with large iterables.
//
// Background: The original code used `Math.max(...idfMap.values())` and
// `Math.max(...rawBM25Scores, 1e-9)` which can throw RangeError when the
// spread exceeds the JS engine's argument limit (~65K-100K depending on engine).
// The fix replaces these with safe iteration patterns.
//
// These tests verify correctness with large inputs. A direct RangeError
// reproduction depends on the engine's argument limit and may not fail in
// all Node.js versions, but the fix is necessary for browser runtimes.

describe('Large iterable handling', () => {
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
});

describe('math.js - alpha-blend scoring (legacy)', () => {
    it('BM25 bonus is capped at (1-alpha) * combinedBoostWeight', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
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

    it('vector bonus uses alpha * combinedBoostWeight', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
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

    it('scoreMemories normalizes BM25 scores across batch', async () => {
        const { scoreMemories } = await import('../../src/retrieval/math.js');
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
        const results = await scoreMemories(memories, null, 100, constants, settings, ['dragon']);
        // The memory with highest BM25 gets normalizedBM25 = 1.0
        // But its bonus is capped at (1 - 0.7) * 15 = 4.5
        for (const r of results) {
            expect(r.breakdown.bm25Bonus).toBeLessThanOrEqual(4.5 + 0.01);
        }
    });

    it('gracefully handles all-zero BM25 scores', async () => {
        const { scoreMemories } = await import('../../src/retrieval/math.js');
        const memories = [{ summary: 'no match here', importance: 3, message_ids: [90] }];
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        const results = await scoreMemories(memories, null, 100, constants, settings, ['zzzzz']);
        expect(results[0].breakdown.bm25Bonus).toBe(0);
    });

    it('respects vectorSimilarityThreshold in alpha-blend scoring', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
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

    it('importance-5 memory uses soft floor of 1.0 instead of hard IMPORTANCE_5_FLOOR', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { importance: 5, message_ids: [10], embedding: null };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.7, combinedBoostWeight: 15 };
        // At distance 990 from chat position 1000, the natural decay should be well below 5
        const result = calculateScore(memory, null, 1000, constants, settings, 0);
        // With soft floor: baseAfterFloor should be >= 1.0 but NOT >= 5.0
        expect(result.baseAfterFloor).toBeGreaterThanOrEqual(1.0);
        expect(result.baseAfterFloor).toBeLessThan(5.0);
    });

    it('importance-5 memory still decays naturally when above soft floor', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = { importance: 5, message_ids: [95], embedding: null };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.7, combinedBoostWeight: 15 };
        // At distance 5, natural decay is very small: 5 * e^(-0.002*5) ≈ 4.95
        const result = calculateScore(memory, null, 100, constants, settings, 0);
        // Should use natural value, no floor needed
        expect(result.baseAfterFloor).toBeCloseTo(result.base, 2);
    });
});

describe('math.js - IDF-aware entity boost', () => {
    it('reduces relative boost for corpus-common vs corpus-rare entities', async () => {
        const { scoreMemories } = await import('../../src/retrieval/math.js');
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
        const results = await scoreMemories(memories, null, 100, constants, settings, queryTokens);

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

    it('preserves strong boost for corpus-rare entity tokens', async () => {
        const { scoreMemories } = await import('../../src/retrieval/math.js');
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
        const results = await scoreMemories(memories, null, 100, constants, settings, queryTokens);

        // "dragon" is rare (1/10 docs), IDF is high → BM25 bonus should be significant
        const dragonMemory = results.find((r) => r.memory.summary.includes('dragon'));
        expect(dragonMemory.breakdown.bm25Bonus).toBeGreaterThan(3.0);
    });

    it('handles empty query tokens gracefully', async () => {
        const { scoreMemories } = await import('../../src/retrieval/math.js');
        const memories = [{ summary: 'test memory', importance: 3, message_ids: [10] }];
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        const results = await scoreMemories(memories, null, 100, constants, settings, []);
        expect(results[0].breakdown.bm25Bonus).toBe(0);
        expect(results[0].breakdown.bm25Score).toBe(0);
    });

    it('handles null/undefined query tokens', async () => {
        const { scoreMemories } = await import('../../src/retrieval/math.js');
        const memories = [{ summary: 'test memory', importance: 3, message_ids: [10] }];
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        const results1 = await scoreMemories(memories, null, 100, constants, settings, null);
        expect(results1[0].breakdown.bm25Bonus).toBe(0);

        const results2 = await scoreMemories(memories, null, 100, constants, settings, undefined);
        expect(results2[0].breakdown.bm25Bonus).toBe(0);
    });
});

describe('math.js - reflection decay', () => {
    it('applies decay multiplier to old reflections beyond threshold', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5, reflectionDecayThreshold: 500 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };

        // Reflection at distance 100 (within threshold - no decay)
        const nearReflection = { type: 'reflection', importance: 5, message_ids: [900] };
        const nearResult = calculateScore(nearReflection, null, 1000, constants, settings, 0);

        // Same reflection at distance 1000 (beyond threshold - decay applies)
        // distance = 1000, threshold = 500
        // decayFactor = Math.max(0.25, 1 - (1000 - 500) / (2 * 500)) = Math.max(0.25, 1 - 0.5) = 0.5
        const farReflection = { type: 'reflection', importance: 5, message_ids: [0] };
        const farResult = calculateScore(farReflection, null, 1000, constants, settings, 0);

        // Far reflection should score lower due to decay
        expect(farResult.total).toBeLessThan(nearResult.total);

        // The far reflection's total should be approximately the near reflection's base times decay factor
        // With importance 5, the base is near the floor, so we can verify the decay is applied
        // by checking far is meaningfully lower (at least 30% reduction)
        expect(farResult.total / nearResult.total).toBeLessThan(0.7);
    });

    it('does not apply decay to non-reflection memories', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5, reflectionDecayThreshold: 500 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };

        // Event memory at distance 1000 (no reflection decay should apply)
        const eventMemory = { type: 'event', importance: 5, message_ids: [0] };
        const eventResult = calculateScore(eventMemory, null, 1000, constants, settings, 0);

        // Reflection at same distance and importance (reflection decay should apply)
        const reflectionMemory = { type: 'reflection', importance: 5, message_ids: [0] };
        const reflectionResult = calculateScore(reflectionMemory, null, 1000, constants, settings, 0);

        // Reflection should score lower than event due to extra decay
        expect(reflectionResult.total).toBeLessThan(eventResult.total);
    });

    it('caps reflection decay at minimum factor of 0.25', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5, reflectionDecayThreshold: 500 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };

        // Reflection at extreme distance (2000) - decay formula gives negative but caps at 0.25
        // decayFactor = Math.max(0.25, 1 - (2000 - 500) / (2 * 500)) = Math.max(0.25, 1 - 1.5) = 0.25
        const reflection = { type: 'reflection', importance: 5, message_ids: [0] };
        const result = calculateScore(reflection, null, 2000, constants, settings, 0);

        // With soft floor of 1.0, after 0.25 decay factor, score should be at least 0.25
        expect(result.total).toBeGreaterThanOrEqual(0.25);
    });

    it('does not apply decay when within threshold', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5, reflectionDecayThreshold: 500 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };

        // Reflection at distance 400 (within threshold - no decay)
        const reflection = { type: 'reflection', importance: 5, message_ids: [600] };
        const result = calculateScore(reflection, null, 1000, constants, settings, 0);

        // With soft floor of 1.0, importance-5 at distance 400 naturally decays to ~2.25
        // Since 2.25 > 1.0, soft floor doesn't apply - should use natural value
        expect(result.total).toBeCloseTo(2.25, 0);
    });
});

describe('math.js - tokenization', () => {
    it('filters post-stem runt tokens (< 3 chars)', async () => {
        const { tokenize } = await import('../../src/retrieval/math.js');
        const tokens = await tokenize('боюсь страшно');
        for (const t of tokens) {
            expect(t.length).toBeGreaterThanOrEqual(3);
        }
    });

    it('filters stop words', async () => {
        const { tokenize } = await import('../../src/retrieval/math.js');
        const tokens = await tokenize('the dragon and the princess');
        expect(tokens).not.toContain('the');
        expect(tokens).not.toContain('and');
        expect(tokens).toContain('dragon');
        expect(tokens).toContain('princess');
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
        // Create memories where "suzy" appears in every one but content differs
        const memories = [
            { importance: 3, message_ids: [10], embedding: null, summary: 'Suzy walked to the park with her dog' },
            { importance: 3, message_ids: [20], embedding: null, summary: 'Suzy bought a red dress at the mall' },
            { importance: 3, message_ids: [30], embedding: null, summary: 'Suzy cooked pasta for dinner tonight' },
        ];

        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.7, combinedBoostWeight: 15 };

        // Query: "suzy park dog" — "suzy" is in every memory so has zero discriminative value
        // With character stopwords, BM25 should focus on "park" and "dog"
        const resultWith = await scoreMemories(memories, null, 50, constants, settings, 'suzy park dog', ['suzy']);
        const resultWithout = await scoreMemories(memories, null, 50, constants, settings, 'suzy park dog', []);

        // With filtering, the park/dog memory should score higher relative to others
        // because "suzy" no longer inflates all scores equally
        const parkMemoryWith = resultWith.find((r) => r.memory.summary.includes('park'));
        const pastaMemoryWith = resultWith.find((r) => r.memory.summary.includes('pasta'));
        const parkMemoryWithout = resultWithout.find((r) => r.memory.summary.includes('park'));
        const pastaMemoryWithout = resultWithout.find((r) => r.memory.summary.includes('pasta'));

        // The gap between park and pasta should be larger with filtering
        const gapWith = parkMemoryWith.score - pastaMemoryWith.score;
        const gapWithout = parkMemoryWithout.score - pastaMemoryWithout.score;
        expect(gapWith).toBeGreaterThan(gapWithout);
    });
});

describe('cosineSimilarity - parameterized', () => {
    it('Float32Array orthogonal vectors', async () => {
        const { cosineSimilarity } = await import('../../src/retrieval/math.js');
        const result = cosineSimilarity(new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0]));
        expect(result).toBeCloseTo(0, 10);
    });

    it('identical Float32Array vectors', async () => {
        const { cosineSimilarity } = await import('../../src/retrieval/math.js');
        const a = new Float32Array([0.5, 0.5, 0.5]);
        const result = cosineSimilarity(a, a);
        expect(result).toBeCloseTo(1.0, 10);
    });

    it('mixed Float32Array + number[]', async () => {
        const { cosineSimilarity } = await import('../../src/retrieval/math.js');
        const result = cosineSimilarity(new Float32Array([1, 0, 0]), [1, 0, 0]);
        expect(result).toBeCloseTo(1.0, 10);
    });

    it('vectors with length not divisible by 4', async () => {
        const { cosineSimilarity } = await import('../../src/retrieval/math.js');
        const a = new Float32Array([1, 2, 3, 4, 5]);
        const b = new Float32Array([1, 2, 3, 4, 5]);
        const result = cosineSimilarity(a, b);
        expect(result).toBeCloseTo(1.0, 10);
    });

    it('length=1 vector (all remainder)', async () => {
        const { cosineSimilarity } = await import('../../src/retrieval/math.js');
        const result = cosineSimilarity(new Float32Array([1]), new Float32Array([1]));
        expect(result).toBeCloseTo(1.0, 10);
    });

    it('length=4 vector (exact unrolled iteration)', async () => {
        const { cosineSimilarity } = await import('../../src/retrieval/math.js');
        const result = cosineSimilarity(new Float32Array([1, 0, 0, 0]), new Float32Array([0, 1, 0, 0]));
        expect(result).toBeCloseTo(0, 10);
    });

    // High-dimension reference tests kept separate (computationally heavy)
    it('produces identical results on 384-dim vs naive reference', async () => {
        const { cosineSimilarity } = await import('../../src/retrieval/math.js');
        const a = new Float32Array(384);
        const b = new Float32Array(384);
        for (let i = 0; i < 384; i++) {
            a[i] = Math.sin(i * 0.1);
            b[i] = Math.cos(i * 0.1);
        }
        // Naive reference
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

    it('produces identical results on 768-dim vs naive reference', async () => {
        const { cosineSimilarity } = await import('../../src/retrieval/math.js');
        const a = new Float32Array(768);
        const b = new Float32Array(768);
        for (let i = 0; i < 768; i++) {
            a[i] = Math.sin(i * 0.05);
            b[i] = Math.cos(i * 0.05);
        }
        let dot = 0,
            na = 0,
            nb = 0;
        for (let i = 0; i < 768; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        const expected = dot / (Math.sqrt(na) * Math.sqrt(nb));
        expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 10);
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
            vectorSimilarityThreshold: 1.0, // Dangerous: causes division by zero
            alpha: 0.7,
            combinedBoostWeight: 15,
            transientDecayMultiplier: 5.0,
        };
        const contextEmbedding = [1, 0, 0];
        const breakdown = calculateScore(memory, contextEmbedding, 100, BASE_CONSTANTS, settings, 0);
        expect(Number.isFinite(breakdown.total)).toBe(true);
    });

    it('should not produce NaN when vectorSimilarityThreshold is -0.5', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = makeMemory({ embedding: [1, 0, 0] });
        const settings = {
            vectorSimilarityThreshold: -0.5, // Negative threshold
            alpha: 0.7,
            combinedBoostWeight: 15,
            transientDecayMultiplier: 5.0,
        };
        const contextEmbedding = [1, 0, 0];
        const breakdown = calculateScore(memory, contextEmbedding, 100, BASE_CONSTANTS, settings, 0);
        expect(Number.isFinite(breakdown.total)).toBe(true);
    });

    it('should not produce Infinity when transientDecayMultiplier is negative', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = makeMemory({ is_transient: true });
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
            transientDecayMultiplier: -5.0, // Negative = exponential growth instead of decay
        };
        const breakdown = calculateScore(memory, null, 100, BASE_CONSTANTS, settings, 0);
        expect(Number.isFinite(breakdown.total)).toBe(true);
    });

    it('should not produce Infinity when alpha is 999', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = makeMemory({ embedding: [1, 0, 0] });
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 999,
            combinedBoostWeight: 15,
            transientDecayMultiplier: 5.0,
        };
        const contextEmbedding = [1, 0, 0];
        const breakdown = calculateScore(memory, contextEmbedding, 100, BASE_CONSTANTS, settings, 0);
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

    it('should clamp alpha outside [0, 1] and produce correct blend weights', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = makeMemory({ embedding: [1, 0, 0] });
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 2.0, // Should be clamped to 1.0
            combinedBoostWeight: 15,
            transientDecayMultiplier: 5.0,
        };
        const contextEmbedding = [1, 0, 0];
        const breakdown = calculateScore(memory, contextEmbedding, 100, BASE_CONSTANTS, settings, 0);
        // With alpha clamped to 1.0, BM25 bonus should be (1 - 1.0) * weight = 0
        expect(breakdown.bm25Bonus).toBe(0);
    });

    it('should produce valid scores with all normal settings (regression)', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = makeMemory({ importance: 3, message_ids: [80] });
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
            transientDecayMultiplier: 5.0,
        };
        const breakdown = calculateScore(memory, null, 100, BASE_CONSTANTS, settings, 0);
        expect(breakdown.total).toBeGreaterThan(0);
        expect(breakdown.base).toBeGreaterThan(0);
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

        const contextEmbedding = new Float32Array([1, 0, 0]);
        const constants = { ...BASE_CONSTANTS };
        const settings = {
            vectorSimilarityThreshold: 0.999, // Just below 1.0, similarity can exceed this
            alpha: 0.7,
            combinedBoostWeight: 15,
            transientDecayMultiplier: 5.0,
        };

        const result = await scoreMemories(memories, contextEmbedding, 100, constants, settings, 'forest');
        for (const scored of result) {
            expect(Number.isFinite(scored.score)).toBe(true);
            expect(Number.isFinite(scored.breakdown.vectorBonus)).toBe(true);
        }
    });

    it('should clamp settings to prevent NaN when threshold is exactly 1.0', async () => {
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
        ];

        const contextEmbedding = new Float32Array([1, 0, 0]);
        const constants = { ...BASE_CONSTANTS };
        const settings = {
            vectorSimilarityThreshold: 1.0, // Division by zero
            alpha: 0.7,
            combinedBoostWeight: 15,
            transientDecayMultiplier: 5.0,
        };

        // Manually compute similarity to be > threshold (which would be clamped)
        // Since threshold is 1.0, and cosine similarity is at most 1.0,
        // with exact match we'd get similarity=1.0, threshold=1.0, so 1.0 > 1.0 is false
        // Let's test that the clamping prevents issues when similarity equals threshold
        const result = await scoreMemories(memories, contextEmbedding, 100, constants, settings, 'forest');
        for (const scored of result) {
            expect(Number.isFinite(scored.score)).toBe(true);
            expect(Number.isFinite(scored.breakdown.vectorBonus)).toBe(true);
        }
    });
});
