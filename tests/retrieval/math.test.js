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
