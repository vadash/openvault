import { beforeEach, describe, expect, it } from 'vitest';
import { cacheRetrievalDebug, clearRetrievalDebug, getLastRetrievalDebug, cacheScoringDetails, getCachedScoringDetails } from '../../src/retrieval/debug-cache.js';

describe('debug-cache', () => {
    beforeEach(() => {
        clearRetrievalDebug();
    });

    it('returns null when no data cached', () => {
        expect(getLastRetrievalDebug()).toBeNull();
    });

    it('caches and retrieves data with timestamp', () => {
        const data = { filters: { total: 10 } };
        cacheRetrievalDebug(data);
        const result = getLastRetrievalDebug();
        expect(result.filters.total).toBe(10);
        expect(result.timestamp).toBeTypeOf('number');
    });

    it('merges successive cache calls', () => {
        cacheRetrievalDebug({ filters: { total: 10 } });
        cacheRetrievalDebug({ queryContext: { entities: ['Alice'] } });
        const result = getLastRetrievalDebug();
        expect(result.filters.total).toBe(10);
        expect(result.queryContext.entities).toEqual(['Alice']);
    });

    it('clears cache', () => {
        cacheRetrievalDebug({ filters: { total: 10 } });
        clearRetrievalDebug();
        expect(getLastRetrievalDebug()).toBeNull();
    });
});

describe('cacheScoringDetails', () => {
    beforeEach(() => {
        clearRetrievalDebug();
    });

    it('stores full summary without truncation', () => {
        const longSummary = 'A'.repeat(200);
        const results = [{
            memory: { id: 'm1', type: 'event', summary: longSummary, retrieval_hits: 3, mentions: 5, characters_involved: ['Alice'] },
            score: 5.0,
            breakdown: { base: 2, baseAfterFloor: 2, recencyPenalty: 0, vectorSimilarity: 0, vectorBonus: 0, bm25Score: 0, bm25Bonus: 0, hitDamping: 0.67, frequencyFactor: 1.08, total: 5, distance: 42, importance: 4 },
        }];
        cacheScoringDetails(results, new Set(['m1']));
        const cached = getCachedScoringDetails();
        expect(cached[0].summary).toBe(longSummary);
        expect(cached[0].summary.length).toBe(200);
    });

    it('includes importance, retrieval_hits, mentions, characters_involved', () => {
        const results = [{
            memory: { id: 'm1', type: 'event', summary: 'Test', retrieval_hits: 5, mentions: 3, characters_involved: ['Alice', 'Bob'] },
            score: 4.0,
            breakdown: { base: 2, baseAfterFloor: 2, recencyPenalty: 0, vectorSimilarity: 0, vectorBonus: 0, bm25Score: 0, bm25Bonus: 0, hitDamping: 1, frequencyFactor: 1, total: 4, distance: 10, importance: 3 },
        }];
        cacheScoringDetails(results, new Set(['m1']));
        const cached = getCachedScoringDetails();
        expect(cached[0].importance).toBe(3);
        expect(cached[0].retrieval_hits).toBe(5);
        expect(cached[0].mentions).toBe(3);
        expect(cached[0].characters_involved).toEqual(['Alice', 'Bob']);
    });

    it('defaults retrieval_hits to 0 and mentions to 1 when missing', () => {
        const results = [{
            memory: { id: 'm1', type: 'event', summary: 'Test' },
            score: 2.0,
            breakdown: { base: 2, baseAfterFloor: 2, recencyPenalty: 0, vectorSimilarity: 0, vectorBonus: 0, bm25Score: 0, bm25Bonus: 0, hitDamping: 1, frequencyFactor: 1, total: 2, distance: 5, importance: 2 },
        }];
        cacheScoringDetails(results, new Set());
        const cached = getCachedScoringDetails();
        expect(cached[0].retrieval_hits).toBe(0);
        expect(cached[0].mentions).toBe(1);
        expect(cached[0].characters_involved).toEqual([]);
    });
});
