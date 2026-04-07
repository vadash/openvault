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

describe('Reflection decay with level divisor', () => {
    it('should apply slower decay to level 2 reflections', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');

        const memoryLevel1 = {
            type: 'reflection',
            level: 1,
            message_ids: [100],
            importance: 4,
        };
        const memoryLevel2 = {
            type: 'reflection',
            level: 2,
            message_ids: [100],
            importance: 4,
        };

        const constants = {
            BASE_LAMBDA: 0.05,
            IMPORTANCE_5_FLOOR: 1.0,
            reflectionDecayThreshold: 750,
            reflectionLevelMultiplier: 2.0, // NEW
        };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };

        // At distance 1000 (250 past threshold of 750):
        // Level 1 decay: 1 - 250/(2*750) = 1 - 0.1667 = 0.833
        // Level 2 decay: 1 - 250/(2*750*2) = 1 - 0.0833 = 0.917
        const scoreLevel1 = calculateScore(memoryLevel1, null, 1000, constants, settings);
        const scoreLevel2 = calculateScore(memoryLevel2, null, 1000, constants, settings);

        expect(scoreLevel2.total).toBeGreaterThan(scoreLevel1.total);
    });

    it('should default to level 1 for reflections without level field', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');

        const legacyReflection = {
            type: 'reflection',
            // No level field
            message_ids: [100],
            importance: 4,
        };

        const constants = {
            BASE_LAMBDA: 0.05,
            IMPORTANCE_5_FLOOR: 1.0,
            reflectionDecayThreshold: 750,
            reflectionLevelMultiplier: 2.0,
        };
        const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.5, combinedBoostWeight: 2.0 };

        const score = calculateScore(legacyReflection, null, 1000, constants, settings);
        expect(score.total).toBeGreaterThan(0); // Should not error
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
